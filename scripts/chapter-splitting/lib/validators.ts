/**
 * Validators for TYPE_A chapter splits. Run BEFORE writing anything to disk.
 *
 * If any validator returns issues, the splitter aborts the work and reports.
 *
 * Validator coverage:
 *   1. marker-preservation:  every original marker present in exactly one slice
 *   2. no-marker-duplication: no marker appears in two slices
 *   3. content-conservation:  total slice chars ≈ original body chars (whitespace tolerance)
 *   4. round-trip-integrity:  concatenating slices reconstructs the original
 *      body modulo collapsing whitespace at chapter boundaries
 *   5. cross-variant-agreement: every variant (translation, transliteration,
 *      original) produces the same chapter set
 *   6. verse-monotonicity: within each chapter slice, verse numbers are
 *      non-decreasing (no backwards verses)
 *   7. no-empty-chapter: every produced slice has non-trivial content
 *   8. chapter-coverage: produced chapter numbers form a contiguous-ish set
 *      (we tolerate gaps but flag them)
 */

import type { VerseMarker } from "./parser.ts";
import { parseVerseMarkers } from "./parser.ts";
import type { ChapterSlice } from "./splitter.ts";

export type ValidationSeverity = "error" | "warn" | "info";

export interface ValidationIssue {
  validator: string;
  severity: ValidationSeverity;
  message: string;
  context?: Record<string, unknown>;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
}

const WHITESPACE_RX = /\s+/g;

function collapseWhitespace(s: string): string {
  return s.replace(WHITESPACE_RX, " ").trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Per-variant validators
// ─────────────────────────────────────────────────────────────────────────

export interface PerVariantInput {
  variant_label: string;
  body: string;
  native_prefix: string;
  native_markers: VerseMarker[];
  slices: ChapterSlice[];
  /** Minimum characters of visible (whitespace-collapsed) content per
   *  chapter slice. Defaults to 20 — appropriate for TYPE_A verse-marker
   *  splits where any chapter shorter than that suggests a slicer bug.
   *  Lower (e.g. 0 or 5) for TYPE_C prose-heading splits where the source
   *  may legitimately have heading-only sections (Kātyāyana ch.48 in both
   *  variants). */
  min_content_chars?: number;
}

export function validateVariant(input: PerVariantInput): ValidationReport {
  const issues: ValidationIssue[] = [];
  const { variant_label, body, native_prefix, native_markers, slices } = input;

  // ── 1. marker-preservation + 2. no-marker-duplication ───────────────────
  const originalKeys = new Set(native_markers.map((m) => `${m.chapter}.${m.verse}`));
  const sliceKeys = new Set<string>();
  const dupKeys: string[] = [];
  for (const slice of slices) {
    for (const m of slice.markers) {
      const k = `${m.chapter}.${m.verse}`;
      if (sliceKeys.has(k)) dupKeys.push(k);
      sliceKeys.add(k);
    }
  }
  for (const k of originalKeys) {
    if (!sliceKeys.has(k)) {
      issues.push({
        validator: "marker-preservation",
        severity: "error",
        message: `[${variant_label}] verse ${native_prefix}_${k} present in source but missing from any slice`,
      });
    }
  }
  for (const k of sliceKeys) {
    if (!originalKeys.has(k)) {
      issues.push({
        validator: "marker-preservation",
        severity: "error",
        message: `[${variant_label}] verse ${native_prefix}_${k} appears in a slice but was not in the source markers`,
      });
    }
  }
  for (const k of dupKeys) {
    issues.push({
      validator: "no-marker-duplication",
      severity: "error",
      message: `[${variant_label}] verse ${native_prefix}_${k} appears in more than one slice`,
    });
  }

  // ── 3. content-conservation ─────────────────────────────────────────────
  const sliceCharsTotal = slices.reduce((s, sl) => s + sl.content.length, 0);
  const bodyChars = body.length;
  // Allow small slack for whitespace trimming at chunk boundaries.
  const maxLost = Math.max(50, Math.ceil(bodyChars * 0.005));
  const lost = bodyChars - sliceCharsTotal;
  if (Math.abs(lost) > maxLost) {
    issues.push({
      validator: "content-conservation",
      severity: "error",
      message: `[${variant_label}] slice total = ${sliceCharsTotal} chars, body = ${bodyChars}, delta = ${lost} (limit ±${maxLost})`,
    });
  }

  // ── 4. round-trip-integrity (collapsed whitespace) ─────────────────────
  const reconstructed = slices.map((s) => s.content).join("\n\n");
  if (collapseWhitespace(reconstructed) !== collapseWhitespace(body)) {
    // Find approximate divergence point for diagnostic
    const a = collapseWhitespace(reconstructed);
    const b = collapseWhitespace(body);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    issues.push({
      validator: "round-trip-integrity",
      severity: "error",
      message: `[${variant_label}] reconstructed body diverges from original at char ${i}. Original len=${b.length}, reconstructed len=${a.length}`,
      context: {
        snippet_before: b.slice(Math.max(0, i - 80), i),
        snippet_original: b.slice(i, i + 80),
        snippet_reconstructed: a.slice(i, i + 80),
      },
    });
  }

  // ── 6. verse-monotonicity ──────────────────────────────────────────────
  for (const slice of slices) {
    let prev = -Infinity;
    for (const m of slice.markers) {
      if (m.verse < prev) {
        issues.push({
          validator: "verse-monotonicity",
          severity: "error",
          message: `[${variant_label}] chapter ${slice.chapter}: verse ${m.verse} appears after ${prev}`,
        });
      }
      prev = m.verse;
    }
  }

  // ── 7. no-empty-chapter ────────────────────────────────────────────────
  const minContentChars = input.min_content_chars ?? 20;
  if (minContentChars > 0) {
    for (const slice of slices) {
      if (collapseWhitespace(slice.content).length < minContentChars) {
        issues.push({
          validator: "no-empty-chapter",
          severity: "error",
          message: `[${variant_label}] chapter ${slice.chapter} content is suspiciously short (< ${minContentChars} visible chars)`,
        });
      }
    }
  }

  // ── 8. chapter-coverage ────────────────────────────────────────────────
  const chapterNums = slices.map((s) => s.chapter).sort((a, b) => a - b);
  const min = chapterNums[0]!;
  const max = chapterNums[chapterNums.length - 1]!;
  if (min !== 1) {
    issues.push({
      validator: "chapter-coverage",
      severity: "warn",
      message: `[${variant_label}] chapter numbering starts at ${min}, expected 1`,
    });
  }
  for (let n = min; n <= max; n++) {
    if (!chapterNums.includes(n)) {
      issues.push({
        validator: "chapter-coverage",
        severity: "warn",
        message: `[${variant_label}] chapter ${n} is missing from the slice set (range ${min}-${max})`,
      });
    }
  }

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

// ─────────────────────────────────────────────────────────────────────────
// Cross-variant validators
// ─────────────────────────────────────────────────────────────────────────

export interface CrossVariantInput {
  /** All variants of the work — INCLUDING ones with no native markers. */
  variants: Array<{
    label: string;
    slices: ChapterSlice[];
  }>;
}

export function validateAcrossVariants(input: CrossVariantInput): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (input.variants.length < 2) return { ok: true, issues };

  // Variant-coverage safety check: if a variant has zero slices (no native
  // markers), splitting would silently drop it. Abort the split for the
  // whole work — preserve the original 1-chapter form so the variant is
  // not lost.
  const noMarkerVariants = input.variants.filter((v) => v.slices.length === 0);
  if (noMarkerVariants.length > 0) {
    issues.push({
      validator: "variant-coverage",
      severity: "error",
      message: `${noMarkerVariants.length} variant(s) have no native verse markers and would be dropped if we split: [${noMarkerVariants.map((v) => v.label).join(", ")}]. Aborting to preserve them. Either teach the parser the alternate marker format, or restructure the variant manually before retrying.`,
    });
    return { ok: false, issues };
  }

  // Cross-variant: every variant must produce the same chapter set.
  const sets = input.variants.map((v) => ({
    label: v.label,
    chapters: new Set(v.slices.map((s) => s.chapter)),
  }));
  const reference = sets[0]!;
  for (const s of sets.slice(1)) {
    const onlyInRef = [...reference.chapters].filter((c) => !s.chapters.has(c)).sort((a, b) => a - b);
    const onlyInThis = [...s.chapters].filter((c) => !reference.chapters.has(c)).sort((a, b) => a - b);
    if (onlyInRef.length || onlyInThis.length) {
      issues.push({
        validator: "cross-variant-agreement",
        severity: "error",
        message: `chapter sets disagree between '${reference.label}' and '${s.label}' — only-in-${reference.label}=[${onlyInRef.join(",")}], only-in-${s.label}=[${onlyInThis.join(",")}]`,
      });
    }
  }

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

// ─────────────────────────────────────────────────────────────────────────
// Output validators (run AFTER write — verify on-disk state)
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface PostWriteInput {
  work_slug: string;
  corpus_root: string;
  expected_chapter_numbers: number[];
  expected_variants_per_chapter: string[]; // e.g. ["translation", "transliteration", "original"]
  /** Per-(variant, chapter) expected verse markers. */
  expected_markers_by_chapter: Map<string, Set<string>>; // key: `${variant}|${chapter}` → set of "ch.v" strings
}

export function validatePostWrite(input: PostWriteInput): ValidationReport {
  const issues: ValidationIssue[] = [];
  const chaptersDir = join(input.corpus_root, "works", input.work_slug, "chapters");

  if (!existsSync(chaptersDir)) {
    issues.push({
      validator: "post-write-structure",
      severity: "error",
      message: `chapters directory missing on disk: ${chaptersDir}`,
    });
    return { ok: false, issues };
  }

  // Verify each expected chapter directory exists with all expected variants
  const onDiskChapters = readdirSync(chaptersDir).filter((d) => /^\d+/.test(d));
  const onDiskChapterNums = new Set(onDiskChapters.map((d) => parseInt(d.split("-")[0]!, 10)));

  for (const n of input.expected_chapter_numbers) {
    if (!onDiskChapterNums.has(n)) {
      issues.push({
        validator: "post-write-structure",
        severity: "error",
        message: `expected chapter ${n} not on disk under ${chaptersDir}`,
      });
    }
  }

  // Per-chapter, per-variant marker check
  for (const dir of onDiskChapters) {
    const chapterNum = parseInt(dir.split("-")[0]!, 10);
    const chapterPath = join(chaptersDir, dir);
    const metaPath = join(chapterPath, "meta.json");
    if (!existsSync(metaPath)) {
      issues.push({
        validator: "post-write-meta",
        severity: "error",
        message: `meta.json missing for chapter ${chapterNum}`,
      });
      continue;
    }

    for (const variant of input.expected_variants_per_chapter) {
      const filePath = join(chapterPath, `${variant}.md`);
      if (!existsSync(filePath)) {
        issues.push({
          validator: "post-write-variants",
          severity: "warn",
          message: `chapter ${chapterNum}: ${variant}.md missing (may be intentional if variant doesn't exist)`,
        });
        continue;
      }
      const raw = readFileSync(filePath, "utf-8");
      const bodyStart = raw.indexOf("\n---", 4);
      const body = bodyStart === -1 ? raw : raw.slice(bodyStart + 4);
      const onDiskMarkers = parseVerseMarkers(body);
      const onDiskKeys = new Set(onDiskMarkers.map((m) => `${m.chapter}.${m.verse}`));
      const expectedKey = `${variant}|${chapterNum}`;
      const expected = input.expected_markers_by_chapter.get(expectedKey);
      if (!expected) continue;
      for (const k of expected) {
        if (!onDiskKeys.has(k)) {
          issues.push({
            validator: "post-write-marker-preservation",
            severity: "error",
            message: `chapter ${chapterNum} ${variant}.md missing expected verse ${k}`,
          });
        }
      }
    }
  }

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}
