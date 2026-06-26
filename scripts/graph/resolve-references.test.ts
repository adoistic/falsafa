import { describe, expect, test } from "bun:test";
import { buildCorpusIndex, resolveReference } from "./resolve-references";
import type { Manifest, RawReference } from "./types";

const manifest: Manifest = {
  works: [
    { slug: "adam-smith-an-inquiry-into-the-nature-and-c-915b31", title: "An Inquiry into the Nature and Causes of the Wealth of Nations", author: "Adam Smith", author_slug: "adam-smith" },
    { slug: "charles-comte-traite-de-legislation-vol-iv-bca040", title: "Traité de Législation: VOL IV", author: "Charles Comte", author_slug: "charles-comte" },
    { slug: "auguste-comte-cours-de-philosophie-positive-aa1111", title: "Cours de philosophie positive", author: "Auguste Comte", author_slug: "auguste-comte" },
    { slug: "unknown-manusmrti-347b76", title: "Manusmṛti", author: "Manu", author_slug: "manu" },
  ],
};
const index = buildCorpusIndex(manifest);
const ref = (raw: string, kind: "work" | "author"): RawReference => ({
  citing_work_slug: "x", citing_paragraph_id: "p-000000", raw_target: raw, target_kind: kind, stance: "authority", quote: "...",
});

describe("resolveReference", () => {
  test("partial work title resolves by containment", () => {
    const r = resolveReference(ref("the Wealth of Nations", "work"), index);
    expect(r.status).toBe("in_corpus_work");
    expect(r.target_id).toBe("adam-smith-an-inquiry-into-the-nature-and-c-915b31");
  });

  test("author name resolves to author node", () => {
    const r = resolveReference(ref("Manu", "author"), index);
    expect(r.status).toBe("in_corpus_author");
    expect(r.target_id).toBe("manu");
  });

  test("shared surname is ambiguous, not a silent pick", () => {
    const r = resolveReference(ref("Comte", "author"), index);
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.sort()).toEqual(["auguste-comte", "charles-comte"]);
  });

  test("unknown target is absent", () => {
    const r = resolveReference(ref("Peckard's sermon", "work"), index);
    expect(r.status).toBe("absent");
    expect(r.target_id).toBeNull();
  });
});
