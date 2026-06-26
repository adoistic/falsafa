# Homepage Scale Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Falsafa homepage so the corpus's scale and shape land in the first second — a monumental-numbers masthead, an era-distribution "spectrum" timeline as the centerpiece, the featured work demoted below.

**Architecture:** Extract the only real logic — turning per-era work counts into an ordered, scaled set of bars — into a pure, unit-tested helper (`apps/site/src/lib/spectrum.ts`). The homepage [`apps/site/src/pages/index.astro`](../../../apps/site/src/pages/index.astro) consumes it and is otherwise a static template rewrite (markup + CSS), verified by build + browser screenshots. Single page, one new helper, no new dependencies or data files.

**Tech Stack:** Astro (static), TypeScript, Bun test runner, CSS-native editorial styling driven by existing design tokens in `apps/site/src/styles/tokens.css`.

---

## Reference: design spec

Full design rationale in [`docs/superpowers/specs/2026-06-26-homepage-scale-redesign-design.md`](../specs/2026-06-26-homepage-scale-redesign-design.md). Read it before starting.

## File structure

- **Create** `apps/site/src/lib/spectrum.ts` — pure helper: `buildSpectrum(eras)` → ordered, scaled bars. One responsibility: the era→bars view-model.
- **Create** `apps/site/src/lib/spectrum.test.ts` — colocated `bun test` unit tests for the helper.
- **Modify** `apps/site/src/pages/index.astro` — rewrite frontmatter (wire in helper + hero numbers), template (4 sections), and `<style>` block. This is the whole user-facing change.

No other files change. The existing featured-work rotation (JSON pool + inline swap script) is preserved verbatim, just moved down the page.

---

## Task 1: Spectrum view-model helper (TDD)

**Files:**
- Create: `apps/site/src/lib/spectrum.ts`
- Test: `apps/site/src/lib/spectrum.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/site/src/lib/spectrum.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildSpectrum, BAR_MAX_PX, BAR_MIN_PX } from "./spectrum";
import type { Manifest } from "./corpus";

/** Build a fake manifest `eras` map: { slug: workCount }. */
function eras(counts: Record<string, number>): Manifest["eras"] {
  const out: Manifest["eras"] = {};
  for (const [slug, n] of Object.entries(counts)) {
    out[slug] = { name: slug, works: Array.from({ length: n }, (_, i) => `w${i}`) };
  }
  return out;
}

describe("buildSpectrum", () => {
  test("orders eras chronologically regardless of manifest key order", () => {
    const bars = buildSpectrum(eras({ "20th-century": 5, ancient: 2, imperial: 9 }));
    expect(bars.map((b) => b.slug)).toEqual(["ancient", "imperial", "20th-century"]);
  });

  test("peak era (max count) gets full height, fraction 1, and isPeak", () => {
    const bars = buildSpectrum(eras({ ancient: 2, imperial: 10 }));
    const imperial = bars.find((b) => b.slug === "imperial")!;
    expect(imperial.isPeak).toBe(true);
    expect(imperial.heightPx).toBe(BAR_MAX_PX);
    expect(imperial.fraction).toBe(1);
  });

  test("tiny eras are floored to BAR_MIN_PX so they stay visible", () => {
    const bars = buildSpectrum(eras({ ancient: 1, imperial: 1000 }));
    const ancient = bars.find((b) => b.slug === "ancient")!;
    expect(ancient.heightPx).toBe(BAR_MIN_PX);
  });

  test("excludes zero-work eras and unknown/untimed eras", () => {
    const bars = buildSpectrum(eras({ ancient: 3, unknown: 4, medieval: 0 }));
    expect(bars.map((b) => b.slug)).toEqual(["ancient"]);
  });

  test("returns an empty array when no eras have works", () => {
    expect(buildSpectrum(eras({}))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/site && bun test src/lib/spectrum.test.ts`
Expected: FAIL — cannot resolve `./spectrum` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/site/src/lib/spectrum.ts`:

```ts
/**
 * Homepage "spectrum" view-model: turn per-era work counts into an ordered,
 * scaled set of bars for the era-distribution timeline on the homepage.
 *
 * Pure + deterministic (no disk access) so it unit-tests cleanly. The page
 * passes `manifest().eras`; tests pass a fake map.
 */
import type { Manifest } from "./corpus";

export interface SpectrumBar {
  /** Display label, e.g. "Late Antiquity". */
  label: string;
  /** Era slug for the /eras/<slug>/ link, e.g. "late-antiquity". */
  slug: string;
  /** Number of works in this era. */
  count: number;
  /** Scaled bar height in px for the desktop vertical chart. */
  heightPx: number;
  /** count / max, 0..1 — used for the mobile horizontal bar width. */
  fraction: number;
  /** True for the tallest era — gets focal styling. */
  isPeak: boolean;
}

/** Tallest bar (px) at desktop width. */
export const BAR_MAX_PX = 140;
/** Shortest visible bar (px) — floor so tiny eras don't vanish. */
export const BAR_MIN_PX = 6;

/**
 * Chronological era order. Eras absent from the manifest (or with zero works)
 * are skipped; eras not listed here (e.g. "Unknown") are excluded by design —
 * they have no position on a timeline.
 */
const ERA_ORDER = [
  "Ancient",
  "Classical",
  "Hellenistic",
  "Imperial",
  "Late Antiquity",
  "Medieval",
  "Renaissance",
  "Enlightenment",
  "19th Century",
  "20th Century",
] as const;

const toSlug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function buildSpectrum(eras: Manifest["eras"]): SpectrumBar[] {
  const present = ERA_ORDER.map((label) => ({
    label,
    slug: toSlug(label),
    count: eras[toSlug(label)]?.works.length ?? 0,
  })).filter((e) => e.count > 0);

  const max = Math.max(1, ...present.map((e) => e.count));

  return present.map((e) => ({
    label: e.label,
    slug: e.slug,
    count: e.count,
    fraction: e.count / max,
    heightPx: Math.max(BAR_MIN_PX, Math.round((e.count / max) * BAR_MAX_PX)),
    isPeak: e.count === max,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/site && bun test src/lib/spectrum.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Typecheck**

Run: `cd apps/site && bunx tsc --noEmit -p .` (or from repo root: `bun run typecheck`)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/lib/spectrum.ts apps/site/src/lib/spectrum.test.ts
git commit -m "feat(site): spectrum view-model helper for homepage era timeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rewrite the homepage

**Files:**
- Modify: `apps/site/src/pages/index.astro` (frontmatter, template body, `<style>` block)

This task replaces the whole file. Do it in three edits (frontmatter, template, styles), then verify the build.

- [ ] **Step 1: Replace the frontmatter**

Replace the entire `---`…`---` frontmatter block at the top of `apps/site/src/pages/index.astro` with:

```astro
---
import Base from "../layouts/Base.astro";
import { manifest, readWorkIndex } from "../lib/corpus";
import { buildSpectrum } from "../lib/spectrum";

const m = manifest();

// All works that have a cover image — eligible for the featured slot.
// We embed the full eligible pool in the page (as JSON), and an inline
// script picks one at random on every page load. The first pick is also
// rendered server-side so search engines + no-JS readers see real content.
interface FeaturedEntry {
  slug: string;
  title: string;
  author: string;
  description: string;
  cover_url: string;
}
const featuredPool: FeaturedEntry[] = [];
for (const w of m.works) {
  const idx = readWorkIndex(w.slug);
  if (!idx?.cover_url) continue;
  featuredPool.push({
    slug: w.slug,
    title: w.title,
    author: w.author,
    description: w.description,
    cover_url: idx.cover_url,
  });
}
// Deterministic SSR pick (first in pool); the inline script swaps on load.
const ssrPick = featuredPool[0]!;

// Era spectrum — chronological, scaled bars — the homepage centerpiece.
const spectrum = buildSpectrum(m.eras);

// Live totals.
const totalChapters = m.works.reduce((s, w) => s + (w.total_logical_chapters ?? 0), 0);
const totalVariants = m.works.reduce((s, w) => s + (w.total_variant_entries ?? 0), 0);

const fmt = (n: number) => n.toLocaleString("en-US");

// The four monumental hero numbers. "25 centuries" lives in the headline,
// so it is intentionally not repeated here.
const heroNumbers = [
  { value: fmt(m.counts.works), label: "works" },
  { value: fmt(totalChapters), label: "chapters" },
  { value: fmt(m.counts.languages), label: "languages" },
  { value: fmt(m.counts.authors), label: "authors" },
];

const description = `A premium reading platform for translated philosophical and classical texts. ${m.counts.works} works, ${totalChapters.toLocaleString("en-US")} logical chapters, ${totalVariants.toLocaleString("en-US")} variant entries across ${m.counts.languages} languages. Free, public, open source.`;
---
```

- [ ] **Step 2: Replace the template body**

Replace everything between `---` (end of frontmatter) and the opening `<style>` tag — i.e. the entire `<Base …>…</Base>` block — with:

```astro
<Base
  title="Falsafa"
  description={description}
>
  <div class="container">
    {/* 1 ─ Masthead: the scale, stated plainly */}
    <section class="masthead">
      <p class="kicker">A living library of translated thought</p>
      <h1 class="masthead-title">Twenty-five centuries of thought, carried into English.</h1>
      <p class="masthead-lede">
        Free and open source. Built to be read by people &mdash; and cited, honestly, by machines.
      </p>
      <div class="hero-numbers">
        {heroNumbers.map((n) => (
          <div class="hero-number">
            <span class="hero-number-value">{n.value}</span>
            <span class="hero-number-label">{n.label}</span>
          </div>
        ))}
      </div>
    </section>

    {/* 2 ─ The spectrum: the corpus's true shape across time. Each era is a
        link; the tallest era gets focal styling. role=list + per-bar
        aria-labels carry the data to assistive tech. */}
    <section class="spectrum-section" aria-labelledby="spectrum-heading">
      <h2 id="spectrum-heading" class="section-kicker">The shape of the corpus</h2>
      <p class="section-intro">
        Where those {fmt(m.counts.works)} works fall in time &mdash; a Greco-Roman summit, a quiet
        medieval trough, a second wave after 1800. Each era is a door.
      </p>
      <div class="spectrum" role="list">
        {spectrum.map((b) => (
          <a
            href={`/eras/${b.slug}/`}
            class:list={["spectrum-era", { "is-peak": b.isPeak }]}
            role="listitem"
            aria-label={`${b.label}: ${b.count} ${b.count === 1 ? "work" : "works"}`}
            style={`--bar-h: ${b.heightPx}px; --bar-frac: ${b.fraction}`}
          >
            <span class="spectrum-count">{b.count}</span>
            <span class="spectrum-bar" aria-hidden="true"></span>
            <span class="spectrum-label">{b.label}</span>
          </a>
        ))}
      </div>
      <p class="all-works-link">
        <a href="/works/">Browse all {fmt(m.counts.works)} works →</a>
      </p>
    </section>

    {/* 3 ─ Featured reading (rotates on load). Demoted below the scale story;
        the warm on-ramp, not the headline. */}
    <section class="featured" data-featured>
      <a href={`/works/${ssrPick.slug}/`} class="featured-cover" data-featured-link>
        <img src={ssrPick.cover_url} alt={`Cover for ${ssrPick.title}`} data-featured-img />
      </a>
      <div class="featured-text">
        <p class="kicker">Featured reading</p>
        <h2 class="featured-title" data-featured-title>{ssrPick.title}</h2>
        <p class="featured-author" data-featured-author>{ssrPick.author}</p>
        <p class="featured-desc" data-featured-desc>{ssrPick.description}</p>
        <a href={`/works/${ssrPick.slug}/`} class="cta" data-featured-cta>Begin reading →</a>
      </div>
    </section>

    {/* Embedded pool for the on-load random swap. */}
    <script type="application/json" id="featured-pool" set:html={JSON.stringify(featuredPool)} />

    <script is:inline>
      /* Featured-work rotation: pick a different work on every page load.
         Inline + synchronous so it runs before the initial paint. */
      (function () {
        var poolNode = document.getElementById("featured-pool");
        if (!poolNode || !poolNode.textContent) return;
        var pool;
        try { pool = JSON.parse(poolNode.textContent); } catch { return; }
        if (!Array.isArray(pool) || pool.length < 2) return;
        var pick = pool[Math.floor(Math.random() * pool.length)];
        var section = document.querySelector("[data-featured]");
        if (!section) return;
        var link = section.querySelector("[data-featured-link]");
        var img = section.querySelector("[data-featured-img]");
        var title = section.querySelector("[data-featured-title]");
        var author = section.querySelector("[data-featured-author]");
        var desc = section.querySelector("[data-featured-desc]");
        var cta = section.querySelector("[data-featured-cta]");
        var href = "/works/" + pick.slug + "/";
        if (link) link.setAttribute("href", href);
        if (img) {
          img.setAttribute("src", pick.cover_url);
          img.setAttribute("alt", "Cover for " + pick.title);
        }
        if (title) title.textContent = pick.title;
        if (author) author.textContent = pick.author;
        if (desc) desc.textContent = pick.description;
        if (cta) cta.setAttribute("href", href);
      })();
    </script>

    {/* 4 ─ The justification: the book and atlas, and the engine. */}
    <section class="why">
      <div class="why-col">
        <p class="kicker">Why this library exists</p>
        <h2>Every classical text that survives was carried</h2>
        <p class="why-text">
          Aristotle did not reach you in Greek alone. He reached you because a patriarch in
          Baghdad, a monk on the Euphrates, a judge in Cordoba and a wandering Scot each decided
          one book was worth the labor of another language. Falsafa is that practice continued
          for the newest readers, human and machine. The argument has a book and an atlas behind
          it.
        </p>
        <p class="why-links">
          <a href="/book/">Read Carried Across, the book →</a>
          <a href="/atlas/">Trace the atlas of carried books →</a>
        </p>
      </div>
      <div class="why-col engine-teaser">
        <p class="kicker">Under the hood</p>
        <h2>A librarian, with no vector database</h2>
        <p class="why-text">
          The corpus ships as markdown with stable paragraph IDs and ten deterministic tools, so
          any AI can read it and cite it honestly. The evals, the thesis and the live demo live
          in the engine room.
        </p>
        <p class="why-links">
          <a href="/engine/">Enter the engine room →</a>
        </p>
      </div>
    </section>
  </div>
</Base>
```

- [ ] **Step 3: Replace the `<style>` block**

Replace the entire `<style>…</style>` block at the bottom of the file with:

```astro
<style>
  .container {
    max-width: 1240px;
    margin: 0 auto;
    padding: var(--s-12) var(--s-8) var(--s-24);
  }

  /* ── Shared editorial bits ─────────────────────────────────────────── */
  .kicker {
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    margin: 0 0 var(--s-3);
  }

  /* Sections after the masthead share a top rule + breathing room. */
  .spectrum-section,
  .featured,
  .why {
    margin-top: var(--s-24);
    padding-top: var(--s-12);
    border-top: 1px solid var(--rule);
  }

  /* ── 1. Masthead ───────────────────────────────────────────────────── */
  .masthead {
    padding-top: var(--s-8);
  }

  .masthead-title {
    font-family: var(--font-display);
    font-size: var(--fs-h1);
    font-weight: 700;
    line-height: 1.08;
    letter-spacing: -0.025em;
    margin: 0 0 var(--s-5);
    max-width: 20ch;
  }

  .masthead-lede {
    font-family: var(--font-body);
    font-size: var(--fs-h3);
    line-height: 1.4;
    color: var(--ink-muted);
    margin: 0 0 var(--s-10);
    max-width: 48ch;
  }

  .hero-numbers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-6) var(--s-12);
    padding-top: var(--s-8);
    border-top: 1px solid var(--rule);
  }

  .hero-number {
    display: flex;
    flex-direction: column;
  }

  .hero-number-value {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(40px, 6vw, 64px);
    line-height: 0.95;
    letter-spacing: -0.03em;
    color: var(--ink);
  }

  .hero-number-label {
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-muted);
    margin-top: var(--s-3);
  }

  @media (max-width: 640px) {
    .hero-numbers {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--s-6) var(--s-8);
    }
  }

  /* ── 2. The spectrum ───────────────────────────────────────────────── */
  .section-kicker {
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    margin: 0 0 var(--s-3);
  }

  .section-intro {
    font-family: var(--font-display);
    font-style: italic;
    color: var(--ink-muted);
    font-size: var(--fs-h3);
    line-height: 1.4;
    max-width: 60ch;
    margin: 0 0 var(--s-12);
  }

  /* Desktop: vertical bars sharing a baseline axis (the ::after line), with
     a fixed label zone below the axis so every bar base aligns even when a
     label wraps to two lines. */
  .spectrum {
    --label-zone: 44px;
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: var(--s-2);
    height: 224px;
    margin-bottom: var(--s-5);
  }

  .spectrum::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--label-zone);
    height: 1.5px;
    background: var(--ink);
  }

  .spectrum-era {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    text-decoration: none;
    color: var(--ink);
  }

  .spectrum-count {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
    color: var(--ink-muted);
    margin-bottom: var(--s-1);
    transition: color 0.2s ease;
  }

  .spectrum-bar {
    width: 100%;
    max-width: 44px;
    height: var(--bar-h, 6px);
    background: var(--accent);
    border-radius: 2px 2px 0 0;
    transition: background 0.2s ease;
  }

  .spectrum-era.is-peak .spectrum-bar {
    background: #6f2c22;
  }

  .spectrum-label {
    height: var(--label-zone);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: var(--s-2);
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    line-height: 1.2;
    text-align: center;
    color: var(--ink-muted);
    transition: color 0.2s ease;
  }

  .spectrum-era:hover .spectrum-bar,
  .spectrum-era:focus-visible .spectrum-bar {
    background: var(--accent-soft);
  }

  .spectrum-era:hover .spectrum-count,
  .spectrum-era:hover .spectrum-label,
  .spectrum-era:focus-visible .spectrum-count,
  .spectrum-era:focus-visible .spectrum-label {
    color: var(--ink);
  }

  .spectrum-era:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }

  /* Mobile: 10 thin vertical bars are illegible — switch to a horizontal
     bar list (label · bar · count per row). Same data, same links. */
  @media (max-width: 640px) {
    .spectrum {
      display: block;
      height: auto;
      margin-bottom: var(--s-4);
    }
    .spectrum::after {
      display: none;
    }
    .spectrum-era {
      height: auto;
      display: grid;
      grid-template-columns: 96px 1fr auto;
      align-items: center;
      gap: var(--s-3);
      padding: var(--s-3) 0;
      border-bottom: 1px solid var(--rule);
    }
    .spectrum-label {
      order: -1;
      height: auto;
      padding-top: 0;
      justify-content: flex-start;
      text-align: left;
    }
    .spectrum-bar {
      max-width: none;
      width: calc(var(--bar-frac, 0) * 100%);
      height: 12px;
      min-width: 4px;
      border-radius: 0 2px 2px 0;
    }
    .spectrum-count {
      margin-bottom: 0;
    }
  }

  .all-works-link {
    margin: 0;
    font-family: var(--font-sans);
  }

  /* ── 3. Featured reading (demoted) ─────────────────────────────────── */
  .featured {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--s-12);
    align-items: center;
  }

  @media (min-width: 768px) {
    .featured {
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      gap: var(--s-16);
    }
  }

  .featured-cover {
    display: block;
    aspect-ratio: 3 / 2;
    overflow: hidden;
    border: 1px solid var(--rule);
    transition: transform 0.3s ease;
  }

  .featured-cover:hover {
    transform: scale(1.01);
  }

  .featured-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .featured-text {
    font-family: var(--font-body);
  }

  .featured-title {
    font-family: var(--font-display);
    font-size: var(--fs-h2);
    font-weight: 700;
    line-height: var(--lh-display);
    letter-spacing: -0.02em;
    margin: 0 0 var(--s-2);
  }

  .featured-author {
    font-family: var(--font-display);
    font-style: italic;
    color: var(--ink-muted);
    margin: 0 0 var(--s-6);
    font-size: var(--fs-h3);
  }

  .featured-desc {
    margin: 0 0 var(--s-6);
    font-size: var(--fs-body);
    line-height: var(--lh-body);
  }

  .cta {
    display: inline-block;
    font-family: var(--font-sans);
    font-weight: 500;
    color: var(--accent);
    border-bottom: 1px solid currentColor;
    padding-bottom: 2px;
  }

  /* ── 4. Why this library exists ────────────────────────────────────── */
  .why {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--s-12);
  }

  @media (min-width: 860px) {
    .why {
      grid-template-columns: 3fr 2fr;
      gap: var(--s-16);
    }
  }

  .why h2 {
    font-family: var(--font-display);
    font-size: var(--fs-h2);
    font-weight: 600;
    line-height: 1.2;
    margin: 0 0 var(--s-4);
    max-width: 24ch;
  }

  .why-text {
    font-family: var(--font-body);
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    max-width: 58ch;
    margin: 0 0 var(--s-5);
  }

  .why-links {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0;
    font-family: var(--font-sans);
    font-weight: 500;
  }

  .why-links a {
    color: var(--accent);
  }

  .engine-teaser {
    border-left: none;
    padding-left: 0;
  }

  @media (min-width: 860px) {
    .engine-teaser {
      border-left: 1px solid var(--rule);
      padding-left: var(--s-12);
    }
  }
</style>
```

- [ ] **Step 4: Build-check the page**

Run: `cd apps/site && bunx astro check` and `bun run typecheck` (from repo root)
Expected: no type errors and no Astro diagnostics for `index.astro`.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/pages/index.astro
git commit -m "feat(site): scale-first homepage — numbers masthead + era spectrum

Replaces the featured-first layout: monumental hero numbers, the era
distribution as a chronological spectrum timeline (each era a link),
featured work demoted below. Flat era-strip removed.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Visual verification

**Files:** none (verification only; create follow-up edits to `index.astro` only if a defect is found).

Use the `preview_*` tools — never ask the user to check manually.

- [ ] **Step 1: Start the dev server**

Use `preview_start` on `apps/site` (it runs `astro dev`; the `predev` hook prepares covers/corpus first — allow time). Then load `/`.

- [ ] **Step 2: Check for errors and correctness (desktop)**

- `preview_console_logs` + `preview_logs`: expect no errors.
- `preview_snapshot`: confirm the masthead numbers read `1,836 works`, `21,516 chapters`, `9 languages`, `442 authors` (or whatever `manifest.json` currently holds — they must match the live manifest, not these literals).
- Confirm the spectrum shows one bar per non-empty era in chronological order, Imperial tallest, counts above bars, era names below.
- `preview_click` a spectrum bar (e.g. Imperial) and confirm it navigates to `/eras/imperial/`.
- Reload twice; confirm the featured work swaps (rotation still works) and sits below the spectrum.

- [ ] **Step 3: Screenshot desktop**

`preview_screenshot` at default width. Visually confirm: numbers are monumental and aligned, the spectrum reads as a silhouette (summit at Imperial, trough at Medieval/Renaissance, modern rise), nothing clips.

- [ ] **Step 4: Check mobile**

`preview_resize` to 390px wide. `preview_snapshot` + `preview_screenshot`. Confirm: hero numbers fall into a 2×2 grid; the spectrum becomes a horizontal bar list (label · bar · count per row) and is legible; no horizontal overflow.

- [ ] **Step 5: Check dark + sepia themes**

`preview_eval`: `document.documentElement.dataset.theme = 'dark'` then screenshot; repeat with `'sepia'`; then clear with `delete document.documentElement.dataset.theme`. Confirm bars, numbers, and the axis line all have adequate contrast in each theme (terracotta bars and `#6f2c22` peak should remain visible on the dark `--paper`).

- [ ] **Step 6: Fix any defects, then share proof**

If anything is off (clipping, contrast, misalignment, wrong link), read `index.astro`, fix, and re-verify from Step 2. When clean, present the desktop + mobile screenshots to the user as proof. If fixes were made:

```bash
git add apps/site/src/pages/index.astro
git commit -m "fix(site): homepage redesign visual polish

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done criteria

- `bun test src/lib/spectrum.test.ts` passes (5 tests).
- `astro check` + `typecheck` clean.
- Homepage renders masthead → spectrum → featured → why, top to bottom.
- Hero numbers match the live manifest; every spectrum bar links to its era.
- Legible and adequately contrasted at desktop and mobile widths in light, dark, and sepia themes.
- Desktop + mobile screenshots shared as proof.

## Notes for the implementer

- **Do not** change the featured-rotation script, the manifest, the nav/footer, or the `/numbers` page — out of scope.
- The hero number literals in this plan (1,836 / 21,516 / 9 / 442) are today's values for reference. The page reads them live from `manifest.json`; verify against current data, don't hardcode.
- Deploy is a separate, later step and follows the established runbook (build `dist` locally, `netlify deploy --prod`) — Netlify CI cannot build the ~28k-page site. Do not deploy as part of this plan unless asked.
