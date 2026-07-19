/**
 * atlas-graph — build-time reader for the ontology-harvest atlas artifacts.
 *
 * Reads corpus/graph/atlas/* (produced by `bun run atlas:sync && bun run
 * atlas:build`) the same way lib/corpus.ts reads the corpus: straight from
 * the repo at build time. Every number and row the atlas UI shows comes
 * through here — nothing is hardwired, so a re-sync + rebuild picks up new
 * harvest data automatically.
 *
 * Graceful-absent: artifacts are derived and gitignored. When missing, the
 * getters return empty shapes and `atlasAvailable()` is false — the site
 * builds a quiet "the harvest is syncing" atlas instead of crashing.
 *
 * NOT the same as lib/atlas/ — that older module is the hand-curated
 * Graeco-Arabic transmission dataset that now serves the Book (Carried
 * Across) only.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ATLAS_ROOT = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "corpus",
  "graph",
  "atlas",
);

// ───────────────────────────────────────────────────────────── types

export interface QuoteRef {
  p: string;
  text: string;
  chapter?: string;
  variant?: string;
}

export interface EntityIndexRow {
  slug: string;
  kind: EntityKind;
  figure_kind?: "historical" | "mythological" | "deity";
  name: string;
  /** the harvester's parenthetical gloss, e.g. Kleos — "renown" */
  gloss?: string;
  surfaces: string[];
  author_slug?: string;
  works: number;
  mentions: number;
  evidence: number;
  page: boolean;
  /** cross-reference: this name folded into the concept page at `see` (a
   *  head slug of the same kind) — render as "Kāla, see Time" */
  see?: string;
}

export interface EntityWorkMention {
  work: string;
  title: string;
  author?: string;
  era?: string;
  language?: string;
  count: number;
  description?: string;
  quotes: QuoteRef[];
}

export interface EntityDetail extends Omit<EntityIndexRow, "page"> {
  works: number | EntityWorkMention[]; // detail files carry the array
}

export interface EntityExpression {
  name: string;
  gloss?: string;
  mentions: number;
  works: { work: string; title?: string; language?: string; count: number; quotes: QuoteRef[] }[];
}
export interface EntityDetailFile {
  slug: string;
  kind: EntityKind;
  figure_kind?: string;
  name: string;
  gloss?: string;
  surfaces: string[];
  author_slug?: string;
  works: EntityWorkMention[];
  /** the other ways the corpus speaks of this concept (folded members) */
  expressions?: EntityExpression[];
  mentions: number;
  evidence: number;
}

export interface CitationEdge {
  from: string;
  cited_work?: string;
  cited_author?: string;
  stance: Stance;
  count: number;
  to_work?: string;
  to_author?: string;
  quotes: QuoteRef[];
}

export interface ThemeRow {
  slug: string;
  topic: string;
  total: number;
  implicit: number;
  works: { work: string; title: string; count: number; quote?: QuoteRef }[];
}

export interface WorkAtlasRow {
  work: string;
  title: string;
  author?: string;
  era?: string;
  language?: string;
  genre?: string;
  windows_done: number;
  windows_total: number;
  entity_rows: number;
  kinds: Record<string, number>;
  citations_out: number;
  quote_events: number;
  themes: number;
  top_entities: { slug: string; kind: EntityKind; name: string; count: number }[];
}

export interface AtlasMeta {
  generated_at: string;
  ontology_version: string;
  paragraphs_indexed?: number;
  windows_synthesized: number;
  windows_total: number | null;
  works_harvested: number;
  works_total: number;
  sync: {
    synced_at?: string;
    beacon?: {
      generated_at?: string;
      responses_finalized?: number;
      total_archive_windows?: number;
    } | null;
  } | null;
  totals: Record<string, number>;
  kinds: Record<string, number>;
  stances: Record<Stance, number>;
  coverage: {
    by_language: Record<string, { done: number; total: number }>;
    by_era: Record<string, { done: number; total: number }>;
  };
}

export type Stance = "authority" | "neutral" | "refute" | "extend" | "endorse";
export type EntityKind =
  | "figure"
  | "group"
  | "idea"
  | "place"
  | "event"
  | "object"
  | "animal";

export const KINDS: {
  kind: EntityKind;
  plural: string;
  label: string;
  gloss: string;
}[] = [
  { kind: "figure", plural: "figures", label: "Figures", gloss: "persons, gods, sages, rulers — historical and mythological" },
  { kind: "idea", plural: "ideas", label: "Ideas", gloss: "doctrines, virtues, laws, duties, abstractions" },
  { kind: "place", plural: "places", label: "Places", gloss: "cities, rivers, worlds, courts, prisons" },
  { kind: "group", plural: "groups", label: "Groups", gloss: "peoples, castes, schools, sects, institutions" },
  { kind: "event", plural: "events", label: "Events", gloss: "trials, sacrifices, journeys, battles, rituals" },
  { kind: "object", plural: "objects", label: "Objects", gloss: "books, weapons, implements, money, vessels" },
  { kind: "animal", plural: "animals", label: "Animals", gloss: "creatures as creatures, categories, examples" },
];

export const STANCES: { stance: Stance; label: string; gloss: string }[] = [
  { stance: "authority", label: "Authority", gloss: "relied on as a source of legitimacy" },
  { stance: "neutral", label: "Neutral", gloss: "identified or reported" },
  { stance: "refute", label: "Refuted", gloss: "argued against" },
  { stance: "extend", label: "Extended", gloss: "developed or continued" },
  { stance: "endorse", label: "Endorsed", gloss: "agreed with" },
];

export function kindByPlural(plural: string) {
  return KINDS.find((k) => k.plural === plural);
}

// ───────────────────────────────────────────────────────────── loaders

function readJSON<T>(rel: string): T | null {
  const p = join(ATLAS_ROOT, rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return null;
  }
}

let _meta: AtlasMeta | null | undefined;
export function atlasMeta(): AtlasMeta | null {
  if (_meta === undefined) _meta = readJSON<AtlasMeta>("meta.json");
  return _meta;
}

export function atlasAvailable(): boolean {
  return atlasMeta() !== null;
}

let _index: EntityIndexRow[] | undefined;
export function entityIndex(): EntityIndexRow[] {
  if (_index === undefined)
    _index = readJSON<EntityIndexRow[]>("entities-index.json") ?? [];
  return _index;
}

export function entitiesOfKind(kind: EntityKind): EntityIndexRow[] {
  return entityIndex().filter((e) => e.kind === kind);
}

let _detailSlugs: Map<string, string> | undefined; // `${kind}/${slug}` -> filename
export function entityPageKeys(): Map<string, string> {
  if (_detailSlugs === undefined) {
    _detailSlugs = new Map();
    const dir = join(ATLAS_ROOT, "entities");
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        const m = f.match(/^([a-z]+)--(.+)\.json$/);
        if (m) _detailSlugs.set(`${m[1]}/${m[2]}`, f);
      }
    }
  }
  return _detailSlugs;
}

export function entityDetail(kind: string, slug: string): EntityDetailFile | null {
  const f = entityPageKeys().get(`${kind}/${slug}`);
  if (!f) return null;
  return readJSON<EntityDetailFile>(join("entities", f));
}

let _citations: CitationEdge[] | undefined;
export function citationEdges(): CitationEdge[] {
  if (_citations === undefined)
    _citations = readJSON<CitationEdge[]>("citations.json") ?? [];
  return _citations;
}

let _themes: ThemeRow[] | undefined;
export function themeRows(): ThemeRow[] {
  if (_themes === undefined)
    _themes = readJSON<ThemeRow[]>("themes-index.json") ?? [];
  return _themes;
}

let _works: WorkAtlasRow[] | undefined;
let _worksBySlug: Map<string, WorkAtlasRow> | undefined;
export function workAtlasRows(): WorkAtlasRow[] {
  if (_works === undefined)
    _works = readJSON<WorkAtlasRow[]>("works-atlas.json") ?? [];
  return _works;
}
export function workAtlas(slug: string): WorkAtlasRow | null {
  if (_worksBySlug === undefined) {
    _worksBySlug = new Map(workAtlasRows().map((w) => [w.work, w]));
  }
  return _worksBySlug.get(slug) ?? null;
}

/** Per-chapter entity anchors for the reader integration. */
export interface ChapterEntity {
  slug: string;
  kind: EntityKind;
  name: string;
  page: boolean;
  count: number;
  desc?: string;
  match: string[];
  p: string[];
}
export interface WorkOntology {
  work: string;
  chapters: Record<string, ChapterEntity[]>;
}
export function workOntology(slug: string): WorkOntology | null {
  return readJSON<WorkOntology>(join("works", `${slug}.json`));
}

// ───────────────────────────────────────────────────────────── derived

/** Reader deep-link for a quote ref within a given work. */
export function quoteHref(work: string, q: QuoteRef): string | null {
  if (!q.chapter || !q.variant) return null;
  return `/works/${work}/${q.chapter}/${q.variant}/#${q.p}`;
}

/** Most-cited targets, aggregated across stances. */
export interface CitedTarget {
  key: string;
  label: string;
  kind: "work" | "author";
  to_work?: string;
  to_author?: string;
  total: number;
  stances: Partial<Record<Stance, number>>;
  citingWorks: Set<string>;
  sample?: { from: string; stance: Stance; quote?: QuoteRef };
}
export function citedTargets(kind: "work" | "author"): CitedTarget[] {
  const map = new Map<string, CitedTarget>();
  for (const e of citationEdges()) {
    const raw = kind === "work" ? e.cited_work : e.cited_author;
    if (!raw) continue;
    const resolved = kind === "work" ? e.to_work : e.to_author;
    const key = resolved ?? raw.toLowerCase();
    const t =
      map.get(key) ??
      ({
        key,
        label: raw,
        kind,
        to_work: kind === "work" ? resolved : undefined,
        to_author: kind === "author" ? resolved : undefined,
        total: 0,
        stances: {},
        citingWorks: new Set<string>(),
      } as CitedTarget);
    t.total += e.count;
    t.stances[e.stance] = (t.stances[e.stance] ?? 0) + e.count;
    t.citingWorks.add(e.from);
    if (!t.sample && e.quotes[0])
      t.sample = { from: e.from, stance: e.stance, quote: e.quotes[0] };
    map.set(key, t);
  }
  return [...map.values()].sort(
    (a, b) => b.total - a.total || (a.label < b.label ? -1 : 1),
  );
}

const nf = new Intl.NumberFormat("en-US");
export function fmt(n: number | null | undefined): string {
  return n == null ? "—" : nf.format(n);
}

/** "3 works" / "1 work" */
export function plural(n: number, word: string): string {
  return `${nf.format(n)} ${word}${n === 1 ? "" : "s"}`;
}
