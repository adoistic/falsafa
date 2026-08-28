/**
 * Falsafa edge Worker — serves the static Astro build from R2 (bucket: falsafaai).
 * URL→key mapping mirrors Astro's "directory" output:
 *   /                       -> index.html
 *   /works/foo/             -> works/foo/index.html
 *   /works/foo              -> 301 /works/foo/         (canonical trailing slash)
 *   /atlas/graph.json       -> atlas/graph.json       (real file, served as-is)
 *   /atlas/places/athens.md -> atlas/places/athens.md (real file, served as-is)
 *
 * Exactly one crawlable URL per page. The site builds with Astro's
 * `trailingSlash: "always"`, so every internal link, canonical tag and
 * sitemap entry ends in a slash; serving the extensionless spelling at 200
 * as well would publish a second, equally valid URL for every page on the
 * site. Extensionless page requests get a 301 to the slashed form instead.
 */

const CT = {
  html: "text/html; charset=utf-8", json: "application/json",
  md: "text/markdown; charset=utf-8", js: "text/javascript", css: "text/css",
  svg: "image/svg+xml", webp: "image/webp", woff2: "font/woff2", woff: "font/woff",
  xml: "application/xml", png: "image/png", txt: "text/plain; charset=utf-8",
  // audio/mp4 (not video/iso.segment) is the safest type for CMAF audio
  // segments across AVPlayer + hls.js
  m3u8: "application/vnd.apple.mpegurl", m4s: "audio/mp4", mp4: "audio/mp4",
};

function resolveKey(pathname) {
  let p = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (p === "") return "index.html";
  if (p.endsWith("/")) return p + "index.html";
  const last = p.slice(p.lastIndexOf("/") + 1);
  if (last.includes(".")) return p;        // real file (has extension)
  return p + "/index.html";                // extensionless route -> directory page
}

/** An extensionless, non-root path that should redirect to its slashed form. */
function needsTrailingSlash(pathname) {
  if (pathname === "/" || pathname.endsWith("/")) return false;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !last.includes(".");
}

/**
 * Raw data files are published so agents and readers can fetch them, but they
 * duplicate pages that already have canonical HTML. Left indexable they show
 * up in Search Console as "Duplicate without user-selected canonical" — a
 * .json or .md response cannot carry a <link rel="canonical">. `noindex`
 * keeps them fetchable while removing them from the index.
 */
function isRawData(key) {
  return key.startsWith("corpus/") || key.endsWith(".json") || key.endsWith(".md");
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

/**
 * /audio/* → the falsafa-audio bucket (HLS streams + alignment sidecars).
 *   /audio/works/<slug>/index.m3u8 -> works/<slug>/index.m3u8
 *   /audio/verse/<slug>/seg_00001.m4s, /audio/align/<slug>/book.json, ...
 * Everything under it is immutable generated output, so segments cache hard.
 * CORS is open: the audio is public, and localhost dev + future apps read it.
 */
async function serveAudio(request, env, ctx, pathname) {
  const key = decodeURIComponent(pathname).replace(/^\/audio\/+/, "");
  if (key === "" || key.includes("..")) return new Response("404 — Not Found", { status: 404 });

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "range, if-none-match",
    "access-control-expose-headers": "content-length, content-range, accept-ranges, etag",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const range = request.headers.get("range");

  // R2 binding reads bypass Cloudflare's edge cache entirely, so segment
  // fetches would hit the bucket on every play without this. Cache whole-file
  // GETs at the edge (cache.put rejects 206es, so ranged requests skip it).
  const cache = caches.default;
  const cacheKey = new Request(new URL(pathname, request.url).toString());
  if (request.method === "GET" && !range) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  let r2opts;
  let start = 0, end = null; // inclusive
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] !== "" || m[2] !== "")) {
      if (m[1] === "") {
        r2opts = { range: { suffix: Number(m[2]) } };
      } else {
        start = Number(m[1]);
        end = m[2] === "" ? null : Number(m[2]);
        r2opts = { range: end === null ? { offset: start } : { offset: start, length: end - start + 1 } };
      }
    }
  }

  const obj = await env.AUDIO.get(key, r2opts);
  if (obj === null) {
    return new Response("404 — Not Found", { status: 404, headers: { ...cors, "cache-control": "no-store" } });
  }

  const headers = new Headers(cors);
  headers.set("content-type", contentType(key, obj));
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  // Playlists revalidate cheaply (they only change if a work is regenerated);
  // segments and init are immutable by construction.
  headers.set(
    "cache-control",
    key.endsWith(".m3u8") || key.endsWith(".json")
      ? "public, max-age=3600"
      : "public, max-age=31536000, immutable",
  );

  if (r2opts && obj.range) {
    const size = obj.size;
    const off = "offset" in obj.range ? obj.range.offset : size - obj.range.suffix;
    const len = "length" in obj.range ? obj.range.length : size - off;
    headers.set("content-range", `bytes ${off}-${off + len - 1}/${size}`);
    headers.set("content-length", String(len));
    if (request.method === "HEAD") return new Response(null, { status: 206, headers });
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set("content-length", String(obj.size));
  if (request.method === "HEAD") return new Response(null, { headers });
  const res = new Response(obj.body, { headers });
  if (request.method === "GET") {
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return res;
}

/**
 * Legacy Naql atlas work URLs → the same work in the library.
 *
 * /atlas/works/<id>/ was the transmission atlas's per-work page before the
 * ontology rebuild (commit dc6fa146) replaced that route family. Google still
 * has those URLs indexed and they have been 404ing since. Where the work
 * exists in the corpus, send readers and link equity to it.
 *
 * Hand-verified against atlas/data/works.json (27 legacy works) and
 * corpus/manifest.json; every target below was confirmed to be a built page.
 * Single-chapter works point straight at the chapter so the hop does not land
 * on a redirect stub. The twelve legacy works with no corpus equivalent
 * (de-anima, topics, enneads, almagest, materia-medica, on-simple-drugs,
 * al-jabr, qanun, maqasid, hayy-ibn-yaqzan, panchatantra,
 * brahmasphutasiddhanta) are deliberately absent: a 404 is the honest answer
 * for a work we do not have. Add them here if the corpus acquires them.
 */
const LEGACY_ATLAS_WORKS = {
  "aeneid": "/works/virgil-aeneid-659242/",
  "aphorisms": "/works/hippocrates-aphorisms-55e562/01-aphorisms/translation/",
  "de-rerum-natura": "/works/lucretius-de-rerum-natura-4543ca/",
  "diwan-e-ghalib": "/works/mirza-ghalib-diwan-e-ghalib-74ed4c/",
  "elements": "/works/euclid-elements-d711e4/",
  "histories-herodotus": "/works/herodotus-the-histories-ecffbd/",
  "iliad": "/works/homer-iliad-056ee9/",
  "manusmriti": "/works/unknown-manusmrti-347b76/",
  "nicomachean-ethics": "/works/aristotle-nicomachean-ethics-ac98dd/",
  "nouveau-traite-deconomie": "/works/charles-dunoyer-nouveau-traite-deconomie-vol-i-6da8ce/",
  "odyssey": "/works/homer-odyssey-34e6a4/",
  "peloponnesian-war": "/works/thucydides-history-of-the-peloponnesian-war-af5aa9/",
  "republic": "/works/plato-republic-2bf014/",
  "traite-de-legislation": "/works/charles-comte-traite-de-legislation-vol-i-7e62a2/",
  "zuruckforderung-der-denkfreiheit":
    "/works/johann-gottlieb-fichte-zuruckforderung-der-denkfreiheit-bookde/",
};

/**
 * Legacy Naql atlas person URLs → the author page, on the same rule: redirect
 * where the person is an author in the library, 404 where they are not. 16 of
 * the 99 legacy people carry over; the rest (Ptolemy, Ibn Sina, al-Ghazali,
 * Porphyry, Brahmagupta …) are transmission figures we hold no works by.
 * Their ids happen to be the author slugs already, so the map is a set.
 */
const LEGACY_ATLAS_PEOPLE = new Set([
  "alexander-pope",
  "aristotle",
  "charles-comte",
  "charles-dunoyer",
  "euclid",
  "galen",
  "herodotus",
  "hippocrates",
  "homer",
  "lucretius",
  "manu",
  "mirza-ghalib",
  "plato",
  "thomas-hobbes",
  "thucydides",
  "virgil",
]);

/** Legacy URL → its replacement, or null when there is nothing to point at. */
function legacyTarget(pathname) {
  const work = /^\/atlas\/works\/([^/]+)\/?$/.exec(pathname);
  if (work) return LEGACY_ATLAS_WORKS[work[1]] ?? null;
  const person = /^\/atlas\/people\/([^/]+)\/?$/.exec(pathname);
  if (person && LEGACY_ATLAS_PEOPLE.has(person[1])) return `/authors/${person[1]}/`;
  return null;
}

const HSTS = "max-age=31536000; includeSubDomains";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Canonical host + scheme: exactly one crawlable copy of every URL.
    // www → apex and http → https as a single 301 hop.
    if (url.hostname === "www.falsafa.ai" || url.protocol === "http:") {
      url.hostname = "falsafa.ai";
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith("/audio/")) {
      if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return serveAudio(request, env, ctx, url.pathname);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Retired routes that still have inbound links and index entries.
    const legacy = legacyTarget(url.pathname);
    if (legacy) {
      return Response.redirect(new URL(legacy, url).toString(), 301);
    }

    // Canonical trailing slash. Only redirect when the slashed form is a page
    // we actually have, so a genuine 404 stays a single 404 rather than
    // becoming a redirect that lands on one.
    if (needsTrailingSlash(url.pathname)) {
      const head = await env.ASSETS.head(resolveKey(url.pathname));
      if (head !== null) {
        url.pathname += "/";
        return Response.redirect(url.toString(), 301);
      }
    }

    const key = resolveKey(url.pathname);

    // Conditional GET: let R2 short-circuit with 304 when the etag matches.
    const inm = request.headers.get("if-none-match");
    const obj = await env.ASSETS.get(key, inm ? { onlyIf: { etagDoesNotMatch: inm } } : undefined);

    if (obj === null) {
      // Styled 404 from the build (real 404 status; never cached).
      const nf = await env.ASSETS.get("404/index.html") ?? await env.ASSETS.get("404.html");
      return new Response(nf ? nf.body : "404 — Not Found", {
        status: 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "strict-transport-security": HSTS,
        },
      });
    }

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("content-type", contentType(key, obj));
    headers.set("cache-control", cacheControl(key));
    headers.set("etag", obj.httpEtag);
    headers.set("strict-transport-security", HSTS);
    if (key.startsWith("pagefind/")) headers.set("access-control-allow-origin", "*");
    if (isRawData(key)) headers.set("x-robots-tag", "noindex");

    // 304 path: R2 returns an object with no body when etagDoesNotMatch fails.
    if (!("body" in obj) || obj.body === undefined) {
      return new Response(null, { status: 304, headers });
    }
    if (request.method === "HEAD") return new Response(null, { headers });
    return new Response(obj.body, { headers });
  },
};
