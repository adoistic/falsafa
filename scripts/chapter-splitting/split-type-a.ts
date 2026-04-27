#!/usr/bin/env bun
/**
 * TYPE_A chapter splitter — auto-splits works whose verse markers carry
 * a chapter index (Mn_1.5, Yj_2.10, Vi_50.3 etc).
 *
 * The pipeline lives in lib/orchestrator.ts and is shared with TYPE_C
 * and the held-case one-off splitters. This file only owns the TYPE_A
 * marker parser: paragraph-trailing tokens, native-prefix filtering,
 * implausible/backwards drop, "after_chapter" cut semantics.
 *
 * Usage:
 *   bun run scripts/chapter-splitting/split-type-a.ts --dry-run
 *   bun run scripts/chapter-splitting/split-type-a.ts --only unknown-yajnavalkya-smrti-cb88d6
 *   bun run scripts/chapter-splitting/split-type-a.ts --apply
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseVerseMarkers,
  filterToNativePrefix,
  dropImplausibleMarkers,
  dropBackwardsMarkers,
} from "./lib/parser.ts";
import {
  parseArgs,
  runOrchestrator,
  type ParseFunc,
} from "./lib/orchestrator.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = resolve(ROOT, "corpus");
const DISCOVERY_PATH = resolve(import.meta.dir, "discovery.json");

// ─────────────────────────────────────────────────────────────────────────
// TYPE_A parser
// ─────────────────────────────────────────────────────────────────────────

const typeAParseFunc: ParseFunc = (body, _filename) => {
  const allMarkers = parseVerseMarkers(body);
  const { native_prefix, native_markers: rawNativeMarkers, citation_markers } = filterToNativePrefix(allMarkers);
  const { kept: plausibleMarkers, dropped: dropped_implausible } = dropImplausibleMarkers(rawNativeMarkers);
  const { kept: native_markers, dropped: dropped_backwards } = dropBackwardsMarkers(plausibleMarkers);

  const notes: string[] = [];
  if (dropped_implausible.length > 0) {
    notes.push(`dropped ${dropped_implausible.length} implausible marker(s) (chapter > 250) — source-format glitches`);
  }
  if (dropped_backwards.length > 0) {
    const samples = dropped_backwards.slice(0, 3).map((m) => `${m.prefix}_${m.chapter}.${m.verse}`).join(", ");
    notes.push(`dropped ${dropped_backwards.length} backwards/duplicate marker(s) — inline citations [${samples}${dropped_backwards.length > 3 ? ", …" : ""}]`);
  }

  return {
    native_prefix,
    native_markers,
    citation_markers,
    marker_position: "after_chapter",
    notes,
  };
};

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
    .filter((p) => p.classification === "TYPE_A")
    .map((p) => ({ slug: p.slug, title: p.title }));

  await runOrchestrator({
    classification: "TYPE_A",
    slugs,
    parseFunc: typeAParseFunc,
    corpusRoot: CORPUS,
    args,
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
