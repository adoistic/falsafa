import { slugify } from "../lib/slug";
import { contains } from "./resolve-references";
import { THEONYM_GROUPS } from "./theonyms";
import type {
  EntityKind,
  EntityNode,
  EntityRaw,
  EntityWorkAppearance,
  FigureKind,
} from "./types";

// --- theonym / alias canonicalization (reuse for kind="figure") ---

const THEONYM_LOOKUP: { token: string; canonical: string }[] = THEONYM_GROUPS.flatMap((g) =>
  g.names.map((n) => ({ token: slugify(n), canonical: slugify(g.canonical) })),
);
const THEONYM_DISPLAY = new Map(THEONYM_GROUPS.map((g) => [slugify(g.canonical), g.canonical]));

/**
 * Map an entity name to its canonical id.
 * For figures: applies Greek/Roman theonym merging (Venus→aphrodite).
 * For other kinds: plain slugify only.
 */
export function canonicalEntityId(name: string, kind: EntityKind): string {
  const s = slugify(name);
  if (kind === "figure") {
    for (const { token, canonical } of THEONYM_LOOKUP) {
      if (contains(s, token)) return canonical;
    }
  }
  return s;
}

const FIGURE_KIND_RANK: Record<FigureKind, number> = { deity: 3, mythological: 2, historical: 1 };

/** Merge per-work entity rows into cross-work entity nodes. */
export function mergeEntities(raws: EntityRaw[]): EntityNode[] {
  // Group by kind + canonical-id so "place:ayodhya" != "figure:ayodhya"
  const groups = new Map<string, EntityRaw[]>();
  for (const r of raws) {
    const id = `${r.kind}:${canonicalEntityId(r.canonical_name, r.kind)}`;
    const list = groups.get(id) ?? [];
    list.push(r);
    groups.set(id, list);
  }

  const nodes: EntityNode[] = [];
  for (const [compositeId, list] of groups) {
    const colonIdx = compositeId.indexOf(":");
    const kind = compositeId.slice(0, colonIdx) as EntityKind;
    const id = compositeId.slice(colonIdx + 1);

    // Best display name: theonym override → most-frequent canonical_name → alphabetical tiebreak
    const nameCounts = new Map<string, number>();
    for (const r of list) nameCounts.set(r.canonical_name, (nameCounts.get(r.canonical_name) ?? 0) + 1);
    const display =
      (kind === "figure" ? THEONYM_DISPLAY.get(id) : undefined) ??
      [...nameCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];

    // For figures: pick the highest-rank figure_kind across all rows
    let figurekind: FigureKind | undefined;
    if (kind === "figure") {
      const kinds = list.map((r) => r.figure_kind).filter(Boolean) as FigureKind[];
      if (kinds.length) {
        figurekind = kinds.sort((a, b) => FIGURE_KIND_RANK[b] - FIGURE_KIND_RANK[a])[0];
      }
    }

    // Aliases: union of all canonical + surface names seen
    const aliases = new Set<string>();
    for (const r of list) {
      aliases.add(r.canonical_name);
      for (const sn of r.surface_names) aliases.add(sn);
    }

    // Per-work appearance records (one per work_slug; sum mentions)
    const byWork = new Map<string, EntityWorkAppearance>();
    for (const r of list) {
      const a =
        byWork.get(r.work_slug) ??
        { work_slug: r.work_slug, named_as: r.canonical_name, mention_count: 0, description: r.description };
      a.mention_count += r.mentions.length;
      byWork.set(r.work_slug, a);
    }
    const works = [...byWork.values()].sort(
      (a, b) => b.mention_count - a.mention_count || a.work_slug.localeCompare(b.work_slug),
    );

    // founding_texts for figures only
    let foundingTexts: string[] | undefined;
    if (kind === "figure") {
      const founding = new Set<string>();
      for (const r of list) {
        for (const ft of r.founding_texts ?? []) {
          if (ft) founding.add(ft.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").replace(/[\s,;:.]+$/g, "").trim());
        }
      }
      foundingTexts = [...founding].filter(Boolean).sort();
    }

    const node: EntityNode = {
      id,
      canonical_name: display,
      kind,
      aliases: [...aliases].sort(),
      works,
      work_count: works.length,
      total_mentions: works.reduce((s, w) => s + w.mention_count, 0),
    };
    if (figurekind !== undefined) node.figure_kind = figurekind;
    if (foundingTexts !== undefined) node.founding_texts = foundingTexts;

    nodes.push(node);
  }

  return nodes.sort(
    (a, b) =>
      b.work_count - a.work_count || b.total_mentions - a.total_mentions || a.id.localeCompare(b.id),
  );
}
