/**
 * Which built URLs must stay OUT of the sitemap.
 *
 * A sitemap is a set of assertions: "these are canonical pages I want
 * indexed." Submitting a URL that is `noindex`, or that only exists to
 * bounce the reader somewhere else, contradicts that assertion — and Search
 * Console reports the contradiction back as "Excluded by 'noindex' tag" and
 * "Page with redirect". The pages themselves are fine and stay reachable;
 * they simply stop being *claims*.
 *
 * Plain .mjs, not .ts, because astro.config.mjs imports it before any TS
 * transform is in play. It reads the same artifacts the pages read, so the
 * exclusions can never drift from what actually got built.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const CORPUS_ROOT = join(REPO_ROOT, "corpus");
const ATLAS_ROOT = join(CORPUS_ROOT, "graph", "atlas");

function readJSON(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

/** Work slugs whose /works/<slug>/ page is a client-side redirect stub. */
function singleChapterWorkSlugs() {
  const manifest = readJSON(join(CORPUS_ROOT, "manifest.json"), null);
  const slugs = new Set();
  for (const w of manifest?.works ?? []) {
    const dir = join(CORPUS_ROOT, "works", w.slug, "chapters");
    if (!existsSync(dir)) continue;
    let chapters = 0;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory()) chapters++;
    }
    if (chapters === 1) slugs.add(w.slug);
  }
  return slugs;
}

/** /atlas/<plural>/<slug>/ URLs that are see-reference redirect stubs. */
function seeReferencePaths() {
  const index = readJSON(join(ATLAS_ROOT, "entities-index.json"), []);
  const plural = new Map([
    ["figure", "figures"],
    ["place", "places"],
    ["idea", "ideas"],
    ["group", "groups"],
    ["object", "objects"],
    ["event", "events"],
    ["animal", "animals"],
  ]);
  const paths = new Set();
  for (const row of index) {
    if (!row.see) continue;
    const p = plural.get(row.kind);
    if (p) paths.add(`/atlas/${p}/${row.slug}/`);
  }
  return paths;
}

// Mirrors lib/seo.ts — kept in sync deliberately; this file must stay plain
// .mjs so astro.config.mjs can import it before any TS transform runs.
const LANG_CODES = {
  english: "en",
  french: "fr",
  german: "de",
  greek: "grc",
  kawi: "kaw",
  latin: "la",
  sanskrit: "sa",
  urdu: "ur",
  old_english: "ang",
};
const langCode = (language) => LANG_CODES[(language ?? "").toLowerCase()] ?? "en";
function variantLang(contentType, workLanguage) {
  if (contentType === "translation") return "en";
  const base = langCode(workLanguage);
  if (contentType === "transliteration") return base === "en" ? "en" : `${base}-Latn`;
  return base;
}
const VARIANT_RANK = { translation: 0, transliteration: 1, original: 2 };

/**
 * Variant URLs that canonicalise onto a sibling instead of themselves.
 *
 * An English work's "original" and its "translation" are the same English
 * text, so both resolve to hreflang="en" — only one can represent the
 * language. The loser canonicalises onto the winner (see the chapter variant
 * page), which means it is not a page to submit.
 */
function nonRepresentativeVariantPaths() {
  const manifest = readJSON(join(CORPUS_ROOT, "manifest.json"), null);
  const paths = new Set();
  for (const w of manifest?.works ?? []) {
    const chaptersDir = join(CORPUS_ROOT, "works", w.slug, "chapters");
    if (!existsSync(chaptersDir)) continue;
    for (const entry of readdirSync(chaptersDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const meta = readJSON(join(chaptersDir, entry.name, "meta.json"), null);
      const variants = meta?.variants ?? [];
      const seen = new Set();
      for (const v of [...variants].sort(
        (a, b) => (VARIANT_RANK[a.content_type] ?? 9) - (VARIANT_RANK[b.content_type] ?? 9),
      )) {
        const lang = variantLang(v.content_type, w.language);
        if (seen.has(lang)) {
          paths.add(`/works/${w.slug}/${entry.name}/${v.content_type}/`);
        } else {
          seen.add(lang);
        }
      }
    }
  }
  return paths;
}

/**
 * Citation surfaces thin enough to be a stub rather than a claim.
 *
 * `/works/<slug>/citations/` is built for every work on either side of a
 * citation edge (594 URLs today) and `/authors/<slug>/citations/` for every
 * author who has one (190). Most carry a real apparatus; a long tail carries
 * one row and a colophon. The line drawn here is three sources — a page's own
 * outbound targets plus the distinct works that cite it. 152 of the 594 work
 * pages and 69 of the 190 author pages fall under it: still built, still
 * linked from the ledger, the work page and the author page, simply not
 * submitted. Epictetus is the honest case: none of his four works has been
 * harvested for citations and two works quote him, so his page is two rows.
 *
 * `/atlas/citations/<label>/` is never excluded. Those exist only where two
 * or more distinct works reach for a text the library does not hold, every
 * row carries a verbatim specimen from another book, and no other URL makes
 * that claim — there is nothing to consolidate onto.
 *
 * One pass over citations/works/<slug>.json answers both directions:
 * `totals.targets` is the outbound breadth, and every edge names the work
 * doing the citing, so the reverse index falls out of the same read — 482
 * files, 13,236 edges, ~50 ms on a warm cache, and citations/targets/ never
 * opened at all.
 */
function thinCitationPaths() {
  const dir = join(ATLAS_ROOT, "citations", "works");
  if (!existsSync(dir)) return new Set();
  const manifest = readJSON(join(CORPUS_ROOT, "manifest.json"), null);
  const authorOf = new Map();
  for (const w of manifest?.works ?? []) if (w.author_slug) authorOf.set(w.slug, w.author_slug);

  const outWork = new Map(); // work slug → how many sources it names
  const outAuthor = new Map(); // author slug → distinct targets across his works
  const inWork = new Map(); // work slug → works that cite it
  const inAuthor = new Map(); // author slug → works that cite him, by name or by book
  const gather = (m, key, value) => {
    if (!key) return;
    let s = m.get(key);
    if (!s) m.set(key, (s = new Set()));
    s.add(value);
  };

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const f = readJSON(join(dir, name), null);
    if (!f?.work) continue;
    outWork.set(f.work, f.totals?.targets ?? 0);
    for (const e of f.edges ?? []) {
      gather(outAuthor, authorOf.get(f.work), e.target);
      if (e.to_work) {
        gather(inWork, e.to_work, f.work);
        // Citing the Iliad is citing Homer: the author page merges both.
        gather(inAuthor, authorOf.get(e.to_work), f.work);
      }
      if (e.to_author) gather(inAuthor, e.to_author, f.work);
    }
  }

  const MIN_SOURCES = 3;
  const paths = new Set();
  for (const slug of new Set([...outWork.keys(), ...inWork.keys()])) {
    const sources = (outWork.get(slug) ?? 0) + (inWork.get(slug)?.size ?? 0);
    if (sources < MIN_SOURCES) paths.add(`/works/${slug}/citations/`);
  }
  for (const slug of new Set([...outAuthor.keys(), ...inAuthor.keys()])) {
    const sources = (outAuthor.get(slug)?.size ?? 0) + (inAuthor.get(slug)?.size ?? 0);
    if (sources < MIN_SOURCES) paths.add(`/authors/${slug}/citations/`);
  }
  return paths;
}

let _single;
let _see;
let _nonRep;
let _thinCit;

/**
 * @param {string} url absolute URL of a built page
 * @returns {boolean} true to KEEP the URL in the sitemap
 */
export function includeInSitemap(url) {
  const path = new URL(url).pathname;

  // Pages that carry `noindex`. The eval INDEX at /eval/ is a real, indexable
  // page — only the individual case pages are noindex, until the
  // citation-rigor scoring rework lands. /book/print/ is a print rendering of
  // /book/, not a second page.
  if (path.startsWith("/eval/") && path !== "/eval/") return false;
  if (path === "/book/print/") return false;

  // Redirect stubs: the destination is the page worth indexing, and each
  // stub already canonicalises onto it.
  if (_single === undefined) _single = singleChapterWorkSlugs();
  const work = /^\/works\/([^/]+)\/$/.exec(path);
  if (work && _single.has(work[1])) return false;

  if (_see === undefined) _see = seeReferencePaths();
  if (_see.has(path)) return false;

  // Variants that canonicalise onto a sibling rather than themselves.
  if (_nonRep === undefined) _nonRep = nonRepresentativeVariantPaths();
  if (_nonRep.has(path)) return false;

  // Citation apparatus with almost nothing in it. Note the shape: the
  // single-chapter rule above is anchored to /^\/works\/([^/]+)\/$/ and so
  // never reaches /works/<slug>/citations/ — which is the whole point, since
  // that route is what gives the 269 harvested single-chapter works a page of
  // their own instead of a redirect stub.
  if (/^\/(works|authors)\/[^/]+\/citations\/$/.test(path)) {
    if (_thinCit === undefined) _thinCit = thinCitationPaths();
    if (_thinCit.has(path)) return false;
  }

  return true;
}
