#!/usr/bin/env bun
/**
 * Generic chapter-splitting orchestrator.
 *
 * Originally extracted from split-type-a.ts so TYPE_C (prose-heading) and
 * one-off bespoke splitters share the same pipeline:
 *
 *     planWork(slug, parseFunc)        — read variants, parse, slice
 *  → validatePlan(plan)                — per-variant + cross-variant checks
 *  → summarizePlan(plan)               — print humanised summary
 *  → if --dry-run: stop                  (validation result printed)
 *  → writeSplitToStaging(plan)         — emit new chapter dirs into a staging tree
 *  → commitSplit(plan)                 — atomic rename swap; backup retained
 *  → validatePostWriteForPlan(plan)    — verify on-disk shape + markers
 *  → updateWorkIndex(plan)             — patch index.md aggregates + chapter list
 *  → updateManifest(plan)              — patch corpus/manifest.json counts
 *
 * Each entry-point script (split-type-a.ts, split-type-c.ts, oneoffs/*.ts)
 * supplies a `parseFunc(body, label)` that returns the marker stream and
 * cut semantics for its work-type. Everything downstream is shared.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  rmSync,
  renameSync,
} from "node:fs";
import { resolve, join } from "node:path";
import {
  findMarkerAnomalies,
  type VerseMarker,
} from "./parser.ts";
import { splitBodyByChapter, type ChapterSlice, type MarkerPosition } from "./splitter.ts";
import {
  validateVariant,
  validateAcrossVariants,
  validatePostWrite,
  type ValidationIssue,
} from "./validators.ts";

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

/** Parser callback contract — one call per variant, returns the markers
 *  and the cut semantics. Optional dropped/diagnostic fields propagate to
 *  summary log lines. */
export interface ParseResult {
  /** A short label (e.g. "Mn", "Ang", "Ch") used in error messages. */
  native_prefix: string;
  /** The markers we'll actually slice on. */
  native_markers: VerseMarker[];
  /** Markers from a different prefix that we ignored (citations etc). */
  citation_markers: VerseMarker[];
  /** Cut semantics — see splitter.ts. */
  marker_position: MarkerPosition;
  /** Diagnostic notes to print during summary (e.g. "dropped N implausible"). */
  notes?: string[];
}

export type ParseFunc = (body: string, filename: string) => ParseResult;

export interface VariantPlan {
  /** Filename in the existing chapter dir (e.g. "translation.md"). */
  filename: string;
  fmRaw: string;
  fm: Record<string, string>;
  body: string;
  native_prefix: string;
  native_markers: VerseMarker[];
  citation_markers: VerseMarker[];
  marker_position: MarkerPosition;
  notes: string[];
  slices: ChapterSlice[];
}

export interface WorkPlan {
  slug: string;
  title: string;
  existing_chapter_dir: string;
  /** Variants discovered in the existing chapter dir. */
  variants: VariantPlan[];
  /** Chapter numbers across all variants (union). */
  chapter_numbers: number[];
}

interface ManifestEntry {
  slug: string;
  total_logical_chapters: number;
  total_variant_entries: number;
  [k: string]: unknown;
}

interface Manifest {
  works: ManifestEntry[];
  [k: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────
// Frontmatter helpers (shared across entry points)
// ─────────────────────────────────────────────────────────────────────────

export function parseFrontmatter(raw: string): { fmRaw: string; fm: Record<string, string>; body: string } {
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

export function unquote(v: string): string {
  if (v.startsWith('"') && v.endsWith('"')) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  return v;
}

export function buildFrontmatter(fields: Record<string, string | number | null>): string {
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

export function chapterDirName(chapterNumber: number, chapterTitle: string | null): string {
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

export function computeParagraphIds(content: string): { id: string; offset: number; text: string }[] {
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
// Plan phase
// ─────────────────────────────────────────────────────────────────────────

export interface PlanWorkOptions {
  corpusRoot: string;
  parseFunc: ParseFunc;
  /** If a variant produces zero markers, what to title it for diagnostics. */
  variantHint?: (filename: string, fm: Record<string, string>) => string;
}

export function planWork(slug: string, opts: PlanWorkOptions): WorkPlan {
  const chaptersDir = join(opts.corpusRoot, "works", slug, "chapters");
  if (!existsSync(chaptersDir)) {
    throw new Error(`Work ${slug}: chapters/ missing`);
  }
  const chapterDirs = readdirSync(chaptersDir).filter((d) => statSync(join(chaptersDir, d)).isDirectory());
  if (chapterDirs.length !== 1) {
    throw new Error(`Work ${slug}: expected exactly 1 existing chapter dir for split, found ${chapterDirs.length}`);
  }
  const existingChapterDir = chapterDirs[0]!;
  const chapterPath = join(chaptersDir, existingChapterDir);
  const variantFiles = readdirSync(chapterPath).filter((f) => f.endsWith(".md") && !f.endsWith(".paragraphs.json"));

  const variants: VariantPlan[] = [];
  for (const f of variantFiles) {
    const raw = readFileSync(join(chapterPath, f), "utf-8");
    const { fmRaw, fm, body } = parseFrontmatter(raw);
    const result = opts.parseFunc(body, f);
    const slices = result.native_markers.length === 0
      ? []
      : splitBodyByChapter(body, result.native_markers, result.marker_position);
    variants.push({
      filename: f,
      fmRaw,
      fm,
      body,
      native_prefix: result.native_prefix,
      native_markers: result.native_markers,
      citation_markers: result.citation_markers,
      marker_position: result.marker_position,
      notes: result.notes ?? [],
      slices,
    });
  }

  const allChapters = new Set<number>();
  for (const v of variants) {
    for (const s of v.slices) allChapters.add(s.chapter);
  }
  const chapter_numbers = [...allChapters].sort((a, b) => a - b);

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
// Validation
// ─────────────────────────────────────────────────────────────────────────

export function validatePlan(plan: WorkPlan): { ok: boolean; issues: ValidationIssue[] } {
  const allIssues: ValidationIssue[] = [];

  for (const v of plan.variants) {
    if (v.slices.length === 0) {
      allIssues.push({
        validator: "variant-no-markers",
        severity: "warn",
        message: `[${v.filename}] no native markers found — this variant will not be split (will copy whole-body into chapter 1 of the new structure)`,
      });
      continue;
    }
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

  const r = validateAcrossVariants({
    variants: plan.variants.map((v) => ({ label: v.filename, slices: v.slices })),
  });
  allIssues.push(...r.issues);

  return { ok: allIssues.every((i) => i.severity !== "error"), issues: allIssues };
}

// ─────────────────────────────────────────────────────────────────────────
// Write phase
// ─────────────────────────────────────────────────────────────────────────

export function writeSplitToStaging(plan: WorkPlan, corpusRoot: string): string {
  const stagingRoot = resolve(corpusRoot, ".staging-split", plan.slug, "chapters");
  if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  for (const chapterNum of plan.chapter_numbers) {
    const chapterDir = chapterDirName(chapterNum, null);
    const chapterDirAbs = join(stagingRoot, chapterDir);
    mkdirSync(chapterDirAbs, { recursive: true });

    const variantsForChapter: Record<string, unknown>[] = [];
    let defaultVariantFile: string | null = null;

    for (const v of plan.variants) {
      const slice = v.slices.find((s) => s.chapter === chapterNum);
      if (!slice) continue;

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
      for (const k of ["translator", "transliterator", "curator"]) {
        if (original[k]) newFm[k] = unquote(original[k]!);
      }

      const fmText = buildFrontmatter(newFm);
      const fileBody = `${fmText}\n\n${slice.content.trim()}\n`;
      writeFileSync(join(chapterDirAbs, v.filename), fileBody, "utf-8");

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

      const ct = unquote(original["content_type"] ?? "");
      if (ct === "translation") defaultVariantFile = v.filename;
      else if (defaultVariantFile === null && ct === "original") defaultVariantFile = v.filename;
      else if (defaultVariantFile === null) defaultVariantFile = v.filename;
    }

    const layoutForChapter = unquote(plan.variants[0]?.fm["layout"] ?? "verse");
    const meta = {
      work_slug: plan.slug,
      work_title: plan.title,
      chapter_number: chapterNum,
      chapter_title: `Chapter ${chapterNum}`,
      chapter_slug: chapterDir,
      layout: layoutForChapter,
      layouts_in_variants: [layoutForChapter],
      default_variant: defaultVariantFile ?? "translation.md",
      variants: variantsForChapter,
    };
    writeFileSync(join(chapterDirAbs, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  }

  return stagingRoot;
}

export function commitSplit(plan: WorkPlan, corpusRoot: string): { newChaptersDir: string } {
  const stagingChaptersDir = resolve(corpusRoot, ".staging-split", plan.slug, "chapters");
  const realChaptersDir = resolve(corpusRoot, "works", plan.slug, "chapters");
  const backupDir = resolve(corpusRoot, ".staging-split", plan.slug, "chapters.backup");

  if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
  if (existsSync(realChaptersDir)) renameSync(realChaptersDir, backupDir);
  renameSync(stagingChaptersDir, realChaptersDir);
  return { newChaptersDir: realChaptersDir };
}

export function validatePostWriteForPlan(plan: WorkPlan, corpusRoot: string): { ok: boolean; issues: ValidationIssue[] } {
  // The per-marker post-write check is TYPE_A-specific — it parses the
  // on-disk body for `Prefix_N.M` verse tokens and compares against the
  // expected slice markers. For "before_chapter" parsers (TYPE_C, prose
  // headings), markers are synthesized from heading positions and don't
  // appear on disk in `Prefix_N.M` form, so the check would always fail.
  // We skip it for those variants by leaving their expected sets empty.
  const expectedMarkers = new Map<string, Set<string>>();
  for (const v of plan.variants) {
    if (v.marker_position !== "after_chapter") continue;
    for (const s of v.slices) {
      const k = `${v.filename.split(".")[0]}|${s.chapter}`;
      if (!expectedMarkers.has(k)) expectedMarkers.set(k, new Set());
      const set = expectedMarkers.get(k)!;
      for (const m of s.markers) set.add(`${m.chapter}.${m.verse}`);
    }
  }
  const variantLabels = [...new Set(plan.variants.map((v) => v.filename.replace(/\.md$/, "")))];
  return validatePostWrite({
    work_slug: plan.slug,
    corpus_root: corpusRoot,
    expected_chapter_numbers: plan.chapter_numbers,
    expected_variants_per_chapter: variantLabels,
    expected_markers_by_chapter: expectedMarkers,
  });
}

export function updateWorkIndex(plan: WorkPlan, corpusRoot: string): void {
  const indexPath = join(corpusRoot, "works", plan.slug, "index.md");
  if (!existsSync(indexPath)) return;
  const raw = readFileSync(indexPath, "utf-8");
  const { fmRaw, body } = parseFrontmatter(raw);

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

  const newChapterList = plan.chapter_numbers
    .map((n) => {
      const dir = chapterDirName(n, null);
      const variantCount = plan.variants.filter((v) => v.slices.find((s) => s.chapter === n)).length;
      return `${pad2(n)}. [Chapter ${n}](./chapters/${dir}/) — verse, ${variantCount} variant${variantCount === 1 ? "" : "s"}`;
    })
    .join("\n");
  const splitBody = body.split(/^## Chapters\s*$/m);
  const preChapters = splitBody[0] ?? "";
  const newBody = `${preChapters.trimEnd()}\n\n## Chapters\n\n${newChapterList}\n`;

  writeFileSync(indexPath, `${newFmText}\n\n${newBody}`, "utf-8");
}

export function updateManifest(plan: WorkPlan, corpusRoot: string): void {
  const manifestPath = join(corpusRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Manifest;
  const work = manifest.works.find((w) => w.slug === plan.slug);
  if (!work) return;
  work.total_logical_chapters = plan.chapter_numbers.length;
  const variantsPerChapter = plan.variants.filter((v) => v.slices.length > 0).length;
  work.total_variant_entries = plan.chapter_numbers.length * variantsPerChapter;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────
// CLI helpers
// ─────────────────────────────────────────────────────────────────────────

export interface CliArgs {
  only: string | null;
  apply: boolean;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { only: null, apply: false, dryRun: true };
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

export function summarizePlan(plan: WorkPlan): void {
  console.log(`\n=== ${plan.title} (${plan.slug}) ===`);
  console.log(
    `  Detected chapters: ${plan.chapter_numbers.length} (${plan.chapter_numbers.slice(0, 8).join(", ")}${plan.chapter_numbers.length > 8 ? ", …" : ""})`,
  );
  for (const v of plan.variants) {
    if (v.slices.length === 0) {
      console.log(`  ${v.filename}: ⚠️  no native markers; will not be split`);
    } else {
      const verseTotal = v.native_markers.length;
      const versesByChapter = v.slices.map((s) => s.markers.length);
      const minV = Math.min(...versesByChapter);
      const maxV = Math.max(...versesByChapter);
      console.log(
        `  ${v.filename}: prefix='${v.native_prefix}', ${v.slices.length} chapters, ${verseTotal} markers (per-chapter min=${minV} max=${maxV})${v.citation_markers.length > 0 ? `, ${v.citation_markers.length} citation markers ignored` : ""}`,
      );
    }
  }
}

export function printIssues(issues: ValidationIssue[]): void {
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

// ─────────────────────────────────────────────────────────────────────────
// Process a single work — used by split-type-a, split-type-c, oneoffs.
// Returns status without calling process.exit so the caller can loop and
// aggregate exit codes (TYPE_C runs N works with N different parsers).
// ─────────────────────────────────────────────────────────────────────────

export interface ProcessWorkOptions {
  slug: string;
  title: string;
  parseFunc: ParseFunc;
  corpusRoot: string;
  args: CliArgs;
}

export interface ProcessWorkResult {
  ok: boolean;
  applied: boolean;
}

export function processWork(opts: ProcessWorkOptions): ProcessWorkResult {
  let plan: WorkPlan;
  try {
    plan = planWork(opts.slug, { corpusRoot: opts.corpusRoot, parseFunc: opts.parseFunc });
  } catch (err) {
    console.error(`\n${opts.slug}: PLANNING FAILED — ${(err as Error).message}`);
    return { ok: false, applied: false };
  }

  // Print any parse-time diagnostics (e.g. "dropped N implausible markers")
  for (const v of plan.variants) {
    for (const note of v.notes) console.log(`  ${v.filename}: ${note}`);
  }

  summarizePlan(plan);

  const validation = validatePlan(plan);
  printIssues(validation.issues);

  if (!validation.ok) {
    console.log(`  → SKIPPED (validation failed)`);
    return { ok: false, applied: false };
  }

  if (opts.args.dryRun) {
    console.log(`  → DRY-RUN ok, would write ${plan.chapter_numbers.length} chapters`);
    return { ok: true, applied: false };
  }

  writeSplitToStaging(plan, opts.corpusRoot);
  commitSplit(plan, opts.corpusRoot);

  const postReport = validatePostWriteForPlan(plan, opts.corpusRoot);
  if (!postReport.ok) {
    console.error(`  ✗ POST-WRITE validation FAILED for ${plan.slug}:`);
    printIssues(postReport.issues);
    console.error(`    Backup directory left at corpus/.staging-split/${plan.slug}/chapters.backup — restore manually.`);
    return { ok: false, applied: false };
  }

  updateWorkIndex(plan, opts.corpusRoot);
  updateManifest(plan, opts.corpusRoot);

  console.log(`  → APPLIED. ${plan.chapter_numbers.length} chapters written. Backup left under corpus/.staging-split/${plan.slug}/`);
  return { ok: true, applied: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Batch entry — single parseFunc, multiple slugs (TYPE_A pattern).
// TYPE_C calls processWork directly in a loop because each work has a
// different parseFunc.
// ─────────────────────────────────────────────────────────────────────────

export interface RunOptions {
  classification: string;
  slugs: { slug: string; title: string }[];
  parseFunc: ParseFunc;
  corpusRoot: string;
  args: CliArgs;
}

export async function runOrchestrator(opts: RunOptions): Promise<void> {
  let scoped = opts.slugs;
  if (opts.args.only) {
    scoped = opts.slugs.filter((p) => p.slug === opts.args.only);
    if (scoped.length === 0) {
      console.error(`No ${opts.classification} work matches slug: ${opts.args.only}`);
      process.exit(1);
    }
  }
  console.log(`Mode: ${opts.args.apply ? "APPLY (will write)" : "DRY-RUN (no changes)"}`);
  console.log(`Classification: ${opts.classification}`);
  console.log(`Works to process: ${scoped.length}`);

  let allOk = true;
  let appliedCount = 0;

  for (const dp of scoped) {
    const r = processWork({
      slug: dp.slug,
      title: dp.title,
      parseFunc: opts.parseFunc,
      corpusRoot: opts.corpusRoot,
      args: opts.args,
    });
    if (!r.ok) allOk = false;
    if (r.applied) appliedCount++;
  }

  if (opts.args.apply) {
    console.log(`\nApplied to ${appliedCount} works.`);
  } else {
    console.log(`\nDry-run complete. Use --apply to write.`);
  }
  if (!allOk) process.exit(1);
}
