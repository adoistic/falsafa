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
import { parseArgs, processWork, type ParseFunc } from "./lib/orchestrator.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = resolve(ROOT, "corpus");
const DISCOVERY_PATH = resolve(import.meta.dir, "discovery.json");

// ─────────────────────────────────────────────────────────────────────────
// Per-work heading configs
// ─────────────────────────────────────────────────────────────────────────
//
// Each entry encodes "what heading shape opens a chapter in this work."
// Kept here, not in discovery.json, because these are translator-specific
// editorial decisions, not facts about the source corpus.

const TYPE_C_CONFIGS: Record<string, ProseHeadingConfig> = {
  // Bṛhaspati: ## Chapter N: <title> opens each chapter (22 ## total but
  // only the "Chapter N" ones are real boundaries; the others are
  // mis-leveled subsections like "## 1.10 The Recovery of Debt").
  "unknown-brhaspati-smrti-0fd070": {
    depth: 2,
    pattern: /^Chapter\s+\d+/i,
  },
  // Kalpabuddha: ### Paragraph N (7 numbered paragraphs, no other ###).
  "unknown-kalpabuddha-d760dc": {
    depth: 3,
    pattern: /^Paragraph\s+\d+/i,
  },
  // Kātyāyana: 80 flat ## sections, no Chapter wrapper, no other depth.
  "unknown-katyayana-smrti-1e06d2": {
    depth: 2,
  },
  // Kunjarakarna: ## Canto N (34 cantos). Discovery counted 34, source
  // also has them but no other ## at that depth.
  "unknown-kunjarakarna-dharmakathana-894f4a": {
    depth: 2,
    pattern: /^Canto\s+\d+/i,
  },
  // Vīramitrodaya: ### [<determination>] (70 of these).
  "unknown-viramitrodaya-d4b632": {
    depth: 3,
    pattern: /^\[/,
  },
  // Fichte: each variant has 3 ## sections but the first IS the work
  // title (German: "## Zurückforderung..."; English: "## Reclaiming
  // Freedom of Thought..."). Skip the title; keep Preface + Speech (= 2
  // chapters). Both languages start with the work-title repeat.
  "johann-gottlieb-fichte-zuruckforderung-der-denkfreiheit-bookde": {
    depth: 2,
    skipPattern: /^(?:Reclaiming\s+Freedom\s+of\s+Thought|Zurückforderung\s+der\s+Denkfreiheit)/i,
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Build a parser bound to the per-work config
// ─────────────────────────────────────────────────────────────────────────

function makeParseFunc(slug: string): ParseFunc {
  const config = TYPE_C_CONFIGS[slug];
  if (!config) {
    throw new Error(`No TYPE_C config registered for slug: ${slug}. Add an entry to TYPE_C_CONFIGS in split-type-c.ts.`);
  }
  return (body, _filename) => {
    const markers = parseProseHeadings(body, config);
    const notes: string[] = [];
    if (markers.length === 0) {
      notes.push(`no markdown headings matched config (depth=${config.depth}${config.pattern ? `, pattern=${config.pattern}` : ""})`);
    }
    return {
      native_prefix: "Ch",
      native_markers: markers,
      citation_markers: [],
      marker_position: "before_chapter",
      notes,
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
