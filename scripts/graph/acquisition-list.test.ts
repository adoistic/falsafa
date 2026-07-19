import { describe, expect, test } from "bun:test";
import { buildAcquisitionList } from "./acquisition-list";
import type { ResolvedReference } from "./types";

const r = (raw: string, status: ResolvedReference["status"], work: string, p: string): ResolvedReference => ({
  citing_work_slug: work, citing_paragraph_id: p, raw_target: raw, target_kind: "author",
  stance: "authority", quote: "...", status, target_id: null, candidates: [],
});

describe("buildAcquisitionList", () => {
  test("ranks absent targets by citation count and ignores resolved ones", () => {
    const list = buildAcquisitionList([
      r("Pearson", "absent", "eugenics", "p-1"),
      r("Pearson", "absent", "eugenics", "p-2"),
      r("Peckard", "absent", "clarkson", "p-3"),
      r("Manu", "in_corpus_author", "parasara", "p-4"),
    ]);
    expect(list.map((e) => e.normalized_target)).toEqual(["pearson", "peckard"]);
    expect(list[0]!.citation_count).toBe(2);
    expect(list[0]!.cited_by).toHaveLength(2);
    expect(list[0]!.mentions).toHaveLength(2);
    expect(list[0]!.mentions[0]!.stance).toBe("authority");
    expect(list[0]!.mentions[0]!.quote).toBe("...");
  });
});
