#!/usr/bin/env bun
/**
 * Chapter-splitting discovery — pre-work for actually splitting the
 * one-chapter smṛti and tattva entries into their real internal chapters.
 *
 * Surveys every work in the corpus, looks for splittability signals across
 * all variants, and classifies each work by splitting strategy:
 *
 *   TYPE_A — clean verse markers (Mn_1.1, Yj_1.1 …) with multiple distinct
 *            chapter numbers. Auto-splittable.
 *   TYPE_B — verse markers exist but are all under a single chapter number
 *            (e.g. Ang_1.x). Real divisions exist in the prose; need to find
 *            section breaks manually.
 *   TYPE_C — no verse markers. Probably has prose section headings
 *            ("CHAPTER N", "Section II", "Adhyāya 3") to detect.
 *   TYPE_D — already well-split (>= 3 logical chapters). Skip.
 *   TYPE_E — single-chapter or two-chapter work that is genuinely intended
 *            as one chunk (manifestos, short pieces). Verify manually.
 *
 * Outputs:
 *   docs/chapter-splitting-discovery.md        human-readable per-work plan
 *   scripts/chapter-splitting/discovery.json   machine-readable for splitter
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = resolve(ROOT, "corpus");

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface ManifestWork {
  slug: string;
  title: string;
  author: string;
  era: string;
  language: string;
  total_logical_chapters: number;
  total_variant_entries: number;
  description: string;
}

interface VariantStats {
  file: string;
  content_type: string;
  language: string;
  word_count: number;
  /** Count of verse-marker matches like "Mn_1.5", "Yj_2.10", "Vi_50.3" */
  verse_marker_count: number;
  /** Distinct chapter numbers extracted from verse markers (sorted asc). */
  verse_marker_chapters: number[];
  /** Distinct prefix keys (e.g. "Mn", "Yj"). Multiple = mixed/cited. */
  verse_marker_prefixes: string[];
  /** Detected prose section headings — e.g. "CHAPTER N", "ADHYĀYA N", "Section N", roman numerals on their own lines. */
  prose_section_count: number;
  /** Sample of detected prose sections (first 8). */
  prose_section_samples: string[];
  /** First ~300 chars of the body, with frontmatter stripped. */
  body_preview: string;
  /** Total body length. */
  body_chars: number;
}

interface ChapterStats {
  chapter_number: number;
  chapter_slug: string;
  variants: VariantStats[];
}

interface WorkPlan {
  slug: string;
  title: string;
  author: string;
  language: string;
  total_logical_chapters_now: number;
  detected_chapters_proposed: number | null;
  classification: "TYPE_A" | "TYPE_B" | "TYPE_C" | "TYPE_D" | "TYPE_E";
  rationale: string;
  recommended_action:
    | "auto-split-by-verse-markers"
    | "manual-section-discovery"
    | "prose-heading-detection"
    | "no-action-already-split"
    | "no-action-genuinely-monolithic";
  splitting_pattern_hint: string | null;
  per_variant_chapter_count_match: boolean | null;
  chapters: ChapterStats[];
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---\n")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { fm: {}, body: raw };
  const yaml = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const fm: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^([\w_]+):\s*(.*)$/);
    if (m && m[2]) fm[m[1]!] = m[2].trim();
  }
  return { fm, body };
}

/**
 * Verse-marker patterns observed in the corpus. Order matters slightly —
 * we collect matches from all of them and merge.
 *
 * Form 1: bareword Mn_1.5     — Manusmṛti, Yājñavalkya, Nāradasmṛti, Parāśara,
 *                                Viṣṇu, Yama, Aṅgirasa Smṛtis (chapter . verse)
 * Form 2: bracketed [VS_01s]  — Vratiśāsana, Slokantara (verse . optional-suffix)
 * Form 3: curly {MV-S_1}      — Vīramitrodaya (compound prefix, verse only)
 *
 * For form 2 and 3, there's typically NO embedded chapter index — they're
 * verse-only sequences in works that may or may not have prose section
 * breaks separately.
 */
const VERSE_MARKER_PATTERNS: { name: string; rx: RegExp; hasChapter: boolean }[] = [
  // Form 1: Mn_1.5, Vi_50.3, Par_3.12, Yj_2.10
  { name: "bareword_chapter_verse", rx: /\b([A-Za-z]{2,6})_(\d+)\.(\d+)\b/g, hasChapter: true },
  // Form 2: [VS_01s], [Slo_01s], [VS_01s-ab], [Slo_01j§1] — verse only, optional suffix
  { name: "bracketed_verse", rx: /\[([A-Za-z]{2,6})_(\d+)[a-z\-§§\d]*\]/g, hasChapter: false },
  // Form 3: {MV-S_1}, {MV-S_2} — verse only
  { name: "curly_compound_verse", rx: /\{([A-Za-z]+-?[A-Za-z]+)_(\d+)\}/g, hasChapter: false },
];

const PROSE_SECTION_RXS: { name: string; rx: RegExp }[] = [
  { name: "Markdown H2 'Chapter N: …'", rx: /^\s*#{2}\s*Chapter\s+([IVXLCDM]+|\d+)\b.*$/gim },
  { name: "Markdown H2 'Canto N'", rx: /^\s*#{2}\s*Canto\s+(\d+)\b.*$/gim },
  { name: "Markdown H2 'Adhyāya N'", rx: /^\s*#{2}\s*Adhy[āa]ya\s+(\d+)\b.*$/gim },
  { name: "CHAPTER N (caps)", rx: /^\s*CHAPTER\s+([IVXLCDM]+|\d+)\b.*$/gm },
  { name: "Chapter N (Title)", rx: /^\s*Chapter\s+([IVXLCDM]+|\d+)\b.*$/gm },
  { name: "Section N", rx: /^\s*(?:SECTION|Section)\s+([IVXLCDM]+|\d+)\b.*$/gm },
  // Vīramitrodaya uses ### [Determination of X], ### [Here, by …]. These
  // mark major topic divisions at the chapter level.
  { name: "Markdown H3 [Determination/topic]", rx: /^\s*#{3}\s*\[[^\]]+\].*$/gm },
  { name: "Markdown H2 (any)", rx: /^\s*#{2}\s+\S.*$/gm },
  { name: "Markdown H3 (any)", rx: /^\s*#{3}\s+\S.*$/gm },
];

function analyzeVariant(slug: string, chapterSlug: string, variantFile: string): VariantStats {
  const path = join(CORPUS, "works", slug, "chapters", chapterSlug, variantFile);
  const raw = readFileSync(path, "utf-8");
  const { fm, body } = parseFrontmatter(raw);

  // Collect markers from every supported form
  const markers: { prefix: string; chapter: number | null; verse: number; form: string }[] = [];
  for (const pattern of VERSE_MARKER_PATTERNS) {
    for (const m of body.matchAll(pattern.rx)) {
      if (pattern.hasChapter) {
        markers.push({
          prefix: m[1]!,
          chapter: parseInt(m[2]!, 10),
          verse: parseInt(m[3]!, 10),
          form: pattern.name,
        });
      } else {
        markers.push({
          prefix: m[1]!,
          chapter: null,
          verse: parseInt(m[2]!, 10),
          form: pattern.name,
        });
      }
    }
  }
  // For chapter detection, only use markers that carry a chapter index
  const chapterMarkers = markers.filter((m) => m.chapter !== null);
  const verseMarkerChapters = [...new Set(chapterMarkers.map((m) => m.chapter!))].sort((a, b) => a - b);
  const verseMarkerPrefixes = [...new Set(markers.map((m) => m.prefix))];

  // Prose-section detection — try every pattern, count, sample
  let proseSectionCount = 0;
  const proseSectionSamples: string[] = [];
  for (const { rx } of PROSE_SECTION_RXS) {
    const matches = [...body.matchAll(rx)];
    if (matches.length > proseSectionCount) {
      proseSectionCount = matches.length;
      proseSectionSamples.length = 0;
      for (const mm of matches.slice(0, 8)) {
        proseSectionSamples.push(mm[0]!.trim());
      }
    }
  }

  return {
    file: variantFile,
    content_type: String(fm["content_type"] ?? "unknown"),
    language: String(fm["language"] ?? "unknown"),
    word_count: typeof fm["word_count"] === "string" ? parseInt(String(fm["word_count"]), 10) : 0,
    verse_marker_count: markers.length,
    verse_marker_chapters: verseMarkerChapters,
    verse_marker_prefixes: verseMarkerPrefixes,
    prose_section_count: proseSectionCount,
    prose_section_samples: proseSectionSamples,
    body_preview: body.slice(0, 300).replace(/\s+/g, " "),
    body_chars: body.length,
  };
}

function listChapterDirs(workSlug: string): string[] {
  const dir = join(CORPUS, "works", workSlug, "chapters");
  return readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory());
}

function listVariantFiles(workSlug: string, chapterSlug: string): string[] {
  const dir = join(CORPUS, "works", workSlug, "chapters", chapterSlug);
  return readdirSync(dir).filter((f) => f.endsWith(".md"));
}

// ─────────────────────────────────────────────────────────────────────────
// Per-work classifier
// ─────────────────────────────────────────────────────────────────────────

function classifyAndPlan(work: ManifestWork): WorkPlan {
  const chapterDirs = listChapterDirs(work.slug);
  const chapters: ChapterStats[] = [];

  for (const cd of chapterDirs.sort()) {
    const variantFiles = listVariantFiles(work.slug, cd).filter((f) => !f.endsWith(".paragraphs.json"));
    const variants = variantFiles.map((f) => analyzeVariant(work.slug, cd, f));
    chapters.push({
      chapter_number: parseInt(cd.split("-")[0] ?? "0", 10),
      chapter_slug: cd,
      variants,
    });
  }

  // Already well-split?
  if (chapters.length >= 3) {
    return {
      slug: work.slug,
      title: work.title,
      author: work.author,
      language: work.language,
      total_logical_chapters_now: chapters.length,
      detected_chapters_proposed: null,
      classification: "TYPE_D",
      rationale: `Already split into ${chapters.length} chapters; no action needed.`,
      recommended_action: "no-action-already-split",
      splitting_pattern_hint: null,
      per_variant_chapter_count_match: null,
      chapters,
    };
  }

  // Inspect verse-marker stats across variants.
  // Heuristic: if a variant has more than one distinct prefix, those markers are
  // most likely citations to OTHER works (e.g. Bṛhaspati's transliteration cites
  // Mn_8.113 and Yv_2.177). Ignore those for native-chapter classification.
  const allMarkerVariants = chapters.flatMap((c) => c.variants).filter((v) => v.verse_marker_count > 0);
  const nativeMarkerVariants = allMarkerVariants.filter(
    (v) => v.verse_marker_prefixes.length === 1 && v.verse_marker_chapters.length > 0,
  );
  const variantsWithMultipleChapters = nativeMarkerVariants.filter((v) => v.verse_marker_chapters.length >= 2);
  const variantsWithOneChapter = nativeMarkerVariants.filter((v) => v.verse_marker_chapters.length === 1);

  // TYPE_A: clean verse markers, multiple chapters detected
  if (variantsWithMultipleChapters.length > 0) {
    const sample = variantsWithMultipleChapters[0]!;
    const counts = sample.verse_marker_chapters.length;
    const prefix = sample.verse_marker_prefixes[0] ?? "?";
    // Cross-variant consistency: every native-marker variant should report the
    // same chapter count. If the work has, say, 3 variants and only 2 carry
    // markers, we compare those 2.
    const allCounts = nativeMarkerVariants.map((v) => v.verse_marker_chapters.length);
    const allAgree = new Set(allCounts).size === 1;
    const lowest = Math.min(...allCounts);
    const highest = Math.max(...allCounts);
    return {
      slug: work.slug,
      title: work.title,
      author: work.author,
      language: work.language,
      total_logical_chapters_now: chapters.length,
      detected_chapters_proposed: highest,
      classification: "TYPE_A",
      rationale: allAgree
        ? `${nativeMarkerVariants.length} variant(s) carry ${prefix}_N.M verse markers spanning ${counts} chapters. All variants agree. Auto-splittable.`
        : `${nativeMarkerVariants.length} variant(s) carry ${prefix}_N.M markers but disagree on chapter count: counts seen = ${[...new Set(allCounts)].join(", ")} (min ${lowest}, max ${highest}). Reconcile before splitting.`,
      recommended_action: "auto-split-by-verse-markers",
      splitting_pattern_hint: `${prefix}_<chapter>.<verse>`,
      per_variant_chapter_count_match: allAgree,
      chapters,
    };
  }

  // TYPE_B: verse markers all under a single chapter (the "lazy" case)
  if (variantsWithOneChapter.length > 0) {
    const sample = variantsWithOneChapter[0]!;
    return {
      slug: work.slug,
      title: work.title,
      author: work.author,
      language: work.language,
      total_logical_chapters_now: chapters.length,
      detected_chapters_proposed: null,
      classification: "TYPE_B",
      rationale: `${sample.verse_marker_count} verses found, ALL labeled ${sample.verse_marker_prefixes[0]}_1.x. The verses are real but the chapter index in the marker is uniform — original work likely has internal divisions that the source-document collapsed into chapter 1. Needs manual section-break discovery.`,
      recommended_action: "manual-section-discovery",
      splitting_pattern_hint: `${sample.verse_marker_prefixes[0]}_1.<verse>; chapter boundaries to be determined manually`,
      per_variant_chapter_count_match: null,
      chapters,
    };
  }

  // TYPE_C: prose section detection
  const variantsWithProseSections = chapters
    .flatMap((c) => c.variants)
    .filter((v) => v.prose_section_count >= 2);
  if (variantsWithProseSections.length > 0) {
    const sample = variantsWithProseSections[0]!;
    return {
      slug: work.slug,
      title: work.title,
      author: work.author,
      language: work.language,
      total_logical_chapters_now: chapters.length,
      detected_chapters_proposed: sample.prose_section_count,
      classification: "TYPE_C",
      rationale: `No verse markers, but ${sample.prose_section_count} prose section heading(s) detected via the strongest matching pattern. Worth a manual look at the samples to see if these are real chapter boundaries.`,
      recommended_action: "prose-heading-detection",
      splitting_pattern_hint: sample.prose_section_samples.slice(0, 3).join(" | "),
      per_variant_chapter_count_match: null,
      chapters,
    };
  }

  // TYPE_E: monolithic, no detectable structure
  return {
    slug: work.slug,
    title: work.title,
    author: work.author,
    language: work.language,
    total_logical_chapters_now: chapters.length,
    detected_chapters_proposed: null,
    classification: "TYPE_E",
    rationale:
      "No verse markers, no prose section headings detected. Either genuinely a single-piece work, or the source document doesn't expose its structure in any machine-readable way. Manual inspection required to decide.",
    recommended_action: "no-action-genuinely-monolithic",
    splitting_pattern_hint: null,
    per_variant_chapter_count_match: null,
    chapters,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Report formatter
// ─────────────────────────────────────────────────────────────────────────

function formatReport(plans: WorkPlan[]): string {
  const lines: string[] = [];
  lines.push("# Falsafa — Chapter-Splitting Discovery Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  const byType = plans.reduce(
    (acc, p) => {
      acc[p.classification] = (acc[p.classification] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  lines.push("| Type | Count | Strategy |");
  lines.push("|------|------:|----------|");
  lines.push(`| TYPE_A | ${byType.TYPE_A ?? 0} | auto-split by verse markers (Mn_1.x style) |`);
  lines.push(`| TYPE_B | ${byType.TYPE_B ?? 0} | verses exist, all under ch.1 — manual section discovery |`);
  lines.push(`| TYPE_C | ${byType.TYPE_C ?? 0} | prose heading detection (CHAPTER N etc) |`);
  lines.push(`| TYPE_D | ${byType.TYPE_D ?? 0} | already well-split (no action) |`);
  lines.push(`| TYPE_E | ${byType.TYPE_E ?? 0} | no auto-detect — manual inspection |`);
  lines.push("");
  lines.push(`Total works surveyed: ${plans.length}`);
  lines.push("");

  // ── TYPE_A first (auto-splittable) ─────────────────────────────────────
  lines.push("## TYPE_A — Auto-splittable by verse markers");
  lines.push("");
  lines.push("These have clean `Prefix_N.M` verse markers with multiple distinct chapter numbers. The splitter can group verses by chapter number deterministically. Cross-variant consistency check column: all variants with markers detect the same chapter count.");
  lines.push("");
  lines.push("| Work | Lang | Now | Proposed | Pattern | Variants agree? |");
  lines.push("|------|------|----:|---------:|---------|:---------------:|");
  for (const p of plans.filter((p) => p.classification === "TYPE_A")) {
    lines.push(
      `| ${p.title} | ${p.language} | ${p.total_logical_chapters_now} | ${p.detected_chapters_proposed} | \`${p.splitting_pattern_hint}\` | ${p.per_variant_chapter_count_match ? "✅" : "⚠️ no"} |`,
    );
  }
  lines.push("");

  // ── TYPE_B (lazy single chapter) ───────────────────────────────────────
  lines.push("## TYPE_B — Verses exist but all under chapter 1");
  lines.push("");
  lines.push("Verse markers are present but all carry the chapter-number 1, even though the actual work has internal divisions. The source document likely conflated divisions during preparation. **Manual section-break discovery required.**");
  lines.push("");
  for (const p of plans.filter((p) => p.classification === "TYPE_B")) {
    lines.push(`### ${p.title}  *(${p.slug})*`);
    lines.push("");
    lines.push(`- Language: ${p.language}`);
    lines.push(`- Current state: ${p.total_logical_chapters_now} logical chapter(s)`);
    lines.push(`- Hint: \`${p.splitting_pattern_hint}\``);
    lines.push(`- Rationale: ${p.rationale}`);
    lines.push("");
    for (const c of p.chapters) {
      for (const v of c.variants) {
        lines.push(`- variant=${v.content_type}, lang=${v.language}, words=${v.word_count}, markers=${v.verse_marker_count}, body_chars=${v.body_chars}`);
      }
    }
    lines.push("");
  }

  // ── TYPE_C (prose sections detected) ───────────────────────────────────
  lines.push("## TYPE_C — Prose section headings detected");
  lines.push("");
  lines.push("No verse markers, but heading patterns suggest internal structure. Manual review of the heading samples is required to confirm they represent real chapter boundaries.");
  lines.push("");
  for (const p of plans.filter((p) => p.classification === "TYPE_C")) {
    lines.push(`### ${p.title}  *(${p.slug})*`);
    lines.push("");
    lines.push(`- Language: ${p.language}`);
    lines.push(`- Current state: ${p.total_logical_chapters_now} logical chapter(s)`);
    lines.push(`- Detected sections: ${p.detected_chapters_proposed}`);
    lines.push(`- Sample headings:`);
    for (const c of p.chapters) {
      for (const v of c.variants) {
        if (v.prose_section_samples.length > 0) {
          lines.push(`  - **${v.content_type}** (${v.language}, ${v.prose_section_count} sections):`);
          for (const s of v.prose_section_samples.slice(0, 6)) {
            lines.push(`    - \`${s.slice(0, 100)}\``);
          }
        }
      }
    }
    lines.push("");
  }

  // ── TYPE_E (monolithic, manual) ────────────────────────────────────────
  lines.push("## TYPE_E — No auto-detectable structure");
  lines.push("");
  lines.push("Neither verse markers nor prose section headings detected. These need manual inspection — read the body, decide if it's genuinely one chunk or has hidden divisions.");
  lines.push("");
  for (const p of plans.filter((p) => p.classification === "TYPE_E")) {
    lines.push(`### ${p.title}  *(${p.slug})*`);
    lines.push("");
    lines.push(`- Language: ${p.language}`);
    lines.push(`- Current state: ${p.total_logical_chapters_now} logical chapter(s)`);
    for (const c of p.chapters) {
      for (const v of c.variants) {
        lines.push(`- **${v.content_type}** (${v.language}): ${v.word_count} words, ${v.body_chars} chars`);
        lines.push(`  - preview: *${v.body_preview.slice(0, 200)}…*`);
      }
    }
    lines.push("");
  }

  // ── TYPE_D (no action) ─────────────────────────────────────────────────
  lines.push("## TYPE_D — Already well-split (no action)");
  lines.push("");
  lines.push("| Work | Lang | Chapters |");
  lines.push("|------|------|---------:|");
  for (const p of plans.filter((p) => p.classification === "TYPE_D")) {
    lines.push(`| ${p.title} | ${p.language} | ${p.total_logical_chapters_now} |`);
  }
  lines.push("");

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

function main() {
  const manifestPath = join(CORPUS, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { works: ManifestWork[] };

  console.log(`Surveying ${manifest.works.length} works...`);
  const plans: WorkPlan[] = [];
  for (const w of manifest.works) {
    process.stdout.write(`  ${w.slug}... `);
    try {
      plans.push(classifyAndPlan(w));
      const last = plans[plans.length - 1]!;
      console.log(`${last.classification} (${last.recommended_action})`);
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`);
    }
  }

  const reportPath = resolve(ROOT, "docs/chapter-splitting-discovery.md");
  const jsonPath = resolve(ROOT, "scripts/chapter-splitting/discovery.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  mkdirSync(dirname(jsonPath), { recursive: true });

  writeFileSync(reportPath, formatReport(plans));
  writeFileSync(jsonPath, JSON.stringify({ generated_at: new Date().toISOString(), plans }, null, 2));

  console.log("");
  console.log(`Report:   ${reportPath}`);
  console.log(`Sidecar:  ${jsonPath}`);
  console.log("");
  console.log("Per-type breakdown:");
  const byType = plans.reduce<Record<string, number>>((acc, p) => {
    acc[p.classification] = (acc[p.classification] ?? 0) + 1;
    return acc;
  }, {});
  for (const [k, v] of Object.entries(byType).sort()) {
    console.log(`  ${k}: ${v}`);
  }
}

main();
