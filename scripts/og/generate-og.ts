/**
 * og/generate-og — professional Open Graph images for every share surface.
 *
 * One visual system (the site's "Catalogue & Ledger" grammar: paper, ink,
 * terracotta, hairline rules, serif small-caps running heads) across:
 *
 *   --site    the site-wide set: default.png, atlas.png, engine.png
 *             + apple-touch-icon.png / favicon-32.png (PNG fallbacks)
 *   --works   one per work from the corpus manifest (incremental: skips
 *             images whose content hash is unchanged; --force regenerates)
 *
 * Pipeline: satori (text shaped to SVG paths with the site's real webfonts —
 * latin + latin-ext, so Ṛgveda and Śarīrārthagāthā set correctly) → resvg
 * (raster) → sharp (palette PNG, keeps every image well under messaging-app
 * limits). 1200×630, the one size every platform accepts — WhatsApp,
 * Telegram, iMessage, X, LinkedIn, Facebook, Slack, Discord.
 *
 * Output: apps/site/public/og/…  (shipped as static files; Base.astro emits
 * the matching meta tags). State: public/og/works/.og-state.json.
 *
 * Usage: bun run scripts/og/generate-og.ts [--site] [--works] [--force] [--only <slug>]
 */

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = join(import.meta.dir, "../..");
const OUT = join(ROOT, "apps/site/public/og");
const FONT_DIR = (pkg: string) => join(ROOT, "node_modules/@fontsource", pkg, "files");

// ── palette (light theme — the brand surface) ────────────────────────
const PAPER = "#faf6ee";
const INK = "#1a1614";
const MUTED = "#5a5550";
const ACCENT = "#8a3a2e";
const ACCENT_SOFT = "#c8907a";
const RULE = "#e8e0d2";

// ── fonts ────────────────────────────────────────────────────────────
function font(pkg: string, file: string): Buffer {
  return readFileSync(join(FONT_DIR(pkg), file));
}
const FONTS = [
  { name: "Source Serif 4", data: font("source-serif-4", "source-serif-4-latin-600-normal.woff"), weight: 600 as const, style: "normal" as const },
  { name: "SS4 Ext", data: font("source-serif-4", "source-serif-4-latin-ext-600-normal.woff"), weight: 600 as const, style: "normal" as const },
  { name: "SS4 Ext", data: font("source-serif-4", "source-serif-4-latin-ext-700-normal.woff"), weight: 700 as const, style: "normal" as const },
  { name: "Source Serif 4", data: font("source-serif-4", "source-serif-4-latin-700-normal.woff"), weight: 700 as const, style: "normal" as const },
  { name: "Crimson Pro", data: font("crimson-pro", "crimson-pro-latin-400-normal.woff"), weight: 400 as const, style: "normal" as const },
  { name: "CP Ext", data: font("crimson-pro", "crimson-pro-latin-ext-400-normal.woff"), weight: 400 as const, style: "normal" as const },
  { name: "Crimson Pro", data: font("crimson-pro", "crimson-pro-latin-400-italic.woff"), weight: 400 as const, style: "italic" as const },
  { name: "CP Ext", data: font("crimson-pro", "crimson-pro-latin-ext-400-italic.woff"), weight: 400 as const, style: "italic" as const },
  { name: "Crimson Pro", data: font("crimson-pro", "crimson-pro-latin-600-normal.woff"), weight: 600 as const, style: "normal" as const },
  { name: "CP Ext", data: font("crimson-pro", "crimson-pro-latin-ext-600-normal.woff"), weight: 600 as const, style: "normal" as const },
];

// ── element helpers (satori takes React-ish object trees) ────────────
type El = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown): El => ({
  type,
  props: { style, children },
});

/** serif small-caps imitation: lowercase + tracking (satori has no
 *  font-variant) — set in Crimson 600 like the site's running heads. */
const smallcaps = (text: string, size: number, color: string) =>
  h(
    "div",
    {
      fontFamily: '"Crimson Pro", "CP Ext"',
      fontWeight: 600,
      fontSize: size,
      letterSpacing: "0.12em",
      textTransform: "lowercase",
      color,
    },
    text,
  );

/** The shared frame: paper, top rule with running head + folio, content,
 *  bottom rule with colophon line. */
function frame(runningHead: string, folio: string, content: El[], colophon: string): El {
  return h(
    "div",
    {
      width: 1200,
      height: 630,
      display: "flex",
      flexDirection: "column",
      backgroundColor: PAPER,
      padding: "56px 72px 48px",
      fontFamily: '"Crimson Pro", "CP Ext"',
    },
    [
      // running head
      h(
        "div",
        {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderTop: `2px solid ${INK}`,
          paddingTop: 18,
        },
        [smallcaps(runningHead, 26, INK), smallcaps(folio, 24, MUTED)],
      ),
      // content
      h(
        "div",
        { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" },
        content,
      ),
      // colophon
      h(
        "div",
        {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderTop: `1px solid ${RULE}`,
          paddingTop: 16,
        },
        [
          h(
            "div",
            { fontFamily: '"Crimson Pro", "CP Ext"', fontSize: 24, color: MUTED },
            colophon,
          ),
          smallcaps("falsafa.ai", 24, ACCENT),
        ],
      ),
    ],
  );
}

async function render(el: El, out: string) {
  const svg = await satori(el as never, { width: 1200, height: 630, fonts: FONTS });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  // palette-quantized PNG: flat editorial design compresses beautifully
  const optimized = await sharp(png).png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer();
  await Bun.write(out, optimized);
  return optimized.length;
}

// ── the site set ─────────────────────────────────────────────────────
interface AtlasMetaLite {
  totals?: Record<string, number>;
  works_harvested?: number;
}
function atlasNumbers(): { entities: string; citations: string; quotes: string } | null {
  try {
    const m = JSON.parse(
      readFileSync(join(ROOT, "corpus/graph/atlas/meta.json"), "utf-8"),
    ) as AtlasMetaLite;
    const f = (n?: number) => (n ?? 0).toLocaleString("en-US");
    return {
      entities: f(m.totals?.entities_merged),
      citations: f(m.totals?.citations),
      quotes: f(m.totals?.entity_verbatim_quotes),
    };
  } catch {
    return null;
  }
}

function manifestCounts() {
  const m = JSON.parse(readFileSync(join(ROOT, "corpus/manifest.json"), "utf-8"));
  const chapters = (m.works as { total_logical_chapters?: number }[]).reduce(
    (s, w) => s + (w.total_logical_chapters ?? 0),
    0,
  );
  return {
    works: m.counts.works as number,
    authors: m.counts.authors as number,
    languages: m.counts.languages as number,
    chapters,
    worksList: m.works as {
      slug: string;
      title: string;
      author: string;
      era: string;
      language: string;
      total_logical_chapters: number;
    }[],
  };
}

async function siteSet() {
  const c = manifestCounts();
  const a = atlasNumbers();
  const fmt = (n: number) => n.toLocaleString("en-US");

  // default: the claim, monumental
  const defaultEl = frame(
    "falsafa · a living library",
    `${fmt(c.works)} works · ${c.languages} languages`,
    [
      h(
        "div",
        {
          fontFamily: '"Source Serif 4", "SS4 Ext", "Crimson Pro", "CP Ext"',
          fontWeight: 700,
          fontSize: 88,
          lineHeight: 1.06,
          letterSpacing: "-0.02em",
          color: INK,
          maxWidth: 980,
        },
        "Twenty-five centuries of thought, carried into English.",
      ),
      h(
        "div",
        { fontFamily: '"Crimson Pro", "CP Ext"', fontSize: 34, color: MUTED, marginTop: 36 },
        "Free and open source. Built to be read by people — and cited, honestly, by machines.",
      ),
    ],
    `${fmt(c.works)} works · ${fmt(c.chapters)} chapters · ${fmt(c.authors)} authors`,
  );
  console.log("default.png", await render(defaultEl, join(OUT, "default.png")), "bytes");

  // atlas: the map's own numbers
  const atlasEl = frame(
    "the atlas",
    a ? `${a.entities} entities` : "the ontology of the library",
    [
      h(
        "div",
        {
          fontFamily: '"Source Serif 4", "SS4 Ext", "Crimson Pro", "CP Ext"',
          fontWeight: 700,
          fontSize: 80,
          lineHeight: 1.08,
          letterSpacing: "-0.02em",
          color: INK,
          maxWidth: 1000,
        },
        "A map of the library, drawn from the texts themselves.",
      ),
      h(
        "div",
        { fontFamily: '"Crimson Pro", "CP Ext"', fontSize: 34, color: MUTED, marginTop: 36, display: "flex" },
        a
          ? `${a.entities} figures, ideas & places · ${a.citations} stance-typed citations · ${a.quotes} verbatim anchors`
          : "Figures, ideas, places, citations — every claim anchored to a verbatim paragraph.",
      ),
    ],
    "No claim without a verbatim quotation",
  );
  console.log("atlas.png", await render(atlasEl, join(OUT, "atlas.png")), "bytes");

  // engine: the technical surface
  const engineEl = frame(
    "the engine room",
    "deterministic tools · honest citations",
    [
      h(
        "div",
        {
          fontFamily: '"Source Serif 4", "SS4 Ext", "Crimson Pro", "CP Ext"',
          fontWeight: 700,
          fontSize: 84,
          lineHeight: 1.06,
          letterSpacing: "-0.02em",
          color: INK,
          maxWidth: 980,
        },
        "The library is the demo.",
      ),
      h(
        "div",
        { fontFamily: '"Crimson Pro", "CP Ext"', fontSize: 34, color: MUTED, marginTop: 36 },
        "A librarian with no vector database: markdown, stable paragraph IDs, ten deterministic tools.",
      ),
    ],
    "Any AI can read it, and cite it honestly",
  );
  console.log("engine.png", await render(engineEl, join(OUT, "engine.png")), "bytes");

  // favicon PNG fallbacks from the same system
  const mark = (size: number, fontSize: number) =>
    h(
      "div",
      {
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: PAPER,
        color: INK,
        fontFamily: '"Source Serif 4", "SS4 Ext", "Crimson Pro", "CP Ext"',
        fontWeight: 700,
        fontSize,
      },
      "F",
    );
  for (const [file, size, fs] of [
    ["apple-touch-icon.png", 180, 132],
    ["favicon-32.png", 32, 24],
  ] as const) {
    const svg = await satori(mark(size, fs) as never, { width: size, height: size, fonts: FONTS });
    const png = new Resvg(svg).render().asPng();
    await Bun.write(join(ROOT, "apps/site/public", file), await sharp(png).png({ palette: true }).toBuffer());
    console.log(file, "written");
  }
}

// ── per-work images ──────────────────────────────────────────────────
function titleSize(t: string): number {
  if (t.length <= 22) return 88;
  if (t.length <= 40) return 72;
  if (t.length <= 70) return 58;
  return 46;
}

async function worksSet(force: boolean, only?: string) {
  const c = manifestCounts();
  await mkdir(join(OUT, "works"), { recursive: true });
  const statePath = join(OUT, "works", ".og-state.json");
  let state: Record<string, string> = {};
  if (!force && existsSync(statePath)) {
    try {
      state = JSON.parse(readFileSync(statePath, "utf-8"));
    } catch {}
  }
  let made = 0;
  let skipped = 0;
  for (const w of c.worksList) {
    if (only && w.slug !== only) continue;
    const meta = [w.era, w.language?.replace(/_/g, " ")].filter(Boolean).join(" · ");
    const extent = `${w.total_logical_chapters} ${w.total_logical_chapters === 1 ? "chapter" : "chapters"}`;
    const hash = createHash("sha1")
      .update(JSON.stringify([w.title, w.author, meta, extent, 3 /* template ver */]))
      .digest("hex");
    const out = join(OUT, "works", `${w.slug}.png`);
    if (!force && state[w.slug] === hash && existsSync(out)) {
      skipped++;
      continue;
    }
    const el = frame(
      "falsafa · the library",
      meta.toLowerCase() || "the library",
      [
        h(
          "div",
          {
            fontFamily: '"Source Serif 4", "SS4 Ext", "Crimson Pro", "CP Ext"',
            fontWeight: 700,
            fontSize: titleSize(w.title),
            lineHeight: 1.1,
            letterSpacing: "-0.015em",
            color: INK,
            maxWidth: 1020,
          },
          w.title,
        ),
        h(
          "div",
          {
            fontFamily: '"Crimson Pro", "CP Ext"',
            fontStyle: "italic",
            fontSize: 40,
            color: MUTED,
            marginTop: 28,
          },
          w.author,
        ),
        h(
          "div",
          {
            display: "flex",
            marginTop: 30,
            fontFamily: '"Crimson Pro", "CP Ext"',
            fontWeight: 600,
            fontSize: 25,
            letterSpacing: "0.1em",
            textTransform: "lowercase",
            color: ACCENT,
          },
          `${extent} · read free`,
        ),
      ],
      "Twenty-five centuries of thought, carried into English",
    );
    await render(el, out);
    state[w.slug] = hash;
    made++;
    if (made % 200 === 0) console.log(`  …${made} rendered`);
  }
  await Bun.write(statePath, JSON.stringify(state) + "\n");
  console.log(`works OG: ${made} rendered · ${skipped} unchanged`);
}

// ── main ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const doSite = args.includes("--site") || (!args.includes("--works") && !args.includes("--only"));
const doWorks = args.includes("--works") || args.includes("--only");
const force = args.includes("--force");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx > -1 ? args[onlyIdx + 1] : undefined;

await mkdir(OUT, { recursive: true });
if (doSite) await siteSet();
if (doWorks) await worksSet(force, only);
