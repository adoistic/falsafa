import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findTargetPassages } from "./fidelity";
import type { CitationGraph, GraphEdge, GraphNode, Manifest } from "./types";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = join(ROOT, "corpus");

interface Paragraph { id: string; text: string; }

// Load all paragraphs for a work slug, trying translation first, then original.
// Returns empty array if work has no chapters or no paragraph files.
function loadWorkParagraphs(workSlug: string): Paragraph[] {
  const chaptersDir = join(CORPUS, "works", workSlug, "chapters");
  if (!existsSync(chaptersDir)) return [];
  const paragraphs: Paragraph[] = [];
  for (const chName of readdirSync(chaptersDir).sort()) {
    const chDir = join(chaptersDir, chName);
    const translationFile = join(chDir, "translation.paragraphs.json");
    const originalFile = join(chDir, "original.paragraphs.json");
    const paraFile = existsSync(translationFile) ? translationFile
                   : existsSync(originalFile)    ? originalFile
                   : null;
    if (!paraFile) continue;
    try {
      const paras = JSON.parse(readFileSync(paraFile, "utf-8")) as Paragraph[];
      paragraphs.push(...paras);
    } catch {
      // malformed file — skip
    }
  }
  return paragraphs;
}

function main() {
  const graphPath = join(CORPUS, "graph", "citation-graph.json");
  const graph = JSON.parse(readFileSync(graphPath, "utf-8")) as CitationGraph;
  const manifest = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf-8")) as Manifest;

  // Build lookup: author_slug → work slugs
  const authorToWorks = new Map<string, string[]>();
  for (const w of manifest.works) {
    const arr = authorToWorks.get(w.author_slug) ?? [];
    arr.push(w.slug);
    authorToWorks.set(w.author_slug, arr);
  }

  // Node lookup
  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));

  // Paragraph cache: work_slug → paragraphs (memoized)
  const paraCache = new Map<string, Paragraph[]>();
  function getWorkParagraphs(slug: string): Paragraph[] {
    if (!paraCache.has(slug)) {
      paraCache.set(slug, loadWorkParagraphs(slug));
    }
    return paraCache.get(slug)!;
  }

  let inCorpusCount = 0;
  let annotatedCount = 0;

  for (const edge of graph.edges as (GraphEdge & { target_passages?: ReturnType<typeof findTargetPassages> })[]) {
    const targetNode = nodeMap.get(edge.to);
    if (!targetNode?.in_corpus) continue;
    inCorpusCount++;

    // Resolve which work slug(s) to load paragraphs from
    let workSlugs: string[];
    if (targetNode.kind === "work") {
      workSlugs = [targetNode.id];
    } else {
      // kind === "author" — load all works for this author
      workSlugs = authorToWorks.get(targetNode.id) ?? [];
    }

    // Collect target paragraphs (memoized per slug)
    const targetParas: Paragraph[] = [];
    for (const slug of workSlugs) {
      targetParas.push(...getWorkParagraphs(slug));
    }
    if (targetParas.length === 0) continue;

    // Build citing quote from first 3 citations
    const joinedQuote = edge.citations.slice(0, 3).map((c) => c.quote).join(" ");

    const matches = findTargetPassages(joinedQuote, targetParas, 3, 1);
    edge.target_passages = matches;
    if (matches.length > 0) annotatedCount++;
  }

  writeFileSync(graphPath, JSON.stringify(graph, null, 2));

  console.log(`\nFidelity pass complete`);
  console.log(`  Total in-corpus edges : ${inCorpusCount}`);
  console.log(`  Edges with ≥1 match   : ${annotatedCount}`);

  // Report Say → adam-smith edges
  const sayEdges = (graph.edges as (GraphEdge & { target_passages?: ReturnType<typeof findTargetPassages> })[])
    .filter((e) => e.from === "jean-baptiste-say-a-treatise-on-political-economy--3bbda3" && e.to === "adam-smith");

  console.log(`\nSay → adam-smith edges (${sayEdges.length}):`);
  for (const e of sayEdges) {
    console.log(`  stance: ${e.stance}`);
    for (const tp of e.target_passages ?? []) {
      console.log(`    paragraph_id: ${tp.paragraph_id}  score: ${tp.score}`);
      console.log(`    snippet: ${tp.snippet}`);
    }
  }
}

main();
