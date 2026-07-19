import { slugify } from "../lib/slug";
import type { CitationGraph, GraphEdge, GraphNode, ResolvedReference } from "./types";

export function buildCitationGraph(
  resolved: ResolvedReference[],
  workLabels: Map<string, string>,
): CitationGraph {
  const nodes = new Map<string, GraphNode>();
  const ensure = (id: string, kind: GraphNode["kind"], label: string, inCorpus: boolean) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, in_corpus: inCorpus, cited_by_count: 0 });
  };
  const edges: GraphEdge[] = [];

  for (const ref of resolved) {
    if (ref.status === "ambiguous") continue; // leave for review, no edge
    ensure(ref.citing_work_slug, "work", workLabels.get(ref.citing_work_slug) ?? ref.citing_work_slug, true);

    let toId: string;
    if (ref.status === "in_corpus_work") { toId = ref.target_id!; ensure(toId, "work", ref.raw_target, true); }
    else if (ref.status === "in_corpus_author") { toId = ref.target_id!; ensure(toId, "author", ref.raw_target, true); }
    else { toId = `absent:${slugify(ref.raw_target)}`; ensure(toId, "absent", ref.raw_target, false); }

    const existing = edges.find((e) => e.from === ref.citing_work_slug && e.to === toId && e.stance === ref.stance);
    if (existing) existing.citations.push({ paragraph_id: ref.citing_paragraph_id, quote: ref.quote });
    else edges.push({ from: ref.citing_work_slug, to: toId, type: "cites", stance: ref.stance,
      citations: [{ paragraph_id: ref.citing_paragraph_id, quote: ref.quote }] });
  }
  return { nodes: [...nodes.values()], edges };
}

export function withBacklinks(graph: CitationGraph): CitationGraph {
  const counts = new Map<string, number>();
  for (const e of graph.edges) counts.set(e.to, (counts.get(e.to) ?? 0) + 1);
  return { edges: graph.edges, nodes: graph.nodes.map((n) => ({ ...n, cited_by_count: counts.get(n.id) ?? 0 })) };
}
