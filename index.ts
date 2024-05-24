import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from "node:http";
import { promisify } from "node:util";
import { lookup as lookupCb } from "whois";

const HOST = process.env.HOST;
const PORT = process.env.PORT || "8080";
const MARKER = "rbs$";

const cache = new Map();

type Reply =
  | [number, string | Buffer, OutgoingHttpHeaders]
  | [number, string | Buffer]
  | [number];

const lookup = promisify<string, string>(lookupCb);

const getBlobReply = (data: string, path: string): Reply => {
  const headerMarker = `${MARKER}${path}\$`;

  const routeDataIx = data.indexOf("route6:");
  if (routeDataIx === -1) return [404];

  const routeSlice = data.slice(routeDataIx);
  const rbsDataStart = routeSlice.indexOf(headerMarker);
  if (rbsDataStart === -1) return [404];

  const rbsDataEnd = routeSlice.indexOf(MARKER, rbsDataStart + 1);
  if (rbsDataEnd === -1) return [404];

  const header = routeSlice.substring(rbsDataStart, routeSlice.indexOf("\n", rbsDataStart));
  const contentType = header.split("$")[2] || "text/plain; charset=utf-8";

  const responseData = routeSlice
    .substring(rbsDataStart + header.length, rbsDataEnd)
    .replaceAll(/remarks:\s+/g, "")
    .trim();

  const response = !contentType.startsWith("text")
    ? Buffer.from(responseData, "base64")
    : responseData;

  return [200, response, { "content-type": contentType }];
};

const send = (res: ServerResponse<IncomingMessage>, [status, body, headers]: Reply) => {
  res.writeHead(status, headers);
  res.end(body);
};

const server = createServer(async (req, res) => {
  const remoteAddress = req.headersDistinct["x-frontend-ip"]?.at(0) || HOST;
  if (!remoteAddress) return send(res, [500]);

  let data = cache.get(remoteAddress);
  if (!data) {
    data = await lookup(remoteAddress).catch(() => undefined);
    if (!data) return send(res, [500]);

    cache.set(remoteAddress, data);
  }

  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  return send(res, getBlobReply(data, pathname));
});

process.on("SIGHUP", () => cache.clear());
server.listen(+PORT, HOST, () => console.log(`listening on :${PORT}`));
