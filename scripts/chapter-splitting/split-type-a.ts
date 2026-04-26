#!/usr/bin/env bun
/**
 * TYPE_A chapter splitter — auto-splits works whose verse markers carry
 * a chapter index (Mn_1.5, Yj_2.10, Vi_50.3 etc).
 *
 * Pipeline (per work):
 *   1. Read every variant file under chapters/01/.
 *   2. Parse verse markers; filter to native prefix (drop citation prefixes).
 *   3. Split body by chapter, producing one ChapterSlice per chapter.
 *   4. Validate per-variant (marker preservation, content conservation,
 *      round-trip integrity, verse monotonicity, no-empty-chapter).
 *   5. Validate cross-variant (every variant produces the same chapter set).
 *   6. STOP if any error-level validator fails. Print diagnostics, exit.
 *   7. If --dry-run: print summary and exit without writing.
 *   8. Else: stage new chapter directories under .staging/, validate
 *      post-write, and atomically swap into place. Update meta.json,
 *      paragraph sidecars, the work's index.md, and corpus/manifest.json.
 *
 * Usage:
 *   bun run scripts/chapter-splitting/split-type-a.ts --dry-run
 *   bun run scripts/chapter-splitting/split-type-a.ts --only unknown-yajnavalkya-smrti-cb88d6
 *   bun run scripts/chapter-splitting/split-type-a.ts --apply        # actually writes
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  parseVerseMarkers,
  filterToNativePrefix,
  findMarkerAnomalies,
  dropImplausibleMarkers,
  dropBackwardsMarkers,
  type VerseMarker,
} from "./lib/parser.ts";
import { splitBodyByChapter, type ChapterSlice } from "./lib/splitter.ts";
import { validateVariant, validateAcrossVariants, validatePostWrite, type ValidationIssue } from "./lib/validators.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = resolve(ROOT, "corpus");
const DISCOVERY_PATH = resolve(import.meta.dir, "discovery.json");

// ─────────────────────────────────────────────────────────────────────────
// Types from the discovery sidecar
// ─────────────────────────────────────────────────────────────────────────

interface DiscoveryPlan {
  slug: string;
  title: string;
  classification: string;
  detected_chapters_proposed: number | null;
  per_variant_chapter_count_match: boolean | null;
  splitting_pattern_hint: string | null;
}

interface DiscoveryFile {
  generated_at: string;
  plans: DiscoveryPlan[];
}

interface ManifestEntry {
  slug: string;
  title: string;
  author: string;
  era: string;
  language: string;
  total_logical_chapters: number;
  total_variant_entries: number;
}

interface Manifest {
  works: ManifestEntry[];
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────
// Frontmatter helpers (re-implemented; YAML is uniform in our corpus)
// ─────────────────────────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { fmRaw: string; fm: Record<string, string>; body: string } {
  if (!raw.startsWith("---\n")) return { fmRaw: "", fm: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { fmRaw: "", fm: {}, body: raw };
  const fmRaw = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const fm: Record<string, string> = {};
  for (const line of fmRaw.split("\n")) {
    const m = line.match(/^([\w_]+):\s*(.*)$/);
    if (m && m[2] !== undefined) fm[m[1]!] = m[2].trim();
  }
  return { fmRaw, fm, body };
}

function unquote(v: string): string {
  if (v.startsWith('"') && v.endsWith('"')) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  return v;
}

function buildFrontmatter(fields: Record<string, string | number | null>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && (/[:#'"]/.test(v) || /^\s|\s$/.test(v))) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Slug, paragraph hashing
// ─────────────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function chapterDirName(chapterNumber: number, chapterTitle: string | null): string {
  // Default to NN-chapter-N. If we have a real title, slugify and append.
  const base = pad2(chapterNumber);
  if (!chapterTitle || /^chapter\s*\d+$/i.test(chapterTitle.trim())) {
    return base;
  }
  const slug = chapterTitle
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug ? `${base}-${slug}` : base;
}

function fnv1a32(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function computeParagraphIds(content: string): { id: string; offset: number; text: string }[] {
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim());
  const ids: { id: string; offset: number; text: string }[] = [];
  let offset = 0;
  for (const para of paragraphs) {
    const trimmed = para.trim();
    const id = `p-${fnv1a32(trimmed).slice(0, 6)}`;
    ids.push({ id, offset, text: trimmed });
    offset += trimmed.length + 2;
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-variant work plan
// ─────────────────────────────────────────────────────────────────────────

interface VariantPlan {
  /** Filename in the existing chapter dir (e.g. "translation.md"). */
  filename: string;
  fmRaw: string;
  fm: Record<string, string>;
  body: string;
  body_after_split_prelude: string;
  native_prefix: string;
  native_markers: VerseMarker[];
  citation_markers: VerseMarker[];
  slices: ChapterSlice[];
}

interface WorkPlan {
  slug: string;
  title: string;
  existing_chapter_dir: string;
  /** Variants that have native markers and are part of the split. */
  variants: VariantPlan[];
  /** Chapter numbers all variants agreed on. */
  chapter_numbers: number[];
}

function planWork(slug: string): WorkPlan {
  const chaptersDir = join(CORPUS, "works", slug, "chapters");
  if (!existsSync(chaptersDir)) {
    throw new Error(`Work ${slug}: chapters/ missing`);
  }
  const chapterDirs = readdirSync(chaptersDir).filter((d) => statSync(join(chaptersDir, d)).isDirectory());
  if (chapterDirs.length !== 1) {
    throw new Error(`Work ${slug}: expected exactly 1 existing chapter dir for TYPE_A split, found ${chapterDirs.length}`);
  }
  const existingChapterDir = chapterDirs[0]!;
  const chapterPath = join(chaptersDir, existingChapterDir);
  const variantFiles = readdirSync(chapterPath).filter((f) => f.endsWith(".md") && !f.endsWith(".paragraphs.json"));

  const variants: VariantPlan[] = [];
  for (const f of variantFiles) {
    const raw = readFileSync(join(chapterPath, f), "utf-8");
    const { fmRaw, fm, body } = parseFrontmatter(raw);
    const allMarkers = parseVerseMarkers(body);
    const { native_prefix, native_markers: rawNativeMarkers, citation_markers } = filterToNativePrefix(allMarkers);
    // Drop implausible chapter numbers (concatenation glitches like "Nar_1516")
    const { kept: plausibleMarkers, dropped: dropped_implausible } = dropImplausibleMarkers(rawNativeMarkers);
    // Drop backwards/duplicate markers (inline citations that survived the paragraph-end heuristic)
    const { kept: native_markers, dropped: dropped_backwards } = dropBackwardsMarkers(plausibleMarkers);
    if (dropped_implausible.length > 0) {
      console.log(`  ${f}: dropped ${dropped_implausible.length} implausible marker(s) (chapter > 250) — source-format glitches`);
    }
    if (dropped_backwards.length > 0) {
      const samples = dropped_backwards.slice(0, 3).map((m) => `${m.prefix}_${m.chapter}.${m.verse}`).join(", ");
      console.log(`  ${f}: dropped ${dropped_backwards.length} backwards/duplicate marker(s) — inline citations [${samples}${dropped_backwards.length > 3 ? ", …" : ""}]`);
    }
    if (native_markers.length === 0) {
      variants.push({
        filename: f,
        fmRaw,
        fm,
        body,
        body_after_split_prelude: body,
        native_prefix: "",
        native_markers: [],
        citation_markers,
        slices: [],
      });
      continue;
    }
    const slices = splitBodyByChapter(body, native_markers);
    variants.push({
      filename: f,
      fmRaw,
      fm,
      body,
      body_after_split_prelude: body,
      native_prefix,
      native_markers,
      citation_markers,
      slices,
    });
  }

  // Collect the chapter numbers from every variant; use the union (validators
  // will catch disagreements).
  const allChapters = new Set<number>();
  for (const v of variants) {
    for (const s of v.slices) allChapters.add(s.chapter);
  }
  const chapter_numbers = [...allChapters].sort((a, b) => a - b);

  // Use translation variant's title where possible
  const titleVariant = variants.find((v) => unquote(v.fm["work_title"] ?? "") !== "");
  const title = titleVariant ? unquote(titleVariant.fm["work_title"] ?? slug) : slug;

  return {
    slug,
    title,
    existing_chapter_dir: existingChapterDir,
    variants,
    chapter_numbers,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Validation phase
// ─────────────────────────────────────────────────────────────────────────

function validatePlan(plan: WorkPlan): { ok: boolean; issues: ValidationIssue[] } {
  const allIssues: ValidationIssue[] = [];

  // Per-variant validation
  for (const v of plan.variants) {
    if (v.slices.length === 0) {
      allIssues.push({
        validator: "variant-no-markers",
        severity: "warn",
        message: `[${v.filename}] no native markers found — this variant will not be split (will copy whole-body into chapter 1 of the new structure)`,
      });
      continue;
    }
    // Marker anomalies first
    const anomalies = findMarkerAnomalies(v.native_markers);
    for (const a of anomalies) {
      allIssues.push({
        validator: `marker-${a.kind}`,
        severity: a.kind === "duplicate_verse" ? "warn" : "error",
        message: `[${v.filename}] ${a.message}`,
      });
    }
    const r = validateVariant({
      variant_label: v.filename,
      body: v.body,
      native_prefix: v.native_prefix,
      native_markers: v.native_markers,
      slices: v.slices,
    });
    allIssues.push(...r.issues);
  }

  // Cross-variant — pass ALL variants in (the validator's variant-coverage
  // check needs to see no-marker variants so it can flag them as drop-risk).
  const r = validateAcrossVariants({
    variants: plan.variants.map((v) => ({ label: v.filename, slices: v.slices })),
  });
  allIssues.push(...r.issues);

  return { ok: allIssues.every((i) => i.severity !== "error"), issues: allIssues };
}

// ─────────────────────────────────────────────────────────────────────────
// Write phase — staging directory then atomic swap
// ─────────────────────────────────────────────────────────────────────────

function writeSplitToStaging(plan: WorkPlan): string {
  const stagingRoot = resolve(CORPUS, ".staging-split", plan.slug, "chapters");
  if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  // For each chapter, write its variant files + paragraph sidecars + meta.json
  for (const chapterNum of plan.chapter_numbers) {
    const chapterDir = chapterDirName(chapterNum, null); // default to "NN" for now
    const chapterDirAbs = join(stagingRoot, chapterDir);
    mkdirSync(chapterDirAbs, { recursive: true });

    const variantsForChapter: Record<string, unknown>[] = [];
    let defaultVariantFile: string | null = null;

    for (const v of plan.variants) {
      const slice = v.slices.find((s) => s.chapter === chapterNum);
      // If this variant has no slice for this chapter, skip writing this variant
      if (!slice) continue;

      // Build new frontmatter for this chapter
      const original = v.fm;
      const newFm: Record<string, string | number | null> = {
        work_id: unquote(original["work_id"] ?? ""),
        work_slug: unquote(original["work_slug"] ?? plan.slug),
        work_title: unquote(original["work_title"] ?? plan.title),
        author_name: unquote(original["author_name"] ?? ""),
        chapter_number: chapterNum,
        chapter_title: `Chapter ${chapterNum}`,
        chapter_slug: chapterDir,
        variant_id: unquote(original["variant_id"] ?? ""),
        content_type: unquote(original["content_type"] ?? ""),
        layout: unquote(original["layout"] ?? "verse"),
        language: unquote(original["language"] ?? ""),
        source_language: unquote(original["source_language"] ?? ""),
        language_direction: unquote(original["language_direction"] ?? "ltr"),
        script: unquote(original["script"] ?? ""),
        word_count: slice.content.trim().split(/\s+/).filter(Boolean).length,
        estimated_read_time: original["estimated_read_time"] ? parseInt(original["estimated_read_time"], 10) : null,
        source_url: original["source_url"] ? unquote(original["source_url"]) : null,
      };
      // Byline fields if present in original
      for (const k of ["translator", "transliterator", "curator"]) {
        if (original[k]) newFm[k] = unquote(original[k]!);
      }

      const fmText = buildFrontmatter(newFm);
      const fileBody = `${fmText}\n\n${slice.content.trim()}\n`;
      writeFileSync(join(chapterDirAbs, v.filename), fileBody, "utf-8");

      // Paragraph sidecar
      const paraIds = computeParagraphIds(slice.content);
      const sidecarName = v.filename.replace(/\.md$/, ".paragraphs.json");
      writeFileSync(join(chapterDirAbs, sidecarName), JSON.stringify(paraIds, null, 2), "utf-8");

      const variantEntry = {
        file: v.filename,
        content_type: unquote(original["content_type"] ?? ""),
        variant_id: unquote(original["variant_id"] ?? ""),
        language: unquote(original["language"] ?? ""),
        source_language: unquote(original["source_language"] ?? ""),
        script: unquote(original["script"] ?? ""),
        word_count: newFm.word_count,
        paragraph_count: paraIds.length,
        has_image: false,
        source_url: original["source_url"] ? unquote(original["source_url"]) : null,
      };
      variantsForChapter.push(variantEntry);

      // Pick a default — prefer translation, else original, else first
      const ct = unquote(original["content_type"] ?? "");
      if (ct === "translation") defaultVariantFile = v.filename;
      else if (defaultVariantFile === null && ct === "original") defaultVariantFile = v.filename;
      else if (defaultVariantFile === null) defaultVariantFile = v.filename;
    }

    // meta.json for this chapter
    const layoutForChapter = (variantsForChapter[0] as { content_type?: string })?.content_type
      ? "verse"
      : "verse";
    const meta = {
      work_slug: plan.slug,
      work_title: plan.title,
      chapter_number: chapterNum,
      chapter_title: `Chapter ${chapterNum}`,
      chapter_slug: chapterDir,
      layout: layoutForChapter,
      layouts_in_variants: ["verse"],
      default_variant: defaultVariantFile ?? "translation.md",
      variants: variantsForChapter,
    };
    writeFileSync(join(chapterDirAbs, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  }

  return stagingRoot;
}

function commitSplit(plan: WorkPlan): { newChaptersDir: string } {
  const stagingChaptersDir = resolve(CORPUS, ".staging-split", plan.slug, "chapters");
  const realChaptersDir = resolve(CORPUS, "works", plan.slug, "chapters");
  const backupDir = resolve(CORPUS, ".staging-split", plan.slug, "chapters.backup");

  // Move existing chapters/ → backup, then move staging → real, then remove backup.
  if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
  if (existsSync(realChaptersDir)) renameSync(realChaptersDir, backupDir);
  renameSync(stagingChaptersDir, realChaptersDir);
  // Keep backup in .staging-split until we're sure things are good
  return { newChaptersDir: realChaptersDir };
}

function updateWorkIndex(plan: WorkPlan): void {
  const indexPath = join(CORPUS, "works", plan.slug, "index.md");
  if (!existsSync(indexPath)) return;
  const raw = readFileSync(indexPath, "utf-8");
  const { fmRaw, body } = parseFrontmatter(raw);

  // Rewrite frontmatter fields total_logical_chapters + total_variant_entries
  const totalLogical = plan.chapter_numbers.length;
  const variantsPerChapter = plan.variants.filter((v) => v.slices.length > 0).length;
  const totalVariantEntries = totalLogical * variantsPerChapter;

  const lines = fmRaw.split("\n");
  const updatedLines: string[] = [];
  let sawLogical = false;
  let sawVariantEntries = false;
  for (const line of lines) {
    if (line.startsWith("total_logical_chapters:")) {
      updatedLines.push(`total_logical_chapters: ${totalLogical}`);
      sawLogical = true;
    } else if (line.startsWith("total_variant_entries:")) {
      updatedLines.push(`total_variant_entries: ${totalVariantEntries}`);
      sawVariantEntries = true;
    } else {
      updatedLines.push(line);
    }
  }
  if (!sawLogical) updatedLines.push(`total_logical_chapters: ${totalLogical}`);
  if (!sawVariantEntries) updatedLines.push(`total_variant_entries: ${totalVariantEntries}`);

  const newFmText = "---\n" + updatedLines.join("\n") + "\n---";

  // Rebuild the body's chapter list section
  const newChapterList = plan.chapter_numbers
    .map((n) => {
      const dir = chapterDirName(n, null);
      return `${pad2(n)}. [Chapter ${n}](./chapters/${dir}/) — verse, ${plan.variants.filter((v) => v.slices.find((s) => s.chapter === n)).length} variant${plan.variants.length === 1 ? "" : "s"}`;
    })
    .join("\n");
  const splitBody = body.split(/^## Chapters\s*$/m);
  const preChapters = splitBody[0] ?? "";
  const newBody = `${preChapters.trimEnd()}\n\n## Chapters\n\n${newChapterList}\n`;

  writeFileSync(indexPath, `${newFmText}\n\n${newBody}`, "utf-8");
}

function updateManifest(plan: WorkPlan): void {
  const manifestPath = join(CORPUS, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
  const work = manifest.works.find((w) => w.slug === plan.slug);
  if (!work) return;
  work.total_logical_chapters = plan.chapter_numbers.length;
  const variantsPerChapter = plan.variants.filter((v) => v.slices.length > 0).length;
  work.total_variant_entries = plan.chapter_numbers.length * variantsPerChapter;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

interface Args {
  only: string | null;
  apply: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { only: null, apply: false, dryRun: true };
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

function summarizePlan(plan: WorkPlan): void {
  console.log(`\n=== ${plan.title} (${plan.slug}) ===`);
  console.log(`  Detected chapters: ${plan.chapter_numbers.length} (${plan.chapter_numbers.slice(0, 8).join(", ")}${plan.chapter_numbers.length > 8 ? ", …" : ""})`);
  for (const v of plan.variants) {
    if (v.slices.length === 0) {
      console.log(`  ${v.filename}: ⚠️  no native markers; will not be split`);
    } else {
      const verseTotal = v.native_markers.length;
      const versesByChapter = v.slices.map((s) => s.markers.length);
      const minV = Math.min(...versesByChapter);
      const maxV = Math.max(...versesByChapter);
      console.log(`  ${v.filename}: prefix='${v.native_prefix}', ${v.slices.length} chapters, ${verseTotal} verses (per-chapter min=${minV} max=${maxV})${v.citation_markers.length > 0 ? `, ${v.citation_markers.length} citation markers ignored` : ""}`);
    }
  }
}

function printIssues(issues: ValidationIssue[]): void {
  if (issues.length === 0) {
    console.log("  ✓ all validators passed");
    return;
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity === "warn");
  if (errors.length) console.log(`  ✗ ${errors.length} error${errors.length === 1 ? "" : "s"}:`);
  for (const e of errors) console.log(`    ERROR [${e.validator}] ${e.message}`);
  if (warns.length) console.log(`  ⚠ ${warns.length} warning${warns.length === 1 ? "" : "s"}:`);
  for (const w of warns) console.log(`    WARN  [${w.validator}] ${w.message}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const discovery = JSON.parse(readFileSync(DISCOVERY_PATH, "utf-8")) as DiscoveryFile;
  const typeAPlans = discovery.plans.filter((p) => p.classification === "TYPE_A");
  let scopedPlans = typeAPlans;
  if (args.only) {
    scopedPlans = typeAPlans.filter((p) => p.slug === args.only);
    if (scopedPlans.length === 0) {
      console.error(`No TYPE_A work matches slug: ${args.only}`);
      process.exit(1);
    }
  }
  console.log(`Mode: ${args.apply ? "APPLY (will write)" : "DRY-RUN (no changes)"}`);
  console.log(`Works to process: ${scopedPlans.length}`);

  let allOk = true;
  let appliedCount = 0;

  for (const dp of scopedPlans) {
    let plan: WorkPlan;
    try {
      plan = planWork(dp.slug);
    } catch (err) {
      console.error(`\n${dp.slug}: PLANNING FAILED — ${(err as Error).message}`);
      allOk = false;
      continue;
    }
    summarizePlan(plan);

    const validation = validatePlan(plan);
    printIssues(validation.issues);

    if (!validation.ok) {
      console.log(`  → SKIPPED (validation failed)`);
      allOk = false;
      continue;
    }

    if (args.dryRun) {
      console.log(`  → DRY-RUN ok, would write ${plan.chapter_numbers.length} chapters`);
      continue;
    }

    // Stage write
    writeSplitToStaging(plan);

    // Commit (rename swap)
    commitSplit(plan);

    // Post-write validation
    const expectedMarkers = new Map<string, Set<string>>();
    for (const v of plan.variants) {
      for (const s of v.slices) {
        const ct = unquote(v.fm["content_type"] ?? "");
        const key = `${v.filename.replace(/\.md$/, "")}|${s.chapter}`;
        const _ = key; // (would map content_type to a label, but we use filename minus .md)
        const k = `${v.filename.split(".")[0]}|${s.chapter}`;
        if (!expectedMarkers.has(k)) expectedMarkers.set(k, new Set());
        const set = expectedMarkers.get(k)!;
        for (const m of s.markers) set.add(`${m.chapter}.${m.verse}`);
      }
    }
    const variantLabels = [...new Set(plan.variants.map((v) => v.filename.replace(/\.md$/, "")))];
    const postReport = validatePostWrite({
      work_slug: plan.slug,
      corpus_root: CORPUS,
      expected_chapter_numbers: plan.chapter_numbers,
      expected_variants_per_chapter: variantLabels,
      expected_markers_by_chapter: expectedMarkers,
    });
    if (!postReport.ok) {
      console.error(`  ✗ POST-WRITE validation FAILED for ${plan.slug}:`);
      printIssues(postReport.issues);
      console.error(`    Backup directory left at corpus/.staging-split/${plan.slug}/chapters.backup — restore manually.`);
      allOk = false;
      continue;
    }

    // Update index.md and manifest.json
    updateWorkIndex(plan);
    updateManifest(plan);

    console.log(`  → APPLIED. ${plan.chapter_numbers.length} chapters written. Backup left under corpus/.staging-split/${plan.slug}/`);
    appliedCount++;
  }

  if (args.apply) {
    console.log(`\nApplied to ${appliedCount} works.`);
    if (!allOk) process.exit(1);
  } else {
    console.log(`\nDry-run complete. Use --apply to write.`);
    if (!allOk) process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
