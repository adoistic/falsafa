#!/usr/bin/env bun
/**
 * Phase 0 — Corpus Audit
 *
 * Reads works.json, audits every work and chapter for structural integrity,
 * content classification, encoding sanity, and metadata completeness.
 *
 * Outputs:
 *   docs/corpus-audit.md    human-readable report
 *   corpus-audit.json       machine-readable data the convert script consumes
 *
 * Run: bun run audit
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Types — minimal, derived from works.json shape
// ─────────────────────────────────────────────────────────────────────────

interface RawWork {
  id: string;
  title: string;
  subtitle?: string | null;
  author?: {
    id?: string;
    name?: string;
    biography?: string | null;
    birth_year?: number | null;
    death_year?: number | null;
    nationality?: string | null;
    photo_url?: string | null;
  };
  era?: { id?: string; name?: string; start_year?: number; end_year?: number; description?: string };
  genre?: { id?: string; name?: string; description?: string };
  language?: { id?: string; code?: string; name?: string; direction?: string };
  description?: string;
  difficulty?: string;
  is_published?: boolean;
  is_featured?: boolean;
  has_sections?: boolean;
  published_year?: number | null;
  original_language?: string;
  cover_image_url?: string | null;
  total_chapters?: number;
  chapters: RawChapter[];
  sections?: unknown[];
  created_at?: string;
  updated_at?: string;
}

interface RawChapter {
  id: string;
  title?: string;
  content: string;
  chapter_number: number;
  word_count?: number;
  chapter_type?: string;
  is_original?: boolean;
  language_id?: string;
  image_url?: string | null;
  audio_file_url?: string | null;
  section_id?: string | null;
  estimated_read_time?: number | null;
  created_at?: string;
}

interface RawCorpus {
  works: RawWork[];
  counts?: Record<string, number>;
  source?: string;
  exported_at?: string;
}

type ContentType = "original" | "transliteration" | "translation" | "unknown";
type Layout = "prose" | "verse" | "manuscript";

interface AuditedChapter {
  work_id: string;
  work_title: string;
  chapter_id: string;
  chapter_number: number;
  chapter_title: string;
  content_type: ContentType;
  layout: Layout;
  language_name: string;
  script: string;
  word_count_stated: number;
  word_count_actual: number;
  word_count_delta: number;
  has_image: boolean;
  has_source_url: boolean;
  source_url: string | null;
  is_generic_title: boolean;
  flags: string[];
}

interface AuditedWork {
  id: string;
  title: string;
  author_name: string;
  language_name: string;
  era_name: string;
  genre_name: string;
  chapter_count: number;
  total_words: number;
  layouts_detected: Layout[];
  flags: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Heuristics
// ─────────────────────────────────────────────────────────────────────────

const VERSE_AUTHORS = new Set([
  "Allama Iqbal",
  "Mirza Ghalib",
  "Sheikh Ibrahim Zauq",
  "Cynewulf", // alliterative verse
]);

const VERSE_LANGUAGE_HINTS = new Set(["urdu", "old_english"]);

function detectScript(content: string): string {
  // Sample the first 500 non-whitespace chars to determine script
  const sample = content.replace(/\s/g, "").slice(0, 500);
  if (!sample) return "empty";
  const counts = {
    latin: 0,
    devanagari: 0,
    arabic: 0,
    cjk: 0,
    other: 0,
  };
  for (const ch of sample) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x0041 && code <= 0x007a) || (code >= 0x00c0 && code <= 0x024f)) {
      counts.latin++;
    } else if (code >= 0x0900 && code <= 0x097f) {
      counts.devanagari++;
    } else if ((code >= 0x0600 && code <= 0x06ff) || (code >= 0xfb50 && code <= 0xfdff)) {
      counts.arabic++;
    } else if (code >= 0x4e00 && code <= 0x9fff) {
      counts.cjk++;
    } else {
      counts.other++;
    }
  }
  // Pick the dominant script
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries[0]![0]!;
}

function classifyContentType(work: RawWork, chapter: RawChapter, script: string): ContentType {
  // Manuscript chapters with images aren't really translation/original — they're the manuscript itself
  if (chapter.image_url) return "original"; // the image IS the original
  if (chapter.is_original === false) return "translation";
  // is_original=true means the chapter IS the source text
  // BUT: if content is in Latin script while language is non-Latin (sanskrit/urdu/etc),
  // it's transliteration not the original
  const langName = work.language?.name?.toLowerCase() ?? "";
  const isNonLatinLanguage =
    langName === "sanskrit" || langName === "urdu" || langName === "kawi" || langName === "old_english" === false;
  // Old English IS Latin script (with some special chars), so it's "original" not transliteration
  if (langName === "old_english") return "original";
  if (langName === "english") return "original";
  if (langName === "french" || langName === "german") return "original";
  // For Sanskrit / Urdu / Kawi: if content is Latin script, it's transliteration
  if ((langName === "sanskrit" || langName === "urdu" || langName === "kawi") && script === "latin") {
    return "transliteration";
  }
  // If we can't tell, fall back to is_original boolean
  if (chapter.is_original === true) return "original";
  return "unknown";
}

function classifyLayout(work: RawWork, chapter: RawChapter, contentType: ContentType): Layout {
  // Manuscript: chapter has an image_url
  if (chapter.image_url) return "manuscript";
  // Verse: known poetry author OR specific language hint
  const authorName = work.author?.name ?? "";
  if (VERSE_AUTHORS.has(authorName)) return "verse";
  const langName = work.language?.name?.toLowerCase() ?? "";
  if (VERSE_LANGUAGE_HINTS.has(langName) && contentType !== "translation") {
    // Old English originals (Cynewulf) are verse; Urdu originals would be ghazals
    return "verse";
  }
  // Sanskrit smṛti / tattva texts are verse-numbered (shloka markers like "Ang_1.1")
  if (langName === "sanskrit" || langName === "kawi") {
    if (chapter.content.match(/\b\w+_\d+\.\d+\s*\/\//)) return "verse";
  }
  // Iqbal/Ghalib/Zauq translations are still verse layout (English ghazals)
  if (contentType === "translation" && (langName === "urdu")) return "verse";
  return "prose";
}

function countWords(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

function extractSourceUrl(content: string): string | null {
  const m = content.match(/^Source:\s*(https?:\/\/\S+)/m);
  return m ? m[1]! : null;
}

function isGenericTitle(title: string | undefined): boolean {
  if (!title) return true;
  return /^(chapter|section|part|book|volume|verse)\s+\d+$/i.test(title.trim());
}

function isValidUTF8(content: string): boolean {
  // JS strings are UTF-16, so this is a structural check
  // Look for replacement char (0xFFFD) which indicates encoding damage
  return !content.includes("\ufffd");
}

// ─────────────────────────────────────────────────────────────────────────
// Audit pass
// ─────────────────────────────────────────────────────────────────────────

function auditCorpus(corpus: RawCorpus): {
  audited_works: AuditedWork[];
  audited_chapters: AuditedChapter[];
  summary: Record<string, unknown>;
} {
  const audited_works: AuditedWork[] = [];
  const audited_chapters: AuditedChapter[] = [];

  for (const work of corpus.works) {
    const work_flags: string[] = [];
    if (!work.id) work_flags.push("missing-id");
    if (!work.title) work_flags.push("missing-title");
    if (!work.author?.name) work_flags.push("missing-author-name");
    if (!work.author?.biography) work_flags.push("missing-author-bio");
    if (work.author && work.author.birth_year == null && work.author.death_year == null)
      work_flags.push("missing-author-dates");
    if (!work.language?.name) work_flags.push("missing-language");
    if (!work.era?.name) work_flags.push("missing-era");
    if (!work.genre?.name) work_flags.push("missing-genre");
    if (!work.description) work_flags.push("missing-description");
    if (!work.chapters || work.chapters.length === 0) work_flags.push("no-chapters");

    const layouts_detected = new Set<Layout>();
    let total_words = 0;

    for (const chapter of work.chapters ?? []) {
      const flags: string[] = [];
      if (!chapter.id) flags.push("missing-id");
      if (!chapter.content) flags.push("empty-content");
      if (chapter.content && !isValidUTF8(chapter.content)) flags.push("encoding-damage");

      const script = detectScript(chapter.content);
      const content_type = classifyContentType(work, chapter, script);
      const layout = classifyLayout(work, chapter, content_type);
      layouts_detected.add(layout);

      const word_count_actual = countWords(chapter.content);
      const word_count_stated = chapter.word_count ?? 0;
      const word_count_delta = word_count_actual - word_count_stated;
      total_words += word_count_actual;

      if (Math.abs(word_count_delta) > Math.max(50, word_count_stated * 0.1) && word_count_stated > 0) {
        flags.push(`word-count-mismatch(${word_count_delta > 0 ? "+" : ""}${word_count_delta})`);
      }

      const source_url = extractSourceUrl(chapter.content);
      const is_generic_title = isGenericTitle(chapter.title);
      if (is_generic_title) flags.push("generic-title");

      if (content_type === "unknown") flags.push("content-type-ambiguous");

      audited_chapters.push({
        work_id: work.id,
        work_title: work.title,
        chapter_id: chapter.id,
        chapter_number: chapter.chapter_number,
        chapter_title: chapter.title ?? "",
        content_type,
        layout,
        language_name: work.language?.name ?? "unknown",
        script,
        word_count_stated,
        word_count_actual,
        word_count_delta,
        has_image: !!chapter.image_url,
        has_source_url: !!source_url,
        source_url,
        is_generic_title,
        flags,
      });
    }

    audited_works.push({
      id: work.id,
      title: work.title,
      author_name: work.author?.name ?? "Unknown",
      language_name: work.language?.name ?? "unknown",
      era_name: work.era?.name ?? "Unknown",
      genre_name: work.genre?.name ?? "Unknown",
      chapter_count: work.chapters?.length ?? 0,
      total_words,
      layouts_detected: [...layouts_detected],
      flags: work_flags,
    });
  }

  // Aggregate summary
  const summary = {
    total_works: audited_works.length,
    total_chapters: audited_chapters.length,
    total_words: audited_chapters.reduce((s, c) => s + c.word_count_actual, 0),
    layout_distribution: {
      prose: audited_chapters.filter((c) => c.layout === "prose").length,
      verse: audited_chapters.filter((c) => c.layout === "verse").length,
      manuscript: audited_chapters.filter((c) => c.layout === "manuscript").length,
    },
    content_type_distribution: {
      original: audited_chapters.filter((c) => c.content_type === "original").length,
      transliteration: audited_chapters.filter((c) => c.content_type === "transliteration").length,
      translation: audited_chapters.filter((c) => c.content_type === "translation").length,
      unknown: audited_chapters.filter((c) => c.content_type === "unknown").length,
    },
    script_distribution: audited_chapters.reduce(
      (acc, c) => {
        acc[c.script] = (acc[c.script] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
    chapters_with_images: audited_chapters.filter((c) => c.has_image).length,
    chapters_with_source_urls: audited_chapters.filter((c) => c.has_source_url).length,
    chapters_with_generic_titles: audited_chapters.filter((c) => c.is_generic_title).length,
    chapters_with_flags: audited_chapters.filter((c) => c.flags.length > 0).length,
    works_with_flags: audited_works.filter((w) => w.flags.length > 0).length,
    flag_frequencies: audited_chapters
      .flatMap((c) => c.flags)
      .reduce(
        (acc, f) => {
          const key = f.replace(/\([^)]*\)/, "(...)");
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
  };

  return { audited_works, audited_chapters, summary };
}

// ─────────────────────────────────────────────────────────────────────────
// Report formatter
// ─────────────────────────────────────────────────────────────────────────

function formatMarkdownReport(
  audited_works: AuditedWork[],
  audited_chapters: AuditedChapter[],
  summary: Record<string, unknown>,
  source_meta: { source: string; exported_at: string },
): string {
  const lines: string[] = [];
  lines.push("# Falsafa — Corpus Audit Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Source: \`${source_meta.source}\` (exported ${source_meta.exported_at})`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total works:** ${summary.total_works}`);
  lines.push(`- **Total chapters:** ${summary.total_chapters}`);
  lines.push(`- **Total words:** ${(summary.total_words as number).toLocaleString()}`);
  lines.push("");
  lines.push("### Layout distribution");
  lines.push("");
  const layoutDist = summary.layout_distribution as Record<Layout, number>;
  const totalCh = summary.total_chapters as number;
  lines.push("| Layout | Chapters | % |");
  lines.push("|--------|---------:|--:|");
  for (const [k, v] of Object.entries(layoutDist)) {
    lines.push(`| ${k} | ${v} | ${((v / totalCh) * 100).toFixed(1)}% |`);
  }
  lines.push("");
  lines.push("### Content-type distribution");
  lines.push("");
  const ctDist = summary.content_type_distribution as Record<ContentType, number>;
  lines.push("| Type | Chapters | % |");
  lines.push("|------|---------:|--:|");
  for (const [k, v] of Object.entries(ctDist)) {
    lines.push(`| ${k} | ${v} | ${((v / totalCh) * 100).toFixed(1)}% |`);
  }
  lines.push("");
  lines.push("### Script distribution");
  lines.push("");
  lines.push("| Script | Chapters |");
  lines.push("|--------|---------:|");
  for (const [k, v] of Object.entries(summary.script_distribution as Record<string, number>)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push("");
  lines.push("### Quality flags");
  lines.push("");
  lines.push(`- Chapters with images (\`layout: manuscript\`): ${summary.chapters_with_images}`);
  lines.push(`- Chapters with extractable source URLs: ${summary.chapters_with_source_urls}`);
  lines.push(
    `- Chapters with generic titles ("Chapter N"): ${summary.chapters_with_generic_titles} (${(((summary.chapters_with_generic_titles as number) / totalCh) * 100).toFixed(1)}%)`,
  );
  lines.push(`- Chapters with any flag: ${summary.chapters_with_flags}`);
  lines.push(`- Works with any flag: ${summary.works_with_flags}`);
  lines.push("");
  lines.push("### Flag frequencies");
  lines.push("");
  lines.push("| Flag | Count |");
  lines.push("|------|------:|");
  const flagFreqs = summary.flag_frequencies as Record<string, number>;
  for (const [flag, count] of Object.entries(flagFreqs).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${flag}\` | ${count} |`);
  }
  lines.push("");
  lines.push("## Per-work breakdown");
  lines.push("");
  lines.push("| Title | Author | Language | Era | Chapters | Words | Layouts | Flags |");
  lines.push("|-------|--------|----------|-----|---------:|------:|---------|-------|");
  for (const w of audited_works.sort((a, b) => b.chapter_count - a.chapter_count)) {
    const flags = w.flags.length > 0 ? `\`${w.flags.join("`, `")}\`` : "—";
    lines.push(
      `| ${w.title} | ${w.author_name} | ${w.language_name} | ${w.era_name} | ${w.chapter_count} | ${w.total_words.toLocaleString()} | ${w.layouts_detected.join(", ")} | ${flags} |`,
    );
  }
  lines.push("");
  lines.push("## Sample of flagged chapters");
  lines.push("");
  const flagged = audited_chapters.filter((c) => c.flags.length > 0);
  if (flagged.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Work | Ch# | Title | Layout | Type | Flags |");
    lines.push("|------|----:|-------|--------|------|-------|");
    for (const c of flagged.slice(0, 30)) {
      const t = c.chapter_title.length > 40 ? c.chapter_title.slice(0, 37) + "..." : c.chapter_title;
      lines.push(
        `| ${c.work_title} | ${c.chapter_number} | ${t} | ${c.layout} | ${c.content_type} | \`${c.flags.join("`, `")}\` |`,
      );
    }
    if (flagged.length > 30) {
      lines.push("");
      lines.push(`...and ${flagged.length - 30} more. See \`corpus-audit.json\` for the full list.`);
    }
  }
  lines.push("");
  lines.push("## What this report blocks");
  lines.push("");
  lines.push(
    "- **Generic chapter titles** affect URL slugs. The convert script uses the chapter number when the title is generic. Titles flagged here will produce URLs like `/works/.../01/` instead of `/works/.../01-the-mermedonians/`.",
  );
  lines.push(
    "- **Word-count mismatches** suggest the source field was computed from different content than what shipped. The convert script uses the actual computed count.",
  );
  lines.push(
    "- **Content-type-ambiguous** chapters need manual review. The convert script defaults them to `original` and surfaces a TODO.",
  );
  lines.push(
    "- **Verse layout coverage** is dominant (~71% of chapters). The verse renderer plus the stanza-segmentation pass are V1 blockers, not nice-to-haves.",
  );
  lines.push("");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────

function main(): void {
  const root = resolve(import.meta.dir, "..");
  const worksJsonPath = resolve(root, "works.json");
  const reportMdPath = resolve(root, "docs/corpus-audit.md");
  const reportJsonPath = resolve(root, "corpus-audit.json");

  console.log(`Reading ${worksJsonPath} ...`);
  const raw = readFileSync(worksJsonPath, "utf-8");
  const corpus = JSON.parse(raw) as RawCorpus;

  console.log(`Auditing ${corpus.works.length} works ...`);
  const { audited_works, audited_chapters, summary } = auditCorpus(corpus);

  const md = formatMarkdownReport(audited_works, audited_chapters, summary, {
    source: corpus.source ?? "unknown",
    exported_at: corpus.exported_at ?? "unknown",
  });

  mkdirSync(dirname(reportMdPath), { recursive: true });
  writeFileSync(reportMdPath, md, "utf-8");
  console.log(`Wrote ${reportMdPath}`);

  writeFileSync(
    reportJsonPath,
    JSON.stringify({ summary, audited_works, audited_chapters }, null, 2),
    "utf-8",
  );
  console.log(`Wrote ${reportJsonPath}`);

  // Print summary to stdout
  console.log("");
  console.log("=== Summary ===");
  console.log(`Works: ${summary.total_works}`);
  console.log(`Chapters: ${summary.total_chapters}`);
  console.log(`Words: ${(summary.total_words as number).toLocaleString()}`);
  console.log(`Layout distribution: ${JSON.stringify(summary.layout_distribution)}`);
  console.log(`Content-type distribution: ${JSON.stringify(summary.content_type_distribution)}`);
  console.log(`Chapters with flags: ${summary.chapters_with_flags}`);
  console.log(`Works with flags: ${summary.works_with_flags}`);
}

main();
