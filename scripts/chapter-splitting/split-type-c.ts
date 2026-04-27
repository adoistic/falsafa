#!/usr/bin/env bun
/**
 * TYPE_C chapter splitter — auto-splits works whose chapters are
 * demarcated by markdown ATX headings (`## Chapter 1:`, `### Paragraph
 * 4`, `## Canto 12`, etc.). Heading depth and text-shape filter are
 * per-work because each translator/source picked a different convention.
 *
 * Pipeline shared with TYPE_A via lib/orchestrator.ts.
 *
 * Usage:
 *   bun run scripts/chapter-splitting/split-type-c.ts --dry-run
 *   bun run scripts/chapter-splitting/split-type-c.ts --only unknown-katyayana-smrti-1e06d2
 *   bun run scripts/chapter-splitting/split-type-c.ts --apply
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseProseHeadings, type ProseHeadingConfig } from "./lib/parser-prose-heading.ts";
import { parseBracketedSections, type BracketedSectionConfig } from "./lib/parser-bracketed-section.ts";
import { parseArgs, processWork, type ParseFunc } from "./lib/orchestrator.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = resolve(ROOT, "corpus");
const DISCOVERY_PATH = resolve(import.meta.dir, "discovery.json");

// ─────────────────────────────────────────────────────────────────────────
// Per-work / per-variant parser configs
// ─────────────────────────────────────────────────────────────────────────
//
// Each work declares a parser config either GLOBALLY (same parser for all
// variants — the simple case) or PER-VARIANT (variants use different
// marker syntaxes — Sanskrit smṛti translations vs Old Javanese / romanized
// transliterations of the same work). Per-variant dispatch is keyed on
// filename ("translation.md", "transliteration.md", etc.).

type VariantParser =
  | { kind: "prose-heading"; config: ProseHeadingConfig }
  | { kind: "bracketed-section"; config: BracketedSectionConfig };

interface TypeCWorkConfig {
  /** Single-parser config used for every variant when no per-variant
   *  override exists. */
  default?: VariantParser;
  /** Per-variant override — { "transliteration.md": <parser>, ... }. */
  perVariant?: Record<string, VariantParser>;
  /** Override the no-empty-chapter validator threshold for this work.
   *  Default 20 chars; lower (or 0) when source has heading-only sections. */
  minContentChars?: number;
}

const TYPE_C_CONFIGS: Record<string, TypeCWorkConfig> = {
  // Bṛhaspati: HELD — translation has 2 chapters (## Chapter N), but the
  // transliteration source only carries Brh_1,*.* markers (chapter 1
  // only). Asymmetric variants need validator relaxation we don't have.
  // Kept here for future when source data covers chapter 2 too.
  "unknown-brhaspati-smrti-0fd070": {
    default: { kind: "prose-heading", config: { depth: 2, pattern: /^Chapter\s+\d+/i } },
  },
  // Kalpabuddha: ### Paragraph N (7 numbered paragraphs, no other ###).
  "unknown-kalpabuddha-d760dc": {
    default: { kind: "prose-heading", config: { depth: 3, pattern: /^Paragraph\s+\d+/i } },
  },
  // Kātyāyana: per-variant dispatch. Translation has 80 flat ## sections.
  // Transliteration has 80 [<sanskrit-name>] bracketed lines marking the
  // same 80 sections. Both produce the same chapter sequence (1..80) —
  // the bracket text doesn't drive numbering, the order does. Lower the
  // empty-chapter threshold to 5 because section 48 is a heading-only
  // section in the source (translation: "## The Recovery of Debt", 23
  // chars; transliteration: "[ṛṇoddharaṇaṃ]", 14 chars) — the heading
  // IS the content for that section.
  "unknown-katyayana-smrti-1e06d2": {
    perVariant: {
      "translation.md": { kind: "prose-heading", config: { depth: 2 } },
      "transliteration.md": { kind: "bracketed-section", config: {} },
    },
    minContentChars: 5,
  },
  // Kunjarakarna: HELD — translation Canto 8–41, transliteration Canto
  // 1–41. Translation is partial (missing cantos 1–7). Cross-variant
  // chapter sets disagree by design; needs source-data alignment, not
  // engineering.
  "unknown-kunjarakarna-dharmakathana-894f4a": {
    default: { kind: "prose-heading", config: { depth: 2, pattern: /^Canto\s+\d+/i } },
  },
  // Vīramitrodaya: HELD — translation has 70 ### [...] sections,
  // transliteration has 270 {MV-S_N} curly tokens + 2 brackets. Different
  // granularity, no clean alignment.
  "unknown-viramitrodaya-d4b632": {
    default: { kind: "prose-heading", config: { depth: 3, pattern: /^\[/ } },
  },
  // Fichte: each variant has 3 ## sections but the first IS the work
  // title (German: "## Zurückforderung..."; English: "## Reclaiming
  // Freedom of Thought..."). Skip the title; keep Preface + Speech (= 2
  // chapters). Both languages start with the work-title repeat.
  "johann-gottlieb-fichte-zuruckforderung-der-denkfreiheit-bookde": {
    default: {
      kind: "prose-heading",
      config: {
        depth: 2,
        skipPattern: /^(?:Reclaiming\s+Freedom\s+of\s+Thought|Zurückforderung\s+der\s+Denkfreiheit)/i,
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Build a per-variant parser using the work + filename
// ─────────────────────────────────────────────────────────────────────────

function runVariantParser(parser: VariantParser, body: string) {
  if (parser.kind === "prose-heading") {
    return parseProseHeadings(body, parser.config);
  }
  if (parser.kind === "bracketed-section") {
    return parseBracketedSections(body, parser.config);
  }
  throw new Error(`Unknown variant parser kind: ${(parser as { kind: string }).kind}`);
}

function makeParseFunc(slug: string): ParseFunc {
  const config = TYPE_C_CONFIGS[slug];
  if (!config) {
    throw new Error(`No TYPE_C config registered for slug: ${slug}. Add an entry to TYPE_C_CONFIGS in split-type-c.ts.`);
  }
  return (body, filename) => {
    const variantParser = config.perVariant?.[filename] ?? config.default;
    if (!variantParser) {
      return {
        native_prefix: "Ch",
        native_markers: [],
        citation_markers: [],
        marker_position: "before_chapter",
        notes: [`no parser registered for variant ${filename} on ${slug}`],
        ...(config.minContentChars !== undefined ? { min_content_chars: config.minContentChars } : {}),
      };
    }
    const markers = runVariantParser(variantParser, body);
    const notes: string[] = [];
    if (markers.length === 0) {
      notes.push(`no markers detected by ${variantParser.kind} parser`);
    }
    return {
      native_prefix: "Ch",
      native_markers: markers,
      citation_markers: [],
      marker_position: "before_chapter",
      notes,
      ...(config.minContentChars !== undefined ? { min_content_chars: config.minContentChars } : {}),
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Entry
// ─────────────────────────────────────────────────────────────────────────

interface DiscoveryPlan {
  slug: string;
  title: string;
  classification: string;
}

interface DiscoveryFile {
  generated_at: string;
  plans: DiscoveryPlan[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const discovery = JSON.parse(readFileSync(DISCOVERY_PATH, "utf-8")) as DiscoveryFile;
  const slugs = discovery.plans
    .filter((p) => p.classification === "TYPE_C")
    .map((p) => ({ slug: p.slug, title: p.title }));
  const targets = args.only ? slugs.filter((s) => s.slug === args.only) : slugs;
  if (args.only && targets.length === 0) {
    console.error(`No TYPE_C work matches slug: ${args.only}`);
    process.exit(1);
  }

  // Each TYPE_C work has its own heading config, so we drive the
  // orchestrator's per-work function directly with a bound parser.
  console.log(`Mode: ${args.apply ? "APPLY (will write)" : "DRY-RUN (no changes)"}`);
  console.log(`Classification: TYPE_C`);
  console.log(`Works to process: ${targets.length}`);

  let allOk = true;
  let appliedCount = 0;
  for (const t of targets) {
    try {
      const r = processWork({
        slug: t.slug,
        title: t.title,
        parseFunc: makeParseFunc(t.slug),
        corpusRoot: CORPUS,
        args,
      });
      if (!r.ok) allOk = false;
      if (r.applied) appliedCount++;
    } catch (err) {
      console.error(`\n${t.slug}: FATAL — ${(err as Error).message}`);
      allOk = false;
    }
  }
  if (args.apply) console.log(`\nApplied to ${appliedCount} works.`);
  else console.log(`\nDry-run complete. Use --apply to write.`);
  if (!allOk) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
