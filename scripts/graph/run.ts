import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildCorpusIndex, resolveReference } from "./resolve-references";
import { buildAcquisitionList } from "./acquisition-list";
import { buildCitationGraph, withBacklinks } from "./build-graph";
import { extractReferences } from "./extract-references";
import type { Manifest, RawReference } from "./types";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = join(ROOT, "corpus");
const OUT = join(CORPUS, "graph");

const PILOT = [
  "unknown-manusmrti-347b76", "unknown-yajnavalkya-smrti-cb88d6", "unknown-parasara-smrti-2259be",
  "charles-comte-traite-de-legislation-vol-iv-bca040", "thomas-clarkson-an-essay-on-the-slavery-and-comm-60b084",
  "paul-popenoe-and-roswell-applied-eugenics-d3c68e", "frederick-douglass-the-life-and-times-of-frederick--7be09c",
];

async function main() {
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : PILOT;
  const manifest = JSON.parse(await Bun.file(join(CORPUS, "manifest.json")).text()) as Manifest;
  const index = buildCorpusIndex(manifest);
  const labels = new Map(manifest.works.map((w) => [w.slug, w.title]));

  const raw: RawReference[] = [];
  for (const slug of slugs) {
    const chapterDirs = readdirSync(join(CORPUS, "works", slug, "chapters"));
    raw.push(...(await extractReferences(CORPUS, slug, chapterDirs)));
    console.log(`extracted ${raw.length} refs (through ${slug})`);
  }

  const resolved = raw.map((r) => resolveReference(r, index));
  const graph = withBacklinks(buildCitationGraph(resolved, labels));
  const acquisition = buildAcquisitionList(resolved);
  const stats = {
    works: slugs.length, references: resolved.length,
    in_corpus: resolved.filter((r) => r.status.startsWith("in_corpus")).length,
    absent: resolved.filter((r) => r.status === "absent").length,
    ambiguous: resolved.filter((r) => r.status === "ambiguous").length,
    nodes: graph.nodes.length, edges: graph.edges.length,
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "citation-graph.json"), JSON.stringify(graph, null, 2));
  writeFileSync(join(OUT, "acquisition-list.json"), JSON.stringify(acquisition, null, 2));
  writeFileSync(join(OUT, "stats.json"), JSON.stringify(stats, null, 2));
  console.log(stats);
}
main();
