/**
 * ontology-plan.ts
 *
 * Ontology pipeline planner — enumerates all eligible works from manifest.json,
 * windows big works by chapter-group (keeping under ~32k subagent output ceiling),
 * skips works whose output already exists (idempotent), and prints the next N
 * work-windows as dispatch-ready lines.
 *
 * Priority ordering:
 *   1. Foundational / citation-dense prose (Indic smṛti, Greek/Latin philosophy,
 *      ancient classics) — these are the backbone of the knowledge graph.
 *   2. Sanskrit / Indic works — corpus gap; highest acquisition signal.
 *   3. Greek / Latin classics — well-represented, entity-rich.
 *   4. English philosophy / political theory — dense citations.
 *   5. English poetry (ECPA, verse-only works) — implicit THEME test.
 *   6. Everything else.
 *
 * Usage:
 *   bun run scripts/graph/ontology-plan.ts                 # print next 20 windows
 *   bun run scripts/graph/ontology-plan.ts --next [N]      # print next N windows
 *   bun run scripts/graph/ontology-plan.ts --all           # print ALL remaining windows
 *   bun run scripts/graph/ontology-plan.ts --stats         # just print totals
 *
 * Output per window line (tab-separated):
 *   <slug>  <chapters...>  [big-work note]
 *
 * Output path per work: corpus/graph/ontology/v1/<slug>.json
 * (For big works windowed across multiple calls, each window gets its own output:
 *  corpus/graph/ontology/v1/<slug>-part<N>.json)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Manifest } from "./types";

const ROOT       = resolve(import.meta.dir, "..", "..");
const CORPUS     = join(ROOT, "corpus");
const ONT_DIR    = join(CORPUS, "graph", "ontology", "v1");

// A work window that fits comfortably in one subagent call.
// The 32k output-token ceiling limits how much JSON we can emit;
// restricting the input window to ~40k chars (same as citation extractor)
// keeps output well under ceiling even for entity-dense works.
const MAX_WINDOW_CHARS = 40_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkWindow {
  slug: string;
  title: string;
  author: string;
  language: string;
  genre: string;
  kind: "single" | "windowed-part";
  part: number;        // 1-based part number (1 = only part, or first of many)
  total_parts: number; // 1 for single-window works
  chapters: string[];  // chapter dir names included in this window
  char_budget: number; // estimated chars in this window
  output_path: string; // where the JSON will be written
  is_ecpa: boolean;    // true = ECPA verse-only work; uses original.md not paras
}

// ---------------------------------------------------------------------------
// Priority scoring
// ---------------------------------------------------------------------------

function priorityScore(w: {
  language: string;
  genre: string;
  era: string;
  thothica_role?: string;
}): number {
  let score = 0;

  // Foundational smṛti / dharmaśāstra / law (Indic)
  if (w.genre === "Law" || w.genre === "indic") score += 100;

  // Sanskrit / Indic languages — critical corpus gap
  if (w.language === "Sanskrit" || w.language === "Kawi") score += 90;

  // Greek / Latin philosophy — entity + citation rich
  if ((w.language === "Greek" || w.language === "Latin") && w.genre === "Philosophy") score += 80;

  // Greek / Latin classics generally
  if (w.language === "Greek" || w.language === "Latin") score += 50;

  // English philosophy & political theory — dense citations
  if (w.language === "English" && (w.genre === "Philosophy" || w.genre === "Political Theory")) score += 40;

  // English poetry — key for implicit THEME extraction test
  if (w.language === "English" && w.genre === "Poetry") score += 30;

  // Ancient / classical works rank higher within each language tier
  if (w.era === "Ancient" || w.era === "Classical") score += 20;
  if (w.era === "Hellenistic" || w.era === "Imperial") score += 10;

  return score;
}

// ---------------------------------------------------------------------------
// Chapter loading helpers
// ---------------------------------------------------------------------------

/**
 * Returns total character count of a chapter's paragraphs,
 * or 0 if the chapter has no translation.paragraphs.json
 * (ECPA works only have original.md — those are handled separately).
 */
function chapterParaChars(slug: string, chapterDir: string): number {
  const pf = join(CORPUS, "works", slug, "chapters", chapterDir, "translation.paragraphs.json");
  if (!existsSync(pf)) {
    // Try original.paragraphs.json (some works use that)
    const opf = join(CORPUS, "works", slug, "chapters", chapterDir, "original.paragraphs.json");
    if (!existsSync(opf)) return 0;
    try {
      const ps = JSON.parse(readFileSync(opf, "utf-8")) as { text: string }[];
      return ps.reduce((s, p) => s + p.text.length, 0);
    } catch {
      return 0;
    }
  }
  try {
    const ps = JSON.parse(readFileSync(pf, "utf-8")) as { text: string }[];
    return ps.reduce((s, p) => s + p.text.length, 0);
  } catch {
    return 0;
  }
}

/**
 * Returns total character count of a chapter's original.md
 * (used for ECPA verse-only works).
 */
function chapterOriginalMdChars(slug: string, chapterDir: string): number {
  const f = join(CORPUS, "works", slug, "chapters", chapterDir, "original.md");
  if (!existsSync(f)) return 0;
  try {
    return readFileSync(f, "utf-8").length;
  } catch {
    return 0;
  }
}

function isEcpaWork(slug: string, chapterDirs: string[]): boolean {
  // ECPA works: first chapter has original.md but no translation.paragraphs.json
  if (chapterDirs.length === 0) return false;
  const first = chapterDirs[0]!;
  const hasPf = existsSync(join(CORPUS, "works", slug, "chapters", first, "translation.paragraphs.json"))
    || existsSync(join(CORPUS, "works", slug, "chapters", first, "original.paragraphs.json"));
  const hasOrig = existsSync(join(CORPUS, "works", slug, "chapters", first, "original.md"));
  return !hasPf && hasOrig;
}

// ---------------------------------------------------------------------------
// Output-path helpers
// ---------------------------------------------------------------------------

function outputPath(slug: string, part: number, totalParts: number): string {
  if (totalParts === 1) return join(ONT_DIR, `${slug}.json`);
  return join(ONT_DIR, `${slug}-part${String(part).padStart(2, "0")}.json`);
}

function isComplete(slug: string, totalParts: number): boolean {
  if (totalParts === 1) return existsSync(join(ONT_DIR, `${slug}.json`));
  // All parts must exist
  for (let i = 1; i <= totalParts; i++) {
    if (!existsSync(outputPath(slug, i, totalParts))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Window builder: slice chapter list into char-budget windows
// ---------------------------------------------------------------------------

/**
 * For a single chapter whose content exceeds MAX_WINDOW_CHARS, load its paragraphs
 * and return sub-windows of paragraph-index ranges (encoded as "ch:start-end").
 * The caller uses these tokens to load only that paragraph slice.
 */
function subwindowChapter(slug: string, chapterDir: string): string[] {
  const pf = join(CORPUS, "works", slug, "chapters", chapterDir, "translation.paragraphs.json")
    || join(CORPUS, "works", slug, "chapters", chapterDir, "original.paragraphs.json");
  if (!existsSync(pf)) return [`${chapterDir}:0-end`];
  try {
    const ps = JSON.parse(readFileSync(pf, "utf-8")) as { text: string }[];
    const tokens: string[] = [];
    let start = 0;
    let size = 0;
    for (let i = 0; i < ps.length; i++) {
      size += (ps[i]!.text.length);
      if (size > MAX_WINDOW_CHARS && i > start) {
        tokens.push(`${chapterDir}:${start}-${i - 1}`);
        start = i;
        size = ps[i]!.text.length;
      }
    }
    tokens.push(`${chapterDir}:${start}-${ps.length - 1}`);
    return tokens;
  } catch {
    return [`${chapterDir}:0-end`];
  }
}

function buildWindows(
  slug: string,
  title: string,
  author: string,
  language: string,
  genre: string,
  era: string,
  chapterDirs: string[],
  ecpa: boolean,
): WorkWindow[] {
  // For ECPA works, use original.md sizes; for prose works use paragraphs
  const charsFn = ecpa
    ? (ch: string) => chapterOriginalMdChars(slug, ch)
    : (ch: string) => chapterParaChars(slug, ch);

  // Expand chapters: for single chapters that exceed the budget, sub-window by paragraph range
  const expandedChapters: { token: string; chars: number }[] = [];
  for (const ch of chapterDirs) {
    const len = charsFn(ch);
    if (len === 0) continue;
    if (!ecpa && len > MAX_WINDOW_CHARS) {
      // Sub-window by paragraph ranges
      const subTokens = subwindowChapter(slug, ch);
      // Estimate chars per sub-token (evenly divided as approximation)
      const approxCharsEach = Math.ceil(len / subTokens.length);
      for (const token of subTokens) {
        expandedChapters.push({ token, chars: approxCharsEach });
      }
    } else {
      expandedChapters.push({ token: ch, chars: len });
    }
  }

  // Build cumulative windows over the expanded token list
  const windows: { token: string; chars: number }[][] = [];
  let cur: { token: string; chars: number }[] = [];
  let size = 0;

  for (const item of expandedChapters) {
    if (cur.length > 0 && size + item.chars > MAX_WINDOW_CHARS) {
      windows.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(item);
    size += item.chars;
  }
  if (cur.length > 0) windows.push(cur);

  if (windows.length === 0) return []; // work has no readable content

  const totalParts = windows.length;
  return windows.map((items, i) => ({
    slug,
    title,
    author,
    language,
    genre,
    kind: totalParts === 1 ? "single" : "windowed-part",
    part: i + 1,
    total_parts: totalParts,
    chapters: items.map((it) => it.token),
    char_budget: items.reduce((s, it) => s + it.chars, 0),
    output_path: outputPath(slug, i + 1, totalParts),
    is_ecpa: ecpa,
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const statsOnly = argv.includes("--stats");
  const printAll  = argv.includes("--all");
  const nextN     = (() => {
    const ni = argv.indexOf("--next");
    if (ni >= 0) return parseInt(argv[ni + 1] ?? "20", 10);
    return statsOnly ? 0 : 20;
  })();

  const manifest = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf-8")) as Manifest & {
    works: Array<{
      slug: string; title: string; author: string;
      language: string; genre: string; era: string;
      thothica_role?: string;
    }>;
  };

  // Sort by priority score descending
  const sorted = [...manifest.works].sort(
    (a, b) => priorityScore(b) - priorityScore(a),
  );

  let totalWindows = 0;
  let doneWindows = 0;
  const pendingWindows: WorkWindow[] = [];

  for (const w of sorted) {
    if (w.slug === "mahabharata") continue; // excluded per spec

    const chaptersDir = join(CORPUS, "works", w.slug, "chapters");
    if (!existsSync(chaptersDir)) continue;

    const chapterDirs = readdirSync(chaptersDir).sort();
    const ecpa = isEcpaWork(w.slug, chapterDirs);

    const windows = buildWindows(
      w.slug, w.title, w.author, w.language, w.genre, w.era,
      chapterDirs, ecpa,
    );
    if (windows.length === 0) continue;

    totalWindows += windows.length;

    for (const win of windows) {
      if (existsSync(win.output_path)) {
        doneWindows++;
      } else {
        pendingWindows.push(win);
      }
    }
  }

  const remaining = pendingWindows.length;

  if (statsOnly || remaining === 0) {
    if (remaining === 0) {
      console.log("ONTOLOGY COMPLETE");
    }
    console.log(`Total windows: ${totalWindows} | Done: ${doneWindows} | Remaining: ${remaining}`);
    return;
  }

  console.log(`Total windows: ${totalWindows} | Done: ${doneWindows} | Remaining: ${remaining}`);
  console.log("");

  const limit = printAll ? remaining : Math.min(nextN, remaining);
  const toShow = pendingWindows.slice(0, limit);

  for (const win of toShow) {
    const partNote = win.total_parts > 1 ? ` [part ${win.part}/${win.total_parts}]` : "";
    const ecpaNote = win.is_ecpa ? " [ecpa-verse]" : "";
    const charsK   = Math.round(win.char_budget / 1000);
    console.log(
      `${win.slug}\t${win.language}\t${win.genre}\t` +
      `chapters: ${win.chapters.join(",")}\t` +
      `~${charsK}k chars\t` +
      `output: ${win.output_path}${partNote}${ecpaNote}`
    );
  }

  if (remaining === 0) {
    console.log("\nONTOLOGY COMPLETE");
  }
}

main();

