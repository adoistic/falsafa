/**
 * Falsafa edge Worker — serves the static Astro build from R2 (bucket: falsafaai).
 * URL→key mapping mirrors Astro's "directory" output:
 *   /                       -> index.html
 *   /works/foo/             -> works/foo/index.html
 *   /works/foo              -> works/foo/index.html   (extensionless route)
 *   /atlas/graph.json       -> atlas/graph.json       (real file, served as-is)
 *   /atlas/places/athens.md -> atlas/places/athens.md (real file, served as-is)
 * URLs are preserved byte-identically — no redirects are issued.
 */

const CT = {
  html: "text/html; charset=utf-8", json: "application/json",
  md: "text/markdown; charset=utf-8", js: "text/javascript", css: "text/css",
  svg: "image/svg+xml", webp: "image/webp", woff2: "font/woff2", woff: "font/woff",
  xml: "application/xml", png: "image/png", txt: "text/plain; charset=utf-8",
};

function resolveKey(pathname) {
  let p = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (p === "") return "index.html";
  if (p.endsWith("/")) return p + "index.html";
  const last = p.slice(p.lastIndexOf("/") + 1);
  if (last.includes(".")) return p;        // real file (has extension)
  return p + "/index.html";                // extensionless route -> directory page
}

function contentType(key, obj) {
  // Known extensions are authoritative (don't trust whatever the uploader stored).
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (CT[ext]) return CT[ext];
  return (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream";
}

function cacheControl(key) {
  if (key.startsWith("_astro/")) return "public, max-age=31536000, immutable";
  if (key.startsWith("pagefind/")) return "public, max-age=86400";
  if (key.startsWith("covers/")) return "public, max-age=604800";
  if (key.endsWith(".html")) return "public, max-age=0, must-revalidate";
  if (key.endsWith(".json") || key.endsWith(".md")) return "public, max-age=3600";
  return "public, max-age=86400";
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const url = new URL(request.url);
    const key = resolveKey(url.pathname);

    // Conditional GET: let R2 short-circuit with 304 when the etag matches.
    const inm = request.headers.get("if-none-match");
    const obj = await env.ASSETS.get(key, inm ? { onlyIf: { etagDoesNotMatch: inm } } : undefined);

    if (obj === null) {
      return new Response("404 — Not Found", {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("content-type", contentType(key, obj));
    headers.set("cache-control", cacheControl(key));
    headers.set("etag", obj.httpEtag);
    if (key.startsWith("pagefind/")) headers.set("access-control-allow-origin", "*");

    // 304 path: R2 returns an object with no body when etagDoesNotMatch fails.
    if (!("body" in obj) || obj.body === undefined) {
      return new Response(null, { status: 304, headers });
    }
    if (request.method === "HEAD") return new Response(null, { headers });
    return new Response(obj.body, { headers });
  },
};
