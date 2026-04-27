#!/usr/bin/env bun
/**
 * Reclassify variant content_type based on actual body content.
 *
 * Background: convert.ts originally tagged variants by `is_original` only.
 * For works that ship 3 variants (original-script + romanized + English),
 * BOTH the romanized and English variants had `is_original: false` and got
 * the same `content_type: translation` tag. The chapter dir then ended up
 * with `translation.md` + `translation-2.md` and the variant switcher showed
 * "English / English" instead of "English / Romanized."
 *
 * Rule: a Falsafa chapter never has two genuine English translations. So
 * any chapter with ≥2 files tagged content_type=translation contains exactly
 * one real English variant and one (or more) Romanized variants mistagged
 * at convert time. We pick the keeper by highest Modern-English stopword
 * ratio across siblings (relative — no absolute threshold) and reclassify
 * the rest as transliterations.
 *
 * Reclassified files are renamed (`translation-2.md` → `transliteration.md`,
 * sidecar `.paragraphs.json` follows), frontmatter is patched
 * (content_type, language, script + translator → transliterator byline),
 * and the chapter's meta.json variants array is updated.
 *
 * Pass --dry-run to preview without writing. Pass --apply to commit.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, unlinkSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CORPUS = resolve(ROOT, "corpus");

// ─────────────────────────────────────────────────────────────────────────
// Modern-English detector
// ─────────────────────────────────────────────────────────────────────────

/**
 * High-frequency Modern English stopwords. In any non-trivial English
 * passage, these appear in dense profusion. In Old English, romanized
 * Urdu, romanized Sanskrit, etc., they're either absent or present in
 * trace amounts.
 */
const ENGLISH_STOPWORDS = new Set([
  "the", "and", "of", "to", "a", "in", "that", "is", "was", "for",
  "it", "with", "as", "his", "be", "by", "on", "not", "this", "but",
  "are", "from", "or", "have", "an", "they", "which", "one", "you",
  "were", "her", "all", "she", "there", "would", "their", "we", "him",
  "been", "has", "when", "who", "will", "more", "no", "if", "out",
  "do", "what", "so", "up", "into", "your", "about", "just", "him",
  "should", "could", "would", "may", "might", "shall", "must",
]);

/**
 * Count Modern-English stopword occurrences in the first ~3000 characters
 * of the body. Returns the ratio: stopword_hits / total_words.
 *
 * For genuine English prose, this ratio is typically 0.30-0.40.
 * For Old English Latin-transliterated text it's <0.05.
 * For romanized Urdu / IAST-Sanskrit it's <0.02.
 *
 * We use the ratio for *relative* comparison between sibling translation
 * variants in the same chapter — no absolute threshold. Falsafa's rule is
 * that a chapter never carries two genuine English translations, so the
 * winner is always the highest-scoring sibling.
 */
function englishStopwordRatio(body: string): { ratio: number; hits: number; words: number } {
  const sample = body.slice(0, 3000).toLowerCase();
  const words = sample.split(/[^a-z']+/).filter(Boolean);
  let hits = 0;
  for (const w of words) if (ENGLISH_STOPWORDS.has(w)) hits++;
  return { ratio: words.length === 0 ? 0 : hits / words.length, hits, words: words.length };
}

// ─────────────────────────────────────────────────────────────────────────
// Frontmatter helpers
// ─────────────────────────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { fmRaw: string; body: string; fm: Record<string, string> } {
  if (!raw.startsWith("---\n")) return { fmRaw: "", body: raw, fm: {} };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { fmRaw: "", body: raw, fm: {} };
  const fmRaw = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const fm: Record<string, string> = {};
  for (const line of fmRaw.split("\n")) {
    const m = line.match(/^([\w_]+):\s*(.*)$/);
    if (m && m[2] !== undefined) fm[m[1]!] = m[2].trim();
  }
  return { fmRaw, body, fm };
}

/**
 * Patch specific frontmatter fields in-place. Preserves the original YAML's
 * formatting + ordering for unchanged fields.
 */
function patchFrontmatter(raw: string, patches: Record<string, string>): string {
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return raw;
  const fmRaw = raw.slice(4, end);
  const rest = raw.slice(end);

  const lines = fmRaw.split("\n");
  const seen = new Set<string>();
  const newLines = lines.map((line) => {
    const m = line.match(/^([\w_]+):\s*(.*)$/);
    if (!m) return line;
    const key = m[1]!;
    if (key in patches) {
      seen.add(key);
      return `${key}: ${patches[key]}`;
    }
    return line;
  });
  // Append any patches not already present
  for (const [k, v] of Object.entries(patches)) {
    if (!seen.has(k)) newLines.push(`${k}: ${v}`);
  }
  return "---\n" + newLines.join("\n") + rest;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-chapter reclassifier
// ─────────────────────────────────────────────────────────────────────────

interface ReclassifyAction {
  chapter_path: string;
  current_filename: string;
  new_filename: string; // empty string for delete actions
  current_content_type: string;
  new_content_type: string; // "deleted" for stub deletions
  reason: string;
  english_ratio: number;
}

/**
 * Threshold below which a "translation" file looks more Romanized than English
 * even on its own. Genuine English averages 0.30+, jargon-heavy English (e.g.
 * Sanskrit catalog text) drops to ~0.13–0.15, romanized Urdu/Sanskrit sits
 * below 0.05. The 0.10 floor below catches the case where every sibling is
 * Romanized (no real English in the chapter) — we then reclassify all of them.
 */
const ROMANIZED_FLOOR = 0.10;

function reclassifyChapter(chapterPath: string, dryRun: boolean): ReclassifyAction[] {
  const actions: ReclassifyAction[] = [];
  const files = readdirSync(chapterPath).filter((f) => f.endsWith(".md"));

  // The Falsafa rule: a chapter never has two genuine English translations.
  // So if the chapter dir contains ≥2 files tagged content_type=translation,
  // exactly one is the real English and the rest are Romanized text mistagged
  // at convert time. Election strategy:
  //   1. Drop empty-body translation stubs from the candidate set (they're
  //      noise from the convert pipeline; we delete them outright).
  //   2. Pick the keeper by *highest* English-stopword ratio across non-empty
  //      candidates — relative comparison handles short jargon-heavy English.
  //   3. Sanity floor: if even the keeper scores below ROMANIZED_FLOOR, no
  //      sibling is real English (e.g. one stub + one Romanized). Reclassify
  //      all candidates as transliterations.
  type Cand = { file: string; raw: string; body: string; fm: Record<string, string>; ratio: number };
  const allTranslations: Cand[] = [];
  for (const f of files) {
    const raw = readFileSync(join(chapterPath, f), "utf-8");
    const { fm, body } = parseFrontmatter(raw);
    if ((fm["content_type"] ?? "").trim() !== "translation") continue;
    const { ratio } = englishStopwordRatio(body);
    allTranslations.push({ file: f, raw, body, fm, ratio });
  }
  if (allTranslations.length < 2) return actions;

  const stubs = allTranslations.filter((t) => t.body.trim().length === 0);
  const candidates = allTranslations.filter((t) => t.body.trim().length > 0);

  // Schedule stub deletions
  for (const stub of stubs) {
    actions.push({
      chapter_path: chapterPath,
      current_filename: stub.file,
      new_filename: "",
      current_content_type: "translation",
      new_content_type: "deleted",
      reason: `Empty translation stub (0 words) — convert-time noise`,
      english_ratio: 0,
    });
    if (!dryRun) {
      const stubPath = join(chapterPath, stub.file);
      unlinkSync(stubPath);
      const stubSidecar = stubPath.replace(/\.md$/, ".paragraphs.json");
      if (existsSync(stubSidecar)) unlinkSync(stubSidecar);
    }
  }

  if (candidates.length === 0) return actions;

  // Decide losers (files to reclassify as transliteration).
  candidates.sort((a, b) => b.ratio - a.ratio);
  let losers: Cand[];
  let reasonNote: string;
  if (candidates.length === 1) {
    // After dropping stubs, only one real translation remains. If it looks
    // Romanized, reclassify it; otherwise (real English) leave alone.
    if (candidates[0]!.ratio < ROMANIZED_FLOOR) {
      losers = [candidates[0]!];
      reasonNote = `Only non-stub translation in chapter and ratio ${candidates[0]!.ratio.toFixed(3)} < floor ${ROMANIZED_FLOOR} — looks Romanized`;
    } else {
      losers = [];
      reasonNote = "";
    }
  } else if (candidates[0]!.ratio < ROMANIZED_FLOOR) {
    // Even keeper looks Romanized — no real English sibling exists.
    losers = candidates;
    reasonNote = `All candidates below floor ${ROMANIZED_FLOOR}; no real English in chapter`;
  } else {
    const keeper = candidates[0]!;
    losers = candidates.slice(1);
    reasonNote = `keeper=${keeper.file} ratio=${keeper.ratio.toFixed(3)}`;
  }

  for (const cand of losers) {
    const { file: f, raw, fm, ratio } = cand;
    const filePath = join(chapterPath, f);

    // Reclassify as transliteration. Determine target filename.
    let newFilename = "transliteration.md";
    if (newFilename !== f && existsSync(join(chapterPath, newFilename))) {
      newFilename = "transliteration-2.md";
    }

    actions.push({
      chapter_path: chapterPath,
      current_filename: f,
      new_filename: newFilename,
      current_content_type: "translation",
      new_content_type: "transliteration",
      reason: `${reasonNote}; this file ratio=${ratio.toFixed(3)}`,
      english_ratio: ratio,
    });

    if (dryRun) continue;

    // Apply the patch + rename
    const sourceLanguage = (fm["source_language"] ?? "unknown").trim();
    const patches: Record<string, string> = {
      content_type: "transliteration",
      language: sourceLanguage,
      script: "latin",
    };
    // Drop translator byline; add transliterator byline
    let patched = patchFrontmatter(raw, patches);
    patched = patched.replace(/^translator:.*\n/m, "");
    if (!/^transliterator:/m.test(patched)) {
      // Insert before the closing --- in frontmatter
      patched = patched.replace(/^---\s*$/m, "transliterator: thothica\n---");
    }
    writeFileSync(filePath, patched, "utf-8");

    // Rename the .md file
    if (newFilename !== f) {
      renameSync(filePath, join(chapterPath, newFilename));
      // Rename the paragraphs.json sidecar too
      const oldSidecar = filePath.replace(/\.md$/, ".paragraphs.json");
      const newSidecar = join(chapterPath, newFilename.replace(/\.md$/, ".paragraphs.json"));
      if (existsSync(oldSidecar)) renameSync(oldSidecar, newSidecar);
    }
  }

  return actions;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-chapter meta.json updater
// ─────────────────────────────────────────────────────────────────────────

function updateChapterMeta(chapterPath: string, actions: ReclassifyAction[]): void {
  const metaPath = join(chapterPath, "meta.json");
  if (!existsSync(metaPath)) return;
  const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
    default_variant: string;
    variants: Array<Record<string, unknown>>;
  };

  // Build maps: filenames to delete, and filenames to rename old → new.
  const toDelete = new Set<string>();
  const rename = new Map<string, string>();
  for (const a of actions) {
    if (a.new_content_type === "deleted") toDelete.add(a.current_filename);
    else rename.set(a.current_filename, a.new_filename);
  }

  // Drop deleted variants outright; rename + retag the rest.
  meta.variants = meta.variants.filter((v) => !toDelete.has(v["file"] as string));
  for (const v of meta.variants) {
    const oldFile = v["file"] as string;
    if (rename.has(oldFile)) {
      v["file"] = rename.get(oldFile)!;
      v["content_type"] = "transliteration";
    }
  }

  // Update default_variant if it pointed to a renamed or deleted file.
  // Falsafa's default-variant preference: English first (when present),
  // then Romanized, then Original. The MCP and reader both expect English
  // as the canonical reading surface; the transliteration is a fallback
  // when no English translation exists in the chapter.
  if (toDelete.has(meta.default_variant) || rename.has(meta.default_variant)) {
    const trans = meta.variants.find((v) => v["content_type"] === "translation");
    const tlit = meta.variants.find((v) => v["content_type"] === "transliteration");
    const orig = meta.variants.find((v) => v["content_type"] === "original");
    meta.default_variant = (trans?.file ?? tlit?.file ?? orig?.file ?? meta.variants[0]?.file ?? "translation.md") as string;
  }

  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────
// Walk corpus
// ─────────────────────────────────────────────────────────────────────────

function listChapterDirs(workSlug: string): string[] {
  const chaptersDir = join(CORPUS, "works", workSlug, "chapters");
  if (!existsSync(chaptersDir)) return [];
  return readdirSync(chaptersDir)
    .filter((d) => statSync(join(chaptersDir, d)).isDirectory())
    .map((d) => join(chaptersDir, d));
}

interface CliArgs {
  apply: boolean;
  dryRun: boolean;
  only: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, dryRun: true, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") {
      args.apply = true;
      args.dryRun = false;
    } else if (a === "--dry-run") {
      args.dryRun = true;
      args.apply = false;
    } else if (a === "--only") args.only = argv[++i] ?? null;
    else if (a?.startsWith("--only=")) args.only = a.slice("--only=".length);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf-8")) as {
    works: Array<{ slug: string; title: string }>;
  };

  let totalActions = 0;
  const byWork = new Map<string, ReclassifyAction[]>();

  for (const w of manifest.works) {
    if (args.only && w.slug !== args.only) continue;
    const chapterDirs = listChapterDirs(w.slug);
    const workActions: ReclassifyAction[] = [];
    for (const cp of chapterDirs) {
      const actions = reclassifyChapter(cp, args.dryRun);
      workActions.push(...actions);
      if (!args.dryRun && actions.length > 0) {
        updateChapterMeta(cp, actions);
      }
    }
    if (workActions.length > 0) {
      byWork.set(w.slug, workActions);
      totalActions += workActions.length;
    }
  }

  // Report
  console.log(`Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Total reclassifications: ${totalActions} across ${byWork.size} works\n`);
  for (const [slug, actions] of byWork) {
    console.log(`── ${slug}: ${actions.length} variant(s) ──`);
    const sample = actions.slice(0, 3);
    for (const a of sample) {
      const dir = a.chapter_path.replace(CORPUS + "/works/", "");
      const arrow = a.new_content_type === "deleted" ? "DELETE" : `→ ${a.new_filename}`;
      console.log(`   ${dir} :: ${a.current_filename} ${arrow} (en-ratio ${a.english_ratio.toFixed(3)})`);
    }
    if (actions.length > 3) console.log(`   ...and ${actions.length - 3} more action(s)`);
  }
  console.log("");
  console.log(args.apply ? `Applied. Re-run the dev server (or refresh) to see the corrected variants.` : `Dry-run done. Re-run with --apply to commit.`);
}

main();
