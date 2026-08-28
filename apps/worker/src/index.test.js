/**
 * Routing tests for the edge Worker.
 *
 * The Worker is the only place the site issues real HTTP status codes, so its
 * routing IS the site's SEO contract: exactly one crawlable URL per page,
 * retired routes pointed at their replacement, and a genuine 404 for anything
 * we truly do not have. These assertions run against a fake R2 backed by the
 * real `apps/site/dist`, so they exercise the same key lookups production does.
 *
 * Skipped when dist has not been built — the assertions are about routing over
 * a real build, and a synthetic bucket would test the mock, not the Worker.
 *
 * Run from this directory (`cd apps/worker/src && bun test`) — a bun test from
 * apps/site walks public/covers and blows the file-descriptor limit.
 */
import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./index.js";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "site", "dist");
const built = existsSync(join(DIST, "index.html"));

const bucket = {
  async head(key) {
    const p = join(DIST, key);
    return existsSync(p) && statSync(p).isFile() ? { size: statSync(p).size } : null;
  },
  async get(key) {
    const p = join(DIST, key);
    if (!existsSync(p) || !statSync(p).isFile()) return null;
    const body = readFileSync(p);
    return { body, size: body.length, httpEtag: '"t"', httpMetadata: {}, writeHttpMetadata() {} };
  },
};
const env = { ASSETS: bucket, AUDIO: bucket };
const ctx = { waitUntil() {} };

async function get(path) {
  const res = await worker.fetch(new Request("https://falsafa.ai" + path), env, ctx);
  return {
    status: res.status,
    location: res.headers.get("location") && new URL(res.headers.get("location")).pathname,
    robots: res.headers.get("x-robots-tag"),
  };
}

describe.if(built)("worker routing", () => {
  it("301s retired atlas work URLs to the work in the library", async () => {
    expect(await get("/atlas/works/nicomachean-ethics/")).toMatchObject({
      status: 301,
      location: "/works/aristotle-nicomachean-ethics-ac98dd/",
    });
  });

  it("sends single-chapter works straight to the chapter, not the redirect stub", async () => {
    expect(await get("/atlas/works/aphorisms/")).toMatchObject({
      status: 301,
      location: "/works/hippocrates-aphorisms-55e562/01-aphorisms/translation/",
    });
  });

  it("301s retired atlas person URLs to the author page", async () => {
    expect(await get("/atlas/people/aristotle/")).toMatchObject({
      status: 301,
      location: "/authors/aristotle/",
    });
  });

  it("404s retired URLs with no equivalent rather than inventing a target", async () => {
    // We hold no De Anima and no works by Ibn Sina; a redirect would lie.
    expect((await get("/atlas/works/de-anima/")).status).toBe(404);
    expect((await get("/atlas/people/ibn-sina/")).status).toBe(404);
  });

  it("301s extensionless paths to the canonical trailing slash", async () => {
    expect(await get("/works")).toMatchObject({ status: 301, location: "/works/" });
    expect(await get("/atlas/figures/zeus")).toMatchObject({
      status: 301,
      location: "/atlas/figures/zeus/",
    });
  });

  it("serves canonical URLs without redirecting", async () => {
    expect((await get("/works/")).status).toBe(200);
    expect((await get("/")).status).toBe(200);
  });

  it("keeps a genuine 404 a single 404, never a redirect onto one", async () => {
    expect((await get("/works/not-a-real-work")).status).toBe(404);
    expect((await get("/nope/")).status).toBe(404);
  });

  it("marks raw data noindex but leaves HTML pages alone", async () => {
    // .md/.json twins cannot carry <link rel="canonical">, so they are kept
    // fetchable-but-unindexed via the header instead.
    const raw = await get("/corpus/works/homer-iliad-056ee9/index.md");
    expect(raw.status).toBe(200);
    expect(raw.robots).toBe("noindex");
    expect((await get("/works/")).robots).toBeNull();
  });

  it("still serves real files at their own paths", async () => {
    expect((await get("/robots.txt")).status).toBe(200);
    expect((await get("/sitemap-index.xml")).status).toBe(200);
  });
});
