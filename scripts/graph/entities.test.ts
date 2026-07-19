import { test, expect } from "bun:test";
import { canonicalEntityId, mergeEntities } from "./entities";
import type { EntityRaw } from "./types";

function ent(
  work: string,
  name: string,
  kind: EntityRaw["kind"],
  mentions: number,
  opts: Partial<Pick<EntityRaw, "surface_names" | "figure_kind" | "founding_texts">> = {},
): EntityRaw {
  return {
    work_slug: work,
    canonical_name: name,
    surface_names: opts.surface_names ?? [name],
    kind,
    figure_kind: opts.figure_kind,
    mentions: Array.from({ length: mentions }, (_, i) => ({ paragraph_id: `p-${String(i).padStart(6, "0")}`, quote: "q", role: "r" })),
    description: "d",
    founding_texts: opts.founding_texts,
  };
}

// --- canonicalEntityId ---

test("canonicalEntityId: theonym merge applies only to figures", () => {
  expect(canonicalEntityId("Venus", "figure")).toBe("aphrodite");
  expect(canonicalEntityId("Venus", "idea")).toBe("venus");   // no theonym merge for non-figure
  expect(canonicalEntityId("Jupiter", "figure")).toBe("zeus");
});

test("canonicalEntityId: Marsyas is not merged into Mars", () => {
  expect(canonicalEntityId("Marsyas", "figure")).toBe("marsyas");
});

// --- mergeEntities: kind segregation ---

test("same name in different kinds produces two distinct nodes", () => {
  const nodes = mergeEntities([
    ent("w1", "Ayodhya", "place", 5),
    ent("w2", "Ayodhya", "place", 3),
    // A deity named the same is a different entity kind — but 'Ayodhya' as figure is unusual;
    // we instead test that 'dharma' as idea != 'Dharma' as figure
    ent("w1", "Dharma", "figure", 2, { figure_kind: "deity" }),
    ent("w2", "Dharma", "idea", 4),
  ]);
  const placeAyodhya = nodes.find((n) => n.kind === "place" && n.id === "ayodhya");
  const figureDharma = nodes.find((n) => n.kind === "figure" && n.id === "dharma");
  const ideaDharma   = nodes.find((n) => n.kind === "idea"   && n.id === "dharma");
  expect(placeAyodhya).toBeTruthy();
  expect(placeAyodhya!.total_mentions).toBe(8);
  expect(figureDharma).toBeTruthy();
  expect(ideaDharma).toBeTruthy();
});

// --- mergeEntities: figure theonym merge ---

test("Venus (Plautus) and Aphrodite (Hymn) merge into one figure node", () => {
  const nodes = mergeEntities([
    ent("plautus", "Venus", "figure", 8, { figure_kind: "deity" }),
    ent("hymn",   "Aphrodite", "figure", 6, { figure_kind: "deity" }),
  ]);
  const aph = nodes.find((n) => n.kind === "figure" && n.id === "aphrodite");
  expect(aph).toBeTruthy();
  expect(aph!.work_count).toBe(2);
  expect(aph!.total_mentions).toBe(14);
  expect(aph!.aliases).toContain("Venus");
  expect(aph!.aliases).toContain("Aphrodite");
});

// --- mergeEntities: figure_kind precedence ---

test("figure_kind: deity > mythological > historical", () => {
  const nodes = mergeEntities([
    ent("w1", "Hades", "figure", 1, { figure_kind: "deity" }),
    ent("w2", "Hades", "figure", 1, { figure_kind: "mythological" }),
  ]);
  expect(nodes.find((n) => n.kind === "figure")!.figure_kind).toBe("deity");
});

// --- mergeEntities: non-figure kinds have no figure_kind ---

test("place/idea/object/group/event/animal nodes carry no figure_kind", () => {
  const nodes = mergeEntities([
    ent("w1", "dharma",    "idea",   3),
    ent("w1", "Ayodhya",   "place",  2),
    ent("w1", "vajra",     "object", 1),
    ent("w1", "Kurus",     "group",  4),
    ent("w1", "Aśvamedha", "event",  2),
    ent("w1", "cow",       "animal", 5),
  ]);
  for (const n of nodes) {
    expect(n.figure_kind).toBeUndefined();
  }
});

// --- mergeEntities: founding_texts only on figures ---

test("founding_texts accumulated only for kind=figure", () => {
  const nodes = mergeEntities([
    ent("w1", "Rāma", "figure", 3, { founding_texts: ["Valmiki, Ramayana"] }),
    ent("w2", "Rāma", "figure", 2, { founding_texts: ["Valmiki, Ramayana", "Adhyatma Ramayana"] }),
    ent("w1", "dharma", "idea", 2),
  ]);
  const rama = nodes.find((n) => n.kind === "figure" && n.id === "rama");
  const dharma = nodes.find((n) => n.kind === "idea");
  expect(rama!.founding_texts).toBeDefined();
  expect(rama!.founding_texts).toContain("Valmiki, Ramayana");
  expect(rama!.founding_texts).toContain("Adhyatma Ramayana");
  expect(dharma!.founding_texts).toBeUndefined();
});

// --- mergeEntities: alias union ---

test("surface_names union across works appears in aliases", () => {
  const nodes = mergeEntities([
    ent("w1", "Hanumān", "figure", 5, { surface_names: ["Hanumān", "Maruti", "Pavanputra"] }),
    ent("w2", "Hanumān", "figure", 3, { surface_names: ["Hanumān", "Anjaneya"] }),
  ]);
  const h = nodes.find((n) => n.id === "hanuman");
  expect(h!.aliases).toContain("Maruti");
  expect(h!.aliases).toContain("Pavanputra");
  expect(h!.aliases).toContain("Anjaneya");
});

// --- mergeEntities: sorting ---

test("nodes sorted by work_count desc, then total_mentions desc", () => {
  const nodes = mergeEntities([
    ent("w1", "dharma", "idea", 10),
    ent("w2", "dharma", "idea", 5),   // dharma: 2 works, 15 total
    ent("w1", "moksha", "idea", 20),  // moksha: 1 work, 20 total
  ]);
  // dharma (2 works) should rank above moksha (1 work) despite fewer total mentions
  expect(nodes[0]!.id).toBe("dharma");
  expect(nodes[1]!.id).toBe("moksha");
});
