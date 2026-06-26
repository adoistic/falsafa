import { slugify } from "../lib/slug";
import { contains } from "./resolve-references";
import { THEONYM_GROUPS } from "./theonyms";
import type {
  FigureKind,
  FigureNode,
  FigureRaw,
  FigureWorkAppearance,
  FoundingStatus,
  FoundingTextEntry,
  ManifestWork,
} from "./types";

// --- theonym / alias canonicalization ---

const THEONYM_LOOKUP: { token: string; canonical: string }[] = THEONYM_GROUPS.flatMap((g) =>
  g.names.map((n) => ({ token: slugify(n), canonical: slugify(g.canonical) })),
);
const THEONYM_DISPLAY = new Map(THEONYM_GROUPS.map((g) => [slugify(g.canonical), g.canonical]));

/** Map a figure name to its canonical id, merging Greek/Roman theonyms (Venus→aphrodite). */
export function canonicalFigureId(name: string): string {
  const s = slugify(name);
  for (const { token, canonical } of THEONYM_LOOKUP) {
    if (contains(s, token)) return canonical;
  }
  return s;
}

const KIND_RANK: Record<FigureKind, number> = { deity: 3, mythological: 2, historical: 1 };

/** Merge per-work figure rows into cross-work figure nodes. */
export function mergeFigures(raws: FigureRaw[]): FigureNode[] {
  const groups = new Map<string, FigureRaw[]>();
  for (const r of raws) {
    const id = canonicalFigureId(r.canonical_name);
    const list = groups.get(id) ?? [];
    list.push(r);
    groups.set(id, list);
  }

  const nodes: FigureNode[] = [];
  for (const [id, list] of groups) {
    const nameCounts = new Map<string, number>();
    for (const r of list) nameCounts.set(r.canonical_name, (nameCounts.get(r.canonical_name) ?? 0) + 1);
    const display =
      THEONYM_DISPLAY.get(id) ??
      [...nameCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];

    const kind = list.map((r) => r.figure_kind).sort((a, b) => KIND_RANK[b] - KIND_RANK[a])[0]!;

    const aliases = new Set<string>();
    for (const r of list) {
      aliases.add(r.canonical_name);
      for (const sn of r.surface_names) aliases.add(sn);
    }

    const byWork = new Map<string, FigureWorkAppearance>();
    for (const r of list) {
      const a =
        byWork.get(r.work_slug) ??
        { work_slug: r.work_slug, named_as: r.canonical_name, mention_count: 0, portrayal: r.portrayal };
      a.mention_count += r.mentions.length;
      byWork.set(r.work_slug, a);
    }
    const works = [...byWork.values()].sort(
      (a, b) => b.mention_count - a.mention_count || a.work_slug.localeCompare(b.work_slug),
    );

    const founding = new Set<string>();
    for (const r of list) for (const ft of r.founding_texts) founding.add(normalizeFoundingText(ft));

    nodes.push({
      id,
      canonical_name: display,
      kind,
      aliases: [...aliases].sort(),
      works,
      work_count: works.length,
      total_mentions: works.reduce((s, w) => s + w.mention_count, 0),
      founding_texts: [...founding].filter(Boolean).sort(),
    });
  }

  return nodes.sort(
    (a, b) =>
      b.work_count - a.work_count || b.total_mentions - a.total_mentions || a.id.localeCompare(b.id),
  );
}

// --- founding-text normalization + resolution ---

/** Strip "(Book 5, ...)" parentheticals and trailing punctuation. */
export function normalizeFoundingText(label: string): string {
  return label
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,;:.]+$/g, "")
    .trim();
}

export interface IndexedWork {
  slug: string;
  titleSlug: string;
  authorNameSlug: string;
  authorSlug: string;
}

export function indexWorks(works: ManifestWork[]): IndexedWork[] {
  return works.map((w) => ({
    slug: w.slug,
    titleSlug: slugify(w.title),
    authorNameSlug: slugify(w.author),
    authorSlug: w.author_slug,
  }));
}

export interface FoundingResolution {
  status: FoundingStatus;
  target_id: string | null;
  related_in_corpus: string[];
}

// Generic bibliographic title words that collide across unrelated works; a shared
// one of these is NOT evidence two works are the same (Tacitus' Histories ≠ Polybius').
const TITLE_STOPWORDS = new Set([
  "elegies", "fragments", "fragment", "histories", "history", "poems", "poem", "comedies",
  "comedy", "letters", "epistles", "hymns", "hymn", "natural", "odes", "epigrams", "idylls",
  "works", "library", "satires", "satura", "tragedies", "orations", "essays", "dialogues",
  "annals", "annales", "selections",
]);

function distinctiveTokens(slug: string): string[] {
  return slug.split("-").filter((t) => t.length >= 5 && !TITLE_STOPWORDS.has(t));
}

/**
 * Resolve a founding-text label ("Author, Title") against the corpus.
 * - Author must match when present, so "Euripides, Medea" does NOT resolve to the
 *   Seneca Medea we hold — it stays absent (with a related pointer).
 * - Author matching tolerates name-order/epithet variants via shared distinctive
 *   tokens ("Apollonius of Rhodes" ≡ "Apollonius Rhodius").
 * - "Homeric Hymn to X" is routed to the homeric-hymns work for deity X.
 * - related_in_corpus is only filled when titles share a non-generic token.
 */
export function resolveFoundingText(label: string, indexed: IndexedWork[]): FoundingResolution {
  const clean = normalizeFoundingText(label);

  // Homeric Hymns: "Homeric Hymn to Demeter" / "Homer, Hymn to Demeter" → the held hymn work.
  if (/hymn/i.test(clean) && /homer/i.test(clean)) {
    const deity = slugify(clean.replace(/\b(homeric|homer|hymn|to|the|of)\b/gi, " "));
    const hh = indexed.filter((w) => w.slug.includes("homeric-hymns"));
    const hits = deity ? hh.filter((w) => contains(w.slug, deity)) : [];
    if (hits.length)
      return {
        status: "in_corpus_work",
        target_id: hits.sort((a, b) => a.slug.length - b.slug.length)[0]!.slug,
        related_in_corpus: [],
      };
  }

  const commaIdx = clean.indexOf(",");
  const hasAuthor = commaIdx > 0;
  const authorPart = hasAuthor ? clean.slice(0, commaIdx).trim() : "";
  const titlePart = hasAuthor ? clean.slice(commaIdx + 1).trim() : clean;
  const titleSlug = slugify(titlePart);
  const aSlug = slugify(authorPart);
  const aTokens = aSlug.split("-").filter((t) => t.length >= 5);

  const titleHits = titleSlug ? indexed.filter((w) => contains(w.titleSlug, titleSlug)) : [];
  const authorMatch = (w: IndexedWork) => {
    if (!aSlug) return false;
    if (contains(w.authorNameSlug, aSlug) || contains(w.authorSlug, aSlug)) return true;
    const wt = new Set([...w.authorNameSlug.split("-"), ...w.authorSlug.split("-")]);
    return aTokens.some((t) => wt.has(t));
  };
  const titleDistinct = distinctiveTokens(titleSlug);
  const relatedOf = (hits: IndexedWork[]) =>
    hits.filter((w) => distinctiveTokens(w.titleSlug).some((t) => titleDistinct.includes(t))).map((w) => w.slug);

  if (hasAuthor) {
    const both = titleHits.filter(authorMatch).sort((a, b) => a.titleSlug.length - b.titleSlug.length);
    if (both.length) return { status: "in_corpus_work", target_id: both[0]!.slug, related_in_corpus: [] };
    if (titleHits.length) return { status: "absent", target_id: null, related_in_corpus: relatedOf(titleHits) };
    const authorHits = indexed.filter(authorMatch);
    if (authorHits.length)
      return { status: "in_corpus_author", target_id: authorHits[0]!.authorSlug, related_in_corpus: [] };
    return { status: "absent", target_id: null, related_in_corpus: [] };
  }

  // title-only label
  const sorted = titleHits.sort((a, b) => a.titleSlug.length - b.titleSlug.length);
  if (sorted.length)
    return { status: "in_corpus_work", target_id: sorted[0]!.slug, related_in_corpus: relatedOf(sorted.slice(1)) };
  const authorOnly = titleSlug ? indexed.filter((w) => contains(w.authorNameSlug, titleSlug)) : [];
  if (authorOnly.length)
    return { status: "in_corpus_author", target_id: authorOnly[0]!.authorSlug, related_in_corpus: [] };
  return { status: "absent", target_id: null, related_in_corpus: [] };
}

/** Aggregate founding texts across figure nodes, resolve each, rank by figure count. */
export function buildFoundingTextList(nodes: FigureNode[], indexed: IndexedWork[]): FoundingTextEntry[] {
  const byLabel = new Map<string, FoundingTextEntry>();
  const mentionsByFigure = new Map(nodes.map((n) => [n.id, n.total_mentions]));

  for (const n of nodes) {
    for (const ft of new Set(n.founding_texts)) {
      if (!ft) continue;
      const normalized = ft.toLowerCase();
      let e = byLabel.get(normalized);
      if (!e) {
        const r = resolveFoundingText(ft, indexed);
        e = {
          label: ft,
          normalized,
          status: r.status,
          target_id: r.target_id,
          related_in_corpus: r.related_in_corpus,
          figure_count: 0,
          figures: [],
          recurrence: 0,
        };
        byLabel.set(normalized, e);
      }
      if (!e.figures.includes(n.id)) {
        e.figures.push(n.id);
        e.figure_count += 1;
        e.recurrence += mentionsByFigure.get(n.id) ?? 0;
      }
    }
  }

  return [...byLabel.values()].sort(
    (a, b) => b.figure_count - a.figure_count || b.recurrence - a.recurrence || a.normalized.localeCompare(b.normalized),
  );
}
