import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildCorpusIndex, resolveReference } from "./resolve-references";
import { buildAcquisitionList } from "./acquisition-list";
import { buildCitationGraph, withBacklinks } from "./build-graph";
import { EXTRACT_VERSION, getReferences } from "./extract-references";
import type { Manifest, RawReference } from "./types";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = join(ROOT, "corpus");
const OUT = join(CORPUS, "graph");
const RAW_DIR = join(OUT, "raw", EXTRACT_VERSION);

const PILOT = [
  "unknown-manusmrti-347b76", "unknown-yajnavalkya-smrti-cb88d6", "unknown-parasara-smrti-2259be",
  "charles-comte-traite-de-legislation-vol-iv-bca040", "thomas-clarkson-an-essay-on-the-slavery-and-comm-60b084",
  "paul-popenoe-and-roswell-applied-eugenics-d3c68e", "frederick-douglass-the-life-and-times-of-frederick--7be09c",
];

function isCached(slug: string): boolean {
  return existsSync(join(RAW_DIR, `${slug}.json`));
}

async function main() {
  const manifest = JSON.parse(await Bun.file(join(CORPUS, "manifest.json")).text()) as Manifest;
  const index = buildCorpusIndex(manifest);
  const labels = new Map(manifest.works.map((w) => [w.slug, w.title]));

  // --- Change 2: batch selector ---
  const argv = process.argv.slice(2);
  let batchSlugs: string[];

  if (argv[0] === "--next") {
    const n = argv[1] !== undefined ? parseInt(argv[1], 10) : 15;
    batchSlugs = manifest.works
      .map((w) => w.slug)
      .filter((slug) => !isCached(slug))
      .slice(0, n);
    console.log(`--next ${n}: selected ${batchSlugs.length} uncached slugs`);
  } else if (argv.length > 0) {
    batchSlugs = argv;
  } else {
    batchSlugs = PILOT;
  }

  // --- Change 1a: extract this batch (adds to cache only) ---
  for (const slug of batchSlugs) {
    const chapterDirs = readdirSync(join(CORPUS, "works", slug, "chapters"));
    await getReferences(CORPUS, slug, chapterDirs);
    console.log(`cached ${slug}`);
  }

  // --- Change 1b: build graph from ALL cached works ---
  const raw: RawReference[] = [];
  if (existsSync(RAW_DIR)) {
    for (const file of readdirSync(RAW_DIR)) {
      if (!file.endsWith(".json")) continue;
      const refs = JSON.parse(readFileSync(join(RAW_DIR, file), "utf-8")) as RawReference[];
      raw.push(...refs);
    }
  }
  const cacheFiles = existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((f) => f.endsWith(".json")) : [];
  console.log(`building graph from ${cacheFiles.length} cached works, ${raw.length} total refs`);

  const resolved = raw.map((r) => resolveReference(r, index));
  const graph = withBacklinks(buildCitationGraph(resolved, labels));
  const acquisition = buildAcquisitionList(resolved);

  // --- Change 3: ambiguous refs to review.json ---
  const ambiguous = resolved.filter((r) => r.status === "ambiguous");

  const stats = {
    processed_works: cacheFiles.length,
    references: resolved.length,
    in_corpus: resolved.filter((r) => r.status.startsWith("in_corpus")).length,
    absent: resolved.filter((r) => r.status === "absent").length,
    ambiguous: ambiguous.length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "citation-graph.json"), JSON.stringify(graph, null, 2));
  writeFileSync(join(OUT, "acquisition-list.json"), JSON.stringify(acquisition, null, 2));
  writeFileSync(join(OUT, "stats.json"), JSON.stringify(stats, null, 2));
  writeFileSync(join(OUT, "review.json"), JSON.stringify(ambiguous, null, 2));
  console.log(stats);
}
main();
