import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../../../../..");
const prototype = resolve(repository, "packages/perception/browser-local-capture/prototype");
const proofDriver = resolve(here, "proof-driver.js");
const requestedPort = Number(process.argv[process.argv.indexOf("--port") + 1]);
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4178;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"]
]);

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/__proof__/proof-driver.js") {
      return send(response, 200, await readFile(proofDriver), contentTypes.get(".js"));
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const source = await readFile(resolve(prototype, "index.html"), "utf8");
      const injected = source.replace("</body>", "<script type=\"module\" src=\"/__proof__/proof-driver.js\"></script></body>");
      return send(response, 200, injected, contentTypes.get(".html"));
    }
    if (url.pathname.startsWith("/api/")) {
      return send(response, 503, JSON.stringify({ ok: false, code: "proof_server_offline_service" }), contentTypes.get(".json"));
    }
    const base = url.pathname.startsWith("/fixtures/") ? repository : prototype;
    const file = safeResolve(base, decodeURIComponent(url.pathname));
    return send(response, 200, await readFile(file), contentTypes.get(extname(file)) || "application/octet-stream");
  } catch (error) {
    const missing = error?.code === "ENOENT";
    return send(response, missing ? 404 : 500, missing ? "Not found" : "Proof server error", "text/plain; charset=utf-8");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Neural Field proof server: http://127.0.0.1:${port}`);
});

function safeResolve(base, pathname) {
  const file = resolve(base, `.${pathname}`);
  if (file !== base && !file.startsWith(`${base}${sep}`)) throw new Error("Path outside proof roots");
  return file;
}

function send(response, status, body, contentType) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Cross-Origin-Resource-Policy": "same-origin"
  });
  response.end(body);
}
