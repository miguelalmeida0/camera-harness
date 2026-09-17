// Centralized production security headers for the local-capture HTTP server.
//
// The policy below is derived from what this specific app actually loads, not a
// generic template:
//   - all first-party JS/CSS/HTML is same-origin ("./..." relative paths in index.html).
//   - the on-device hand-gesture pipeline (prototype/perception/local-gesture-engine.js)
//     dynamically imports the MediaPipe Tasks Vision ESM bundle and its WASM runtime from
//     cdn.jsdelivr.net, and fetches the gesture-recognizer .task model from
//     storage.googleapis.com. Both are on-device inference assets, not analytics/ads.
//   - the same pipeline runs WebAssembly, which requires 'wasm-unsafe-eval' (a narrow
//     grant that only allows compiling/instantiating WASM modules, unlike 'unsafe-eval'
//     which would also allow eval()/new Function() of arbitrary JS).
//   - a few result-overlay elements (progress bar fill, movement-zone boxes) set an
//     inline style="" attribute with a computed percentage/position; removing that would
//     require a UI/rendering redesign, so style-src keeps 'unsafe-inline' (script-src
//     does not: no script is ever inlined into the page as untrusted HTML).
//   - the one static inline <script type="importmap"> block in index.html is allowlisted
//     by exact content hash rather than 'unsafe-inline'. If that block's contents ever
//     change, IMPORTMAP_SCRIPT_HASH below must be regenerated (see
//     test/production-hardening.test.mjs, which fails loudly if the hash goes stale) —
//     recompute it with:
//     node -e "const c=require('crypto');const fs=require('fs');const m=fs.readFileSync('packages/perception/browser-local-capture/prototype/index.html','utf8').match(/<script type=\"importmap\">([\\s\\S]*?)<\\/script>/);console.log('sha256-'+c.createHash('sha256').update(m[1],'utf8').digest('base64'))"
//   - camera/microphone access is governed by the Permissions-Policy grant below, not by
//     any CSP directive; CSP has no camera/microphone concept.
export const IMPORTMAP_SCRIPT_HASH = "sha256-bBiAKYwPqqrp22qHAmtgXoaYPtFcU7ZEVq85NcFmeis=";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' '${IMPORTMAP_SCRIPT_HASH}' https://cdn.jsdelivr.net`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com",
  "worker-src 'self'",
  "child-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

export const PERMISSIONS_POLICY = "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()";

const HSTS_VALUE = "max-age=15552000; includeSubDomains";

// Applied to every response before any route-specific writeHead/writeJson call, so it
// covers static assets, API JSON, health checks, and 404s alike.
export function applySecurityHeaders(request, response) {
  response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  response.setHeader("X-Frame-Options", "DENY");
  if (isHttpsRequest(request)) response.setHeader("Strict-Transport-Security", HSTS_VALUE);
}

// Render (and any standard TLS-terminating proxy) forwards plain HTTP to this process
// and sets X-Forwarded-Proto. HSTS must never be sent over a bare local http:// dev
// connection, or a browser would force-upgrade http://127.0.0.1 and break local dev.
export function isHttpsRequest(request) {
  return String(request?.headers?.["x-forwarded-proto"] || "").toLowerCase() === "https";
}
