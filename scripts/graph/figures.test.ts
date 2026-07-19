import { test, expect } from "bun:test";
import {
  buildFoundingTextList,
  canonicalFigureId,
  indexWorks,
  mergeFigures,
  normalizeFoundingText,
  resolveFoundingText,
} from "./figures";
import type { FigureKind, FigureRaw, ManifestWork } from "./types";

const works: ManifestWork[] = [
  { slug: "hesiod-theogony-26bbaf", title: "Theogony", author: "Hesiod", author_slug: "hesiod" },
  { slug: "homer-iliad-056ee9", title: "Iliad", author: "Homer", author_slug: "homer" },
  { slug: "seneca-medea-f180ad", title: "Medea", author: "Lucius Annaeus Seneca", author_slug: "seneca-lucius-annaeus" },
  { slug: "plautus-poenulus-3da27c", title: "Poenulus", author: "Titus Maccius Plautus", author_slug: "titus-maccius-plautus" },
  { slug: "homeric-hymns-hymn-5-to-aphrodite-24a8fb", title: "Hymn 5 to Aphrodite", author: "Homer", author_slug: "homer" },
  { slug: "callimachus-hymn-to-aphrodite-9a1b2c", title: "Hymn to Aphrodite", author: "Callimachus", author_slug: "callimachus" },
  { slug: "apollonius-rhodius-argonautica-fbd514", title: "Argonautica", author: "Apollonius Rhodius", author_slug: "apollonius-rhodius" },
  { slug: "polybius-histories-672821", title: "Histories", author: "Polybius", author_slug: "polybius" },
];
const indexed = indexWorks(works);

function fig(work: string, name: string, kind: FigureKind, mentions: number, founding: string[]): FigureRaw {
  return {
    work_slug: work,
    canonical_name: name,
    surface_names: [name],
    figure_kind: kind,
    mentions: Array.from({ length: mentions }, (_, i) => ({ paragraph_id: `p-${i}`, quote: "q", role: "r" })),
    portrayal: "p",
    founding_texts: founding,
  };
}

test("theonym merge: Roman names fold to the Greek canonical", () => {
  expect(canonicalFigureId("Jupiter")).toBe("zeus");
  expect(canonicalFigureId("Great Jupiter")).toBe("zeus");
  expect(canonicalFigureId("Venus")).toBe("aphrodite");
  expect(canonicalFigureId("Hercules")).toBe("heracles");
  expect(canonicalFigureId("Medea")).toBe("medea"); // not a theonym → unchanged
  expect(canonicalFigureId("Marsyas")).toBe("marsyas"); // token-safe: not merged into Mars
});

test("mergeFigures unifies Venus (Plautus) and Aphrodite (Hymn) into one node", () => {
  const nodes = mergeFigures([
    fig("plautus-poenulus-3da27c", "Venus", "deity", 8, ["Hesiod, Theogony"]),
    fig("hymn-5", "Aphrodite", "deity", 6, ["Homeric Hymn to Aphrodite", "Hesiod, Theogony"]),
  ]);
  const aph = nodes.find((n) => n.id === "aphrodite")!;
  expect(aph).toBeTruthy();
  expect(aph.canonical_name).toBe("Aphrodite");
  expect(aph.work_count).toBe(2);
  expect(aph.total_mentions).toBe(14);
  expect(aph.aliases).toContain("Venus");
  expect(aph.aliases).toContain("Aphrodite");
  expect(aph.kind).toBe("deity");
});

test("kind precedence: deity > mythological > historical", () => {
  const nodes = mergeFigures([fig("w1", "Hades", "deity", 1, []), fig("w2", "Hades", "mythological", 1, [])]);
  expect(nodes.find((n) => n.id === "hades")!.kind).toBe("deity");
});

test("normalizeFoundingText strips parentheticals", () => {
  expect(normalizeFoundingText("Homer, Iliad (Book 5, Book 14)")).toBe("Homer, Iliad");
  expect(normalizeFoundingText("Aristarchus of Tegea, Achilles (fragmentary)")).toBe("Aristarchus of Tegea, Achilles");
});

test("resolveFoundingText: author + title held in corpus", () => {
  expect(resolveFoundingText("Hesiod, Theogony", indexed)).toMatchObject({ status: "in_corpus_work", target_id: "hesiod-theogony-26bbaf" });
  expect(resolveFoundingText("Homer, Iliad (Book 5)", indexed)).toMatchObject({ status: "in_corpus_work", target_id: "homer-iliad-056ee9" });
});

test("resolveFoundingText: same title, wrong author → absent + related pointer", () => {
  const r = resolveFoundingText("Euripides, Medea", indexed);
  expect(r.status).toBe("absent");
  expect(r.related_in_corpus).toContain("seneca-medea-f180ad");
});

test("resolveFoundingText: genuinely absent", () => {
  expect(resolveFoundingText("Quintus of Smyrna, Posthomerica", indexed)).toMatchObject({ status: "absent", related_in_corpus: [] });
});

test("buildFoundingTextList ranks by figure count and resolves status", () => {
  const nodes = mergeFigures([
    fig("plautus-poenulus-3da27c", "Venus", "deity", 8, ["Hesiod, Theogony"]),
    fig("w2", "Zeus", "deity", 5, ["Hesiod, Theogony"]),
    fig("w3", "Medea", "mythological", 3, ["Euripides, Medea"]),
  ]);
  const list = buildFoundingTextList(nodes, indexed);
  const theogony = list.find((e) => e.normalized === "hesiod, theogony")!;
  expect(theogony.figure_count).toBe(2);
  expect(theogony.status).toBe("in_corpus_work");
  expect(list[0]!.normalized).toBe("hesiod, theogony"); // highest figure_count ranks first
  expect(list.find((e) => e.normalized === "euripides, medea")!.status).toBe("absent");
});

test("Homeric Hymn routes to the homeric-hymns work, not Callimachus", () => {
  const r = resolveFoundingText("Homeric Hymn to Aphrodite", indexed);
  expect(r.status).toBe("in_corpus_work");
  expect(r.target_id).toBe("homeric-hymns-hymn-5-to-aphrodite-24a8fb");
});

test("author name-variant resolves: Apollonius of Rhodes ≡ Apollonius Rhodius", () => {
  const r = resolveFoundingText("Apollonius of Rhodes, Argonautica", indexed);
  expect(r.status).toBe("in_corpus_work");
  expect(r.target_id).toBe("apollonius-rhodius-argonautica-fbd514");
});

test("generic-title related pointers are suppressed", () => {
  const r = resolveFoundingText("Tacitus, Histories", indexed);
  expect(r.status).toBe("absent");
  expect(r.related_in_corpus).toEqual([]); // Polybius' Histories is not a real match
});
