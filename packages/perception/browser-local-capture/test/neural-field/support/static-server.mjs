import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const neuralFieldRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(neuralFieldRoot, "../../../../../");
const fixtureRoot = resolve(repositoryRoot, "fixtures/neural-field");

const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
});

export async function startNeuralFieldTestServer({ host = "127.0.0.1", port = 4178 } = {}) {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || "/", `http://${host}`).pathname);
    if (pathname === "/__health") {
      response.writeHead(200, responseHeaders("application/json; charset=utf-8"));
      return response.end(JSON.stringify({ ok: true, scope: "neural-field-test-only" }));
    }

    const target = resolveRequest(pathname);
    if (!target) {
      response.writeHead(404, responseHeaders("text/plain; charset=utf-8"));
      return response.end("Not found");
    }

    try {
      const metadata = await stat(target);
      if (!metadata.isFile()) throw new Error("not a file");
      response.writeHead(200, responseHeaders(CONTENT_TYPES[extname(target)] || "application/octet-stream"));
      response.end(await readFile(target));
    } catch {
      response.writeHead(404, responseHeaders("text/plain; charset=utf-8"));
      response.end("Not found");
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.listen(port, host, resolveListen).once("error", rejectListen);
  });

  return {
    origin: `http://${host}:${server.address().port}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    })
  };
}

function resolveRequest(pathname) {
  if (pathname === "/") return resolve(neuralFieldRoot, "harness/index.html");
  if (pathname === "/neural-field/harness/") return resolve(neuralFieldRoot, "harness/index.html");
  if (pathname.startsWith("/neural-field/")) {
    return containedPath(neuralFieldRoot, pathname.slice("/neural-field/".length));
  }
  if (pathname.startsWith("/fixtures/")) {
    return containedPath(fixtureRoot, pathname.slice("/fixtures/".length));
  }
  return null;
}

function containedPath(root, requestedPath) {
  const target = resolve(root, requestedPath || ".");
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`)) ? target : null;
}

function responseHeaders(contentType) {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-type": contentType
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const port = Number.parseInt(process.env.NEURAL_FIELD_E2E_PORT || "4178", 10);
  const activeServer = await startNeuralFieldTestServer({ port });
  process.stdout.write(`Neural Field test server ready at ${activeServer.origin}\n`);
  const shutdown = async () => {
    await activeServer.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
