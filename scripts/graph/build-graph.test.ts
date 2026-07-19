import { describe, expect, test } from "bun:test";
import { buildCitationGraph, withBacklinks } from "./build-graph";
import type { ResolvedReference } from "./types";

const citing = new Map([["parasara", "Parāśara Smṛti"], ["manu", "Manusmṛti"]]);
const resolved: ResolvedReference[] = [
  { citing_work_slug: "parasara", citing_paragraph_id: "p-8991a9", raw_target: "Manu", target_kind: "author",
    stance: "authority", quote: "thus has Manu declared", status: "in_corpus_author", target_id: "manu", candidates: [] },
  { citing_work_slug: "eugenics", citing_paragraph_id: "p-286681", raw_target: "Pearson", target_kind: "author",
    stance: "endorse", quote: "...", status: "absent", target_id: null, candidates: [] },
];

describe("buildCitationGraph", () => {
  test("creates work + target nodes and a cites edge", () => {
    const g = buildCitationGraph(resolved, citing);
    expect(g.edges).toHaveLength(2);
    const manuEdge = g.edges.find((e) => e.to === "manu")!;
    expect(manuEdge.from).toBe("parasara");
    expect(manuEdge.citations[0]!.paragraph_id).toBe("p-8991a9");
    expect(g.nodes.find((n) => n.id === "manu")!.in_corpus).toBe(true);
    expect(g.nodes.find((n) => n.id.startsWith("absent:"))!.in_corpus).toBe(false);
  });

  test("withBacklinks counts inbound citations", () => {
    const g = withBacklinks(buildCitationGraph(resolved, citing));
    expect(g.nodes.find((n) => n.id === "manu")!.cited_by_count).toBe(1);
  });
});
