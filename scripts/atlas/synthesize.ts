/**
 * atlas/synthesize — the global synthesis pass: raw enriched windows → the
 * build-ready atlas artifacts the site reads.
 *
 * This is the pass DATA-INVENTORY.md calls "the biggest gap": the harvest is
 * per-window and pre-merge; nothing aggregates it. This script:
 *
 *   1. Streams every windows/*.enriched.json (anchor-range-v1).
 *   2. ENTITY RESOLUTION: merges entities across windows/works by
 *      (kind, diacritic-folded name), then folds aliases via surface_names.
 *      Deterministic — same input, same output, stable slugs.
 *   3. Links figures ↔ corpus authors, citations ↔ in-corpus works/authors.
 *   4. Aggregates citations (stance-typed edges) and themes.
 *   5. Resolves every evidence paragraph to its reader deep-link via
 *      corpus/paragraph-index.json (the 1.37M-entry phone book).
 *   6. Emits artifacts to corpus/graph/atlas/ with fully derived numbers —
 *      nothing hardwired; re-running after a sync picks up new works
 *      automatically.
 *
 * Ingests defensively per DATA-INVENTORY.md A.2: tolerates off-enum kinds
 * (deity, accusation) and stray keys; reads grounding ONLY from
 * evidence[].expanded_paragraph_ids + evidence[].quotes[].
 *
 * Usage: bun run scripts/atlas/synthesize.ts
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const RUN_DIR = join(ROOT, "corpus/graph/ontology-runs/2026-07-02-sonnet-benchmark");
const WINDOWS_DIR = join(RUN_DIR, "windows");
const OUT_DIR = join(ROOT, "corpus/graph/atlas");

// ---------------------------------------------------------------- types

interface EvidenceQuote {
  paragraph_id: string;
  quote: string;
  selection_method?: string;
  selection_score?: number;
}
interface Evidence {
  expanded_paragraph_ids?: string[];
  paragraph_ids?: string[];
  quotes?: EvidenceQuote[];
  role?: string;
  evidence_hint?: string;
}
interface RawEntity {
  canonical_name: string;
  surface_names?: string[];
  kind: string;
  figure_kind?: string;
  description?: string;
  evidence?: Evidence[];
}
interface RawTheme {
  topic: string;
  implicit?: boolean;
  evidence?: Evidence[];
}
interface RawCitation {
  cited_work?: string;
  cited_author?: string;
  stance?: string;
  evidence?: Evidence[];
}
interface RawQuoteEvent {
  kind?: string;
  speaker?: string;
  quoted_person?: string;
  quoted_work?: string;
  quoted_author?: string;
  stance?: string;
  evidence?: Evidence[];
}
interface WindowDoc {
  work_slug: string;
  ontology_version?: string;
  entities?: RawEntity[];
  themes?: RawTheme[];
  citations?: RawCitation[];
  quote_events?: RawQuoteEvent[];
}

interface QuoteRef {
  p: string; // paragraph id
  text: string;
  chapter?: string;
  variant?: string;
}
interface WorkMention {
  work: string;
  count: number; // raw pre-merge entity rows folded in from this work
  description?: string; // first non-empty description seen
  quotes: QuoteRef[];
  /** chapter-resolved paragraph anchors, for the reader integration
   *  (inline term highlighting + per-chapter ontology panel). Capped. */
  anchors: { p: string; chapter: string }[];
}

// ---------------------------------------------------------------- helpers

/** Diacritic-folded, lowercased, punctuation-stripped merge key. Ṛgveda→rgveda. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(s: string): string {
  return norm(s).replace(/\s+/g, "-").slice(0, 64) || "unnamed";
}

const CANON_KINDS = new Set([
  "figure",
  "group",
  "idea",
  "place",
  "event",
  "object",
  "animal",
]);
/** Defensive: fold off-enum kinds (e.g. top-level "deity") into the canon. */
function canonKind(kind: string, figureKind?: string): { kind: string; figureKind?: string } {
  if (CANON_KINDS.has(kind)) return { kind, figureKind };
  if (kind === "deity") return { kind: "figure", figureKind: "deity" };
  return { kind: "idea", figureKind: undefined }; // safest bucket for strays
}

const STANCES = ["authority", "neutral", "refute", "extend", "endorse"] as const;

// ---------------------------------------------------------------- main

async function main() {
  const t0 = performance.now();

  // ---- corpus context ------------------------------------------------
  // manifest fields are FLAT (see lib/corpus.ts ManifestWork): author,
  // author_slug, era, language, genre are plain strings on each work.
  const manifest = await Bun.file(join(ROOT, "corpus/manifest.json")).json();
  const works: Record<string, { title: string; author?: string; era?: string; language?: string; genre?: string }> = {};
  const authorName: Record<string, string> = {}; // slug -> display
  const normAuthor: Map<string, string> = new Map(); // norm(name) -> slug (unique only)
  const normWorkTitle: Map<string, string[]> = new Map(); // norm(title) -> [slug]
  {
    const authorCollide = new Set<string>();
    for (const w of manifest.works ?? []) {
      works[w.slug] = {
        title: w.title,
        author: w.author_slug,
        era: w.era,
        language: w.language,
        genre: w.genre,
      };
      if (w.author_slug && w.author) {
        authorName[w.author_slug] = w.author;
        const na = norm(w.author);
        if (na) {
          const prev = normAuthor.get(na);
          if (prev && prev !== w.author_slug) authorCollide.add(na);
          else normAuthor.set(na, w.author_slug);
        }
      }
      const nt = norm(w.title ?? "");
      if (nt) {
        const arr = normWorkTitle.get(nt) ?? [];
        arr.push(w.slug);
        normWorkTitle.set(nt, arr);
      }
    }
    for (const na of authorCollide) normAuthor.delete(na); // ambiguous names don't link
  }

  // window denominators per work
  const windowsTotal: Record<string, number> = {};
  try {
    const wm = await Bun.file(join(RUN_DIR, "window-manifest.json")).json();
    const list = Array.isArray(wm) ? wm : (wm.windows ?? []);
    for (const w of list) {
      const slug = w.work_slug ?? w.slug;
      if (slug) windowsTotal[slug] = (windowsTotal[slug] ?? 0) + 1;
    }
  } catch {
    console.warn("window-manifest.json unreadable — coverage denominators partial");
  }

  // paragraph phone book (1.37M entries, ~138MB) — loaded once, used for deep links
  console.log("loading paragraph-index.json …");
  let pIndex: Record<string, { work: string; chapter: string; variant: string }> = {};
  try {
    pIndex = await Bun.file(join(ROOT, "corpus/paragraph-index.json")).json();
  } catch {
    console.warn("paragraph-index.json unavailable — quotes will link chapter-less");
  }

  // ---- concordance (loaded early: renames apply at ingest) -----------
  interface Concordance {
    renames?: { kind: string; match: string; to: string }[];
    rekinds?: { from: string; to: string; names: string[] }[];
    divine_collectives?: string[];
    never?: [string, string][];
    clusters?: Record<string, { head: string; members: string[] }[]>;
    junk?: Record<string, string[]>;
  }
  let concordance: Concordance = {};
  try {
    concordance = await Bun.file(join(import.meta.dir, "concordance.json")).json();
  } catch {
    console.warn("concordance.json unreadable — proceeding with rules only");
  }
  const renameMap = new Map<string, string>(
    (concordance.renames ?? []).map((r) => [`${r.kind}|${r.match.trim().toLowerCase()}`, r.to]),
  );
  // a collective is a group: divine collectives the harvest typed as figures
  // are re-kinded at ingest so same-kind merging unifies the split pages
  const rekindMap = new Map<string, string>(); // `${fromKind}|${norm}` -> toKind
  for (const r of concordance.rekinds ?? [])
    for (const n of r.names) rekindMap.set(`${r.from}|${norm(n)}`, r.to);
  // the categorical layer: pantheons & divine collectives (browsing class)
  const divineSet = new Set(
    (concordance.divine_collectives ?? []).map((n) => norm(n)),
  );
  // reviewer-flagged noise ("X and Y" compounds, sentence-fragments): the
  // data stays, but these never earn a page of their own
  const junkSet = new Set<string>();
  for (const [kind, names] of Object.entries(concordance.junk ?? {}))
    for (const n of names) junkSet.add(`${kind}|${norm(n)}`);

  // ---- pass over windows --------------------------------------------
  const glob = new Bun.Glob("*.enriched.json");
  const files: string[] = [];
  for await (const f of glob.scan(WINDOWS_DIR)) files.push(f);
  files.sort(); // determinism
  console.log(`synthesizing from ${files.length} enriched windows …`);

  // entity merge state, keyed by `${kind}|${norm(name)}`
  interface Expression {
    name: string; // how this tradition/text speaks of the concept
    gloss?: string; // the harvester's own parenthetical gloss, if any
    mentions: number;
    works: { work: string; title?: string; count: number; quotes: QuoteRef[] }[];
  }
  interface EntityAcc {
    kind: string;
    figureKinds: Record<string, number>;
    names: Record<string, number>; // display-name spellings -> votes
    surfaces: Record<string, number>; // surface forms -> votes
    mentions: Map<string, WorkMention>;
    evidenceCount: number;
    displayName?: string; // set by the concordance stage (cleaned)
    gloss?: string; // parsed parenthetical gloss
    expressions?: Expression[]; // folded members, kept legible
  }
  const entities = new Map<string, EntityAcc>();

  // citation edges keyed by from|work|author|stance
  interface CitationAcc {
    from: string;
    citedWork: string;
    citedAuthor: string;
    stance: string;
    count: number;
    quotes: QuoteRef[];
  }
  const citations = new Map<string, CitationAcc>();

  // themes keyed by norm(topic)
  interface ThemeAcc {
    names: Record<string, number>;
    works: Map<string, { count: number; quotes: QuoteRef[] }>;
    implicit: number;
    total: number;
  }
  const themes = new Map<string, ThemeAcc>();

  // per-work rollups
  interface WorkAcc {
    windowsDone: number;
    entityRows: number;
    kinds: Record<string, number>;
    citationsOut: number;
    quoteEvents: number;
    themes: number;
  }
  const perWork = new Map<string, WorkAcc>();

  const stanceTotals: Record<string, number> = {};
  const kindTotals: Record<string, number> = {};
  let totalEntityRows = 0;
  let totalEvidence = 0;
  let totalQuotes = 0;
  let totalQuoteEvents = 0;

  const workOf = (p: string) => pIndex[p]; // closure for link resolution

  function quoteRefs(evs: Evidence[] | undefined, cap: number): QuoteRef[] {
    if (!evs) return [];
    const out: QuoteRef[] = [];
    // prefer term-matched sentences over whole-paragraph fallbacks, short over long
    const all: EvidenceQuote[] = [];
    for (const ev of evs) for (const q of ev.quotes ?? []) all.push(q);
    all.sort((a, b) => {
      const am = a.selection_method === "terms_sentence" ? 0 : 1;
      const bm = b.selection_method === "terms_sentence" ? 0 : 1;
      if (am !== bm) return am - bm;
      return (a.quote?.length ?? 1e9) - (b.quote?.length ?? 1e9);
    });
    const seen = new Set<string>();
    for (const q of all) {
      if (!q.quote || !q.paragraph_id) continue;
      if (seen.has(q.paragraph_id)) continue;
      seen.add(q.paragraph_id);
      const loc = workOf(q.paragraph_id);
      out.push({
        p: q.paragraph_id,
        text: q.quote.length > 420 ? q.quote.slice(0, 400).trimEnd() + " …" : q.quote,
        chapter: loc?.chapter,
        variant: loc?.variant,
      });
      if (out.length >= cap) break;
    }
    return out;
  }

  for (const file of files) {
    let doc: WindowDoc;
    try {
      doc = (await Bun.file(join(WINDOWS_DIR, file)).json()) as WindowDoc;
    } catch {
      console.warn(`skip unparseable ${file}`);
      continue;
    }
    const work = doc.work_slug;
    if (!work) continue;
    const wa = perWork.get(work) ?? {
      windowsDone: 0,
      entityRows: 0,
      kinds: {},
      citationsOut: 0,
      quoteEvents: 0,
      themes: 0,
    };
    wa.windowsDone++;

    for (const e of doc.entities ?? []) {
      if (!e?.canonical_name || !e.kind) continue;
      totalEntityRows++;
      wa.entityRows++;
      const { kind, figureKind } = canonKind(e.kind, e.figure_kind);
      // cross-lingual homograph renames (timê 'honor' must not key as 'time')
      const canonicalName =
        renameMap.get(`${kind}|${e.canonical_name.trim().toLowerCase()}`) ??
        e.canonical_name;
      // collectives typed as figures re-kind to group (Gods, Muses, Maruts…)
      const rekinded = rekindMap.get(`${kind}|${norm(canonicalName)}`);
      const finalKind = rekinded ?? kind;
      const finalFigureKind = rekinded ? undefined : figureKind;
      kindTotals[finalKind] = (kindTotals[finalKind] ?? 0) + 1;
      wa.kinds[finalKind] = (wa.kinds[finalKind] ?? 0) + 1;
      const key = `${finalKind}|${norm(canonicalName)}`;
      const acc =
        entities.get(key) ??
        ({
          kind: finalKind,
          figureKinds: {},
          names: {},
          surfaces: {},
          mentions: new Map(),
          evidenceCount: 0,
        } as EntityAcc);
      if (finalFigureKind)
        acc.figureKinds[finalFigureKind] = (acc.figureKinds[finalFigureKind] ?? 0) + 1;
      acc.names[canonicalName] = (acc.names[canonicalName] ?? 0) + 1;
      for (const s of e.surface_names ?? [])
        if (s) acc.surfaces[s] = (acc.surfaces[s] ?? 0) + 1;
      const evCount = e.evidence?.length ?? 0;
      acc.evidenceCount += evCount;
      totalEvidence += evCount;
      for (const ev of e.evidence ?? []) totalQuotes += ev.quotes?.length ?? 0;
      const m =
        acc.mentions.get(work) ??
        ({ work, count: 0, quotes: [], anchors: [] } as WorkMention);
      m.count++;
      if (!m.description && e.description) m.description = e.description;
      if (m.quotes.length < 3) {
        const fresh = quoteRefs(e.evidence, 3 - m.quotes.length);
        const have = new Set(m.quotes.map((q) => q.p));
        for (const q of fresh) if (!have.has(q.p)) m.quotes.push(q);
      }
      // Chapter-resolved anchors for the reader (cap 12 per entity-work).
      // The phone book deduped ~200k duplicate paragraph ids first-occurrence,
      // so an id can resolve to a DIFFERENT work — guard against that.
      if (m.anchors.length < 12) {
        outer: for (const ev of e.evidence ?? []) {
          for (const p of ev.expanded_paragraph_ids ?? ev.paragraph_ids ?? []) {
            if (m.anchors.length >= 12) break outer;
            const loc = pIndex[p];
            if (!loc || loc.work !== work) continue;
            if (m.anchors.some((a) => a.p === p)) continue;
            m.anchors.push({ p, chapter: loc.chapter });
          }
        }
      }
      acc.mentions.set(work, m);
      entities.set(key, acc);
    }

    for (const c of doc.citations ?? []) {
      // placeholder author/work strings from the harvest are not targets
      const PLACEHOLDER = /^(unknown|unspecified|anonymous|uncertain|various|none|n\/?a|not specified|unnamed|\?+)$/i;
      let cw = c.cited_work?.trim() ?? "";
      let ca = c.cited_author?.trim() ?? "";
      if (PLACEHOLDER.test(cw)) cw = "";
      if (PLACEHOLDER.test(ca)) ca = "";
      if (!cw && !ca) continue;
      const stance = STANCES.includes(c.stance as (typeof STANCES)[number])
        ? (c.stance as string)
        : "neutral";
      stanceTotals[stance] = (stanceTotals[stance] ?? 0) + 1;
      wa.citationsOut++;
      const key = `${work}|${norm(cw)}|${norm(ca)}|${stance}`;
      const acc =
        citations.get(key) ??
        ({ from: work, citedWork: cw, citedAuthor: ca, stance, count: 0, quotes: [] } as CitationAcc);
      acc.count++;
      if (acc.quotes.length < 2)
        acc.quotes.push(...quoteRefs(c.evidence, 2 - acc.quotes.length));
      citations.set(key, acc);
    }

    for (const t of doc.themes ?? []) {
      if (!t?.topic) continue;
      wa.themes++;
      const key = norm(t.topic);
      if (!key) continue;
      const acc =
        themes.get(key) ??
        ({ names: {}, works: new Map(), implicit: 0, total: 0 } as ThemeAcc);
      acc.total++;
      if (t.implicit) acc.implicit++;
      acc.names[t.topic] = (acc.names[t.topic] ?? 0) + 1;
      const tw = acc.works.get(work) ?? { count: 0, quotes: [] };
      tw.count++;
      if (tw.quotes.length < 1) tw.quotes.push(...quoteRefs(t.evidence, 1));
      acc.works.set(work, tw);
      themes.set(key, acc);
    }

    totalQuoteEvents += doc.quote_events?.length ?? 0;
    wa.quoteEvents += doc.quote_events?.length ?? 0;
    perWork.set(work, wa);
  }

  // ---- alias fold ----------------------------------------------------
  // If entity A's canonical norm equals a surface-name norm of a much
  // larger entity B of the same kind, fold A into B. Deterministic: owners
  // assigned in descending-size order, first wins.
  //
  // Polysemy guards (the God≠Zeus rule): a surface form like "God" or
  // "the Lord" is carried by MANY entities and proves nothing about
  // identity. We only fold via RARE surfaces (≤2 carriers of that kind),
  // only into a much larger owner (src ≤ 15% of dst, or trivially small),
  // and never fold an entity established in its own right (≥3 works).
  {
    const keys = [...entities.keys()].sort((a, b) => {
      const sa = entities.get(a)!.evidenceCount;
      const sb = entities.get(b)!.evidenceCount;
      return sb - sa || (a < b ? -1 : 1);
    });
    // how many entities of this kind carry each surface norm?
    const surfaceCarriers = new Map<string, number>();
    for (const key of keys) {
      const acc = entities.get(key)!;
      const seen = new Set<string>();
      for (const s of Object.keys(acc.surfaces)) {
        const sk = `${acc.kind}|${norm(s)}`;
        if (!seen.has(sk)) {
          seen.add(sk);
          surfaceCarriers.set(sk, (surfaceCarriers.get(sk) ?? 0) + 1);
        }
      }
    }
    const surfaceOwner = new Map<string, string>(); // `${kind}|${norm(surface)}` -> key
    for (const key of keys) {
      const acc = entities.get(key)!;
      for (const s of Object.keys(acc.surfaces)) {
        const sk = `${acc.kind}|${norm(s)}`;
        if ((surfaceCarriers.get(sk) ?? 0) > 2) continue; // polysemous — no ownership
        if (!surfaceOwner.has(sk)) surfaceOwner.set(sk, key);
      }
    }
    let folded = 0;
    for (const key of [...keys].reverse()) {
      // smallest first
      const owner = surfaceOwner.get(key);
      if (!owner || owner === key) continue;
      const src = entities.get(key);
      const dst = entities.get(owner);
      if (!src || !dst) continue;
      if (dst.evidenceCount <= src.evidenceCount) continue; // strictly larger only
      if (src.mentions.size >= 3) continue; // established in its own right
      if (src.evidenceCount > 5 && src.evidenceCount > dst.evidenceCount * 0.15)
        continue; // not clearly a minor variant of the owner
      for (const [k, v] of Object.entries(src.figureKinds))
        dst.figureKinds[k] = (dst.figureKinds[k] ?? 0) + v;
      for (const [k, v] of Object.entries(src.names))
        dst.names[k] = (dst.names[k] ?? 0) + v;
      for (const [k, v] of Object.entries(src.surfaces))
        dst.surfaces[k] = (dst.surfaces[k] ?? 0) + v;
      for (const [w, m] of src.mentions) {
        const dm =
          dst.mentions.get(w) ??
          ({ work: w, count: 0, quotes: [], anchors: [] } as WorkMention);
        dm.count += m.count;
        if (!dm.description) dm.description = m.description;
        const have = new Set(dm.quotes.map((q) => q.p));
        for (const q of m.quotes)
          if (dm.quotes.length < 3 && !have.has(q.p)) dm.quotes.push(q);
        const haveA = new Set(dm.anchors.map((a) => a.p));
        for (const a of m.anchors)
          if (dm.anchors.length < 12 && !haveA.has(a.p)) dm.anchors.push(a);
        dst.mentions.set(w, dm);
      }
      dst.evidenceCount += src.evidenceCount;
      entities.delete(key);
      folded++;
    }
    console.log(`alias fold: ${folded} entities merged into larger owners`);
  }

  const pick = (rec: Record<string, number>): string =>
    Object.entries(rec).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "";

  // ---- concordance fold: concept clustering ---------------------------
  // "Truth (Satya)", "satya" and "Truth" are one concept spoken three ways;
  // "Sparta (Lacedaemon)" and "Lacedaemon" are one city. This stage clusters
  // same-concept entities under one head while keeping every expression
  // legible (name, gloss, works, quotes), so a concept page can say:
  // Time — spoken of as kāla in the Sanskrit texts. Deterministic rules
  // (the harvester's own parenthetical glosses, the-prefix, plurals, figure
  // epithets) + the curated concordance.json authority file. The `never`
  // guard list blocks famously-distinct concepts (dharma≠law, Gods≠God)
  // from any fold, rule-driven or curated.
  const seeRefs: { name: string; gloss?: string; kind: string; rootKey: string }[] = [];
  {
    const conc = concordance;
    const never = new Set(
      (conc.never ?? []).map((p) => [...p].sort().join("||")),
    );
    const guarded = (a: string, b: string) => never.has([a, b].sort().join("||"));
    const clusterHead = new Map<string, string>(); // `${kind}|${memberNorm}` -> headNorm
    for (const [kind, groups] of Object.entries(conc.clusters ?? {})) {
      for (const g of groups)
        for (const m of g.members) clusterHead.set(`${kind}|${norm(m)}`, norm(g.head));
    }

    const PAREN = /^(.*?)\s*\(([^)]{2,40})\)\s*$/;
    // pass 1: display names + glosses
    for (const acc of entities.values()) {
      const rep = pick(acc.names);
      const m = rep.match(PAREN);
      if (m && m[1].trim()) {
        acc.gloss = m[2].trim();
        // figures keep the full name (the parenthetical is often the
        // disambiguator: "John (King of England)"); others clean to the base.
        acc.displayName = acc.kind === "figure" ? rep : m[1].trim();
      } else {
        acc.displayName = rep;
      }
    }

    // norm index over cleaned display names (largest owner wins)
    const keysBySize = [...entities.keys()].sort((a, b) => {
      return (
        entities.get(b)!.evidenceCount - entities.get(a)!.evidenceCount ||
        (a < b ? -1 : 1)
      );
    });
    const normIndex = new Map<string, string>();
    for (const key of keysBySize) {
      const acc = entities.get(key)!;
      const nk = `${acc.kind}|${norm(acc.displayName!)}`;
      if (!normIndex.has(nk)) normIndex.set(nk, key);
    }
    // resolve a norm to an entity key: cleaned-display index first, then the
    // original merge-key space (concordance heads may name either)
    const findByNorm = (kind: string, n: string): string | undefined => {
      const byDisplay = normIndex.get(`${kind}|${n}`);
      if (byDisplay) return byDisplay;
      return entities.has(`${kind}|${n}`) ? `${kind}|${n}` : undefined;
    };

    const foldedInto = new Map<string, string>();
    const root = (k: string): string => {
      let r = k;
      while (foldedInto.has(r)) r = foldedInto.get(r)!;
      return r;
    };

    function stemLast(n: string): string {
      const words = n.split(" ");
      const w = words[words.length - 1];
      let w2 = w;
      if (w.length > 3 && w.endsWith("es") && !w.endsWith("ses")) w2 = w.slice(0, -2);
      else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w2 = w.slice(0, -1);
      return [...words.slice(0, -1), w2].join(" ");
    }

    let conceptFolds = 0;
    // smallest first, so chains resolve toward the biggest heads
    for (const key of [...keysBySize].reverse()) {
      if (foldedInto.has(key) || !entities.has(key)) continue;
      const acc = entities.get(key)!;
      const kind = acc.kind;
      const nd = norm(acc.displayName!);
      const nFull = norm(pick(acc.names));
      const nGloss = acc.gloss ? norm(acc.gloss) : "";

      let targetKey: string | undefined;
      // (a) curated cluster membership (checked on every surface of the name)
      for (const cand of [nd, nFull, nGloss]) {
        if (!cand) continue;
        const head = clusterHead.get(`${kind}|${cand}`);
        if (head && head !== nd) {
          targetKey = findByNorm(kind, head);
          if (targetKey) break;
        }
      }
      // (b) same-norm fold after cleaning ("Truth (Satya)"→"Truth")
      if (!targetKey) {
        const owner = normIndex.get(`${kind}|${nd}`);
        if (owner && root(owner) !== key && owner !== key) targetKey = owner;
      }
      // (c) gloss fold — figures only ever fold toward the gloss target
      if (!targetKey && nGloss) {
        const gt = findByNorm(kind, nGloss);
        if (gt && gt !== key) targetKey = gt;
      }
      // (d) the-prefix
      if (!targetKey && nd.startsWith("the ")) {
        const t = findByNorm(kind, nd.slice(4));
        if (t && t !== key) targetKey = t;
      }
      // (e) conservative plural fold (never for figures: Gods≠God)
      if (!targetKey && kind !== "figure") {
        const st = stemLast(nd);
        if (st !== nd) {
          const t = findByNorm(kind, st);
          if (t && t !== key) targetKey = t;
        }
      }
      // (f) figure epithets: "Zeus the Liberator" → Zeus
      if (!targetKey && kind === "figure") {
        const em = acc.displayName!.match(/^(.{2,25}?)\s+(?:the|of)\s+.{2,40}$/i);
        if (em) {
          const t = findByNorm(kind, norm(em[1]));
          if (t && t !== key) {
            const tAcc = entities.get(root(t));
            if (tAcc && tAcc.mentions.size >= 2 && tAcc.evidenceCount > acc.evidenceCount)
              targetKey = t;
          }
        }
      }

      if (!targetKey) continue;
      const rootKey = root(targetKey);
      if (rootKey === key) continue;
      const dst = entities.get(rootKey);
      if (!dst) continue;
      const rootNorm = norm(dst.displayName ?? pick(dst.names));
      if (guarded(`${kind}|${nd}`, `${kind}|${rootNorm}`)) continue;
      if (guarded(`${kind}|${nFull}`, `${kind}|${rootNorm}`)) continue;

      // fold acc → dst, keeping the expression legible
      const exprName =
        kind === "figure" && acc.gloss && PAREN.test(pick(acc.names))
          ? pick(acc.names).match(PAREN)![1].trim()
          : acc.displayName!;
      const sameName = norm(exprName) === rootNorm;
      const mentionTotal = [...acc.mentions.values()].reduce((s, m) => s + m.count, 0);
      if (!sameName) {
        (dst.expressions ??= []).push({
          name: exprName,
          gloss: acc.gloss,
          mentions: mentionTotal,
          works: [...acc.mentions.values()]
            .sort((a, b) => b.count - a.count)
            .slice(0, 6)
            .map((m) => ({ work: m.work, count: m.count, quotes: m.quotes.slice(0, 2) })),
        });
        seeRefs.push({ name: exprName, gloss: acc.gloss, kind, rootKey });
      }
      if (acc.expressions) (dst.expressions ??= []).push(...acc.expressions);

      for (const [k2, v] of Object.entries(acc.figureKinds))
        dst.figureKinds[k2] = (dst.figureKinds[k2] ?? 0) + v;
      for (const [k2, v] of Object.entries(acc.names)) dst.names[k2] = (dst.names[k2] ?? 0) + v;
      for (const [k2, v] of Object.entries(acc.surfaces))
        dst.surfaces[k2] = (dst.surfaces[k2] ?? 0) + v;
      for (const [w, m] of acc.mentions) {
        const dm =
          dst.mentions.get(w) ??
          ({ work: w, count: 0, quotes: [], anchors: [] } as WorkMention);
        dm.count += m.count;
        if (!dm.description) dm.description = m.description;
        const have = new Set(dm.quotes.map((q) => q.p));
        for (const q of m.quotes)
          if (dm.quotes.length < 3 && !have.has(q.p)) dm.quotes.push(q);
        const haveA = new Set(dm.anchors.map((a) => a.p));
        for (const a of m.anchors)
          if (dm.anchors.length < 12 && !haveA.has(a.p)) dm.anchors.push(a);
        dst.mentions.set(w, dm);
      }
      dst.evidenceCount += acc.evidenceCount;
      entities.delete(key);
      foldedInto.set(key, rootKey);
      conceptFolds++;
    }
    // a see-ref's head may itself have folded later in the pass (Cattle →
    // Cow after members joined Cattle) — resolve every ref to its final root
    for (const ref of seeRefs) ref.rootKey = root(ref.rootKey);
    console.log(
      `concordance fold: ${conceptFolds} entities clustered under concept heads (${seeRefs.length} see-references)`,
    );
  }

  // ---- finalize entities --------------------------------------------
  const slugTaken = new Map<string, number>();
  interface EntityOut {
    slug: string;
    kind: string;
    figure_kind?: string;
    name: string;
    gloss?: string;
    surfaces: string[];
    author_slug?: string;
    works: number;
    mentions: number;
    evidence: number;
    page: boolean;
    /** categorical layer: pantheon / divine collective (browsing class) */
    divine?: boolean;
  }
  const entityRows: (EntityOut & {
    _detail: WorkMention[];
    _expressions?: Expression[];
    _key: string;
  })[] = [];
  const slugByKey = new Map<string, string>();
  const orderedEntities = [...entities.entries()].sort((a, b) => {
    return (
      b[1].evidenceCount - a[1].evidenceCount ||
      (a[0] < b[0] ? -1 : 1)
    );
  });
  for (const [key, acc] of orderedEntities) {
    const name = acc.displayName ?? pick(acc.names);
    // slug from the cleaned display norm — the concept's stable identity
    // (the merge key can be a glossed compound like "truth satya")
    const normName = norm(name) || (key.split("|")[1] ?? name);
    let slug = `${slugify(normName)}`;
    const n = slugTaken.get(`${acc.kind}/${slug}`) ?? 0;
    slugTaken.set(`${acc.kind}/${slug}`, n + 1);
    if (n > 0) slug = `${slug}-${n + 1}`;
    slugByKey.set(key, slug);
    const mentions = [...acc.mentions.values()].sort(
      (a, b) => b.count - a.count || (a.work < b.work ? -1 : 1),
    );
    const worksCount = mentions.length;
    const mentionCount = mentions.reduce((s, m) => s + m.count, 0);
    const surfaces = Object.entries(acc.surfaces)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 12)
      .map(([s]) => s)
      .filter((s) => s !== name);
    const authorSlug = normAuthor.get(norm(name));
    const divine =
      (acc.kind === "group" && divineSet.has(norm(name))) || undefined;
    const isJunk = junkSet.has(`${acc.kind}|${norm(name)}`);
    const page =
      !isJunk && (worksCount >= 2 || acc.evidenceCount >= 8 || Boolean(authorSlug));
    entityRows.push({
      slug,
      kind: acc.kind,
      figure_kind: acc.kind === "figure" ? pick(acc.figureKinds) || undefined : undefined,
      name,
      gloss: acc.gloss,
      surfaces,
      author_slug: authorSlug,
      works: worksCount,
      mentions: mentionCount,
      evidence: acc.evidenceCount,
      page,
      divine,
      _detail: mentions,
      _expressions: mergeExpressions(acc.expressions),
      _key: key,
    });
  }

  /** Fold near-duplicate expressions ("Alethes (truth)", "Alêtheia (truth)",
   *  "Alêtheia") into one facet per clean base name, works merged. */
  function mergeExpressions(list?: Expression[]): Expression[] | undefined {
    if (!list?.length) return undefined;
    const PAREN2 = /^(.*?)\s*\(([^)]{2,60})\)\s*$/;
    const byBase = new Map<string, Expression>();
    for (const x of list) {
      const m = x.name.match(PAREN2);
      const base = (m && m[1].trim()) || x.name;
      const gloss = x.gloss ?? (m ? m[2].trim() : undefined);
      const k = norm(base).replace(/\s+/g, " ");
      const acc =
        byBase.get(k) ?? ({ name: base, gloss, mentions: 0, works: [] } as Expression);
      if (base.length < acc.name.length) acc.name = base;
      if (!acc.gloss && gloss) acc.gloss = gloss;
      acc.mentions += x.mentions;
      for (const w of x.works) {
        const have = acc.works.find((y) => y.work === w.work);
        if (have) {
          have.count += w.count;
          for (const q of w.quotes)
            if (have.quotes.length < 2 && !have.quotes.some((z) => z.p === q.p))
              have.quotes.push(q);
        } else if (acc.works.length < 6) acc.works.push({ ...w, quotes: [...w.quotes] });
      }
      byBase.set(k, acc);
    }
    return [...byBase.values()]
      .sort((a, b) => b.mentions - a.mentions || (a.name < b.name ? -1 : 1))
      .slice(0, 12);
  }

  // see-references: "Kāla, see Time" — ledger rows + redirect stubs for the
  // folded members' former URLs. Slugs assigned after heads so heads keep
  // their stable slugs.
  const seeRows: (EntityOut & { see: string })[] = [];
  {
    const seen = new Set<string>();
    for (const ref of seeRefs) {
      const headSlug = slugByKey.get(ref.rootKey);
      if (!headSlug) continue;
      let slug = slugify(norm(ref.name));
      const dedupeKey = `${ref.kind}/${slug}`;
      if (seen.has(dedupeKey)) continue; // one see-row per name
      seen.add(dedupeKey);
      const n = slugTaken.get(dedupeKey) ?? 0;
      slugTaken.set(dedupeKey, n + 1);
      if (n > 0) slug = `${slug}-${n + 1}`;
      seeRows.push({
        slug,
        kind: ref.kind,
        name: ref.name,
        gloss: ref.gloss,
        surfaces: [],
        works: 0,
        mentions: 0,
        evidence: 0,
        page: false,
        see: headSlug,
      });
    }
    console.log(`see-references emitted: ${seeRows.length}`);
  }

  // ---- resolve citations to in-corpus targets ------------------------
  const citationRows = [...citations.values()]
    .sort((a, b) => b.count - a.count || (a.from < b.from ? -1 : 1))
    .map((c) => {
      // try (author+title) match first, then unique title, then author link
      let toWork: string | undefined;
      const nt = norm(c.citedWork);
      if (nt) {
        const cands = normWorkTitle.get(nt) ?? [];
        if (cands.length === 1) toWork = cands[0];
        else if (cands.length > 1 && c.citedAuthor) {
          const na = norm(c.citedAuthor);
          toWork = cands.find((s) => {
            const a = works[s]?.author;
            return a && norm(authorName[a] ?? "") === na;
          });
        }
      }
      const toAuthor = c.citedAuthor ? normAuthor.get(norm(c.citedAuthor)) : undefined;
      return {
        from: c.from,
        cited_work: c.citedWork || undefined,
        cited_author: c.citedAuthor || undefined,
        stance: c.stance,
        count: c.count,
        to_work: toWork,
        to_author: toAuthor,
        quotes: c.quotes,
      };
    });

  // ---- artifacts -----------------------------------------------------
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(join(OUT_DIR, "entities"), { recursive: true });

  // meta: every number the UI shows derives from here or from the rows.
  let syncState: unknown = null;
  try {
    syncState = await Bun.file(join(RUN_DIR, "sync-state.json")).json();
  } catch {}
  const harvestedWorks = [...perWork.keys()];
  const covByLang: Record<string, { done: number; total: number }> = {};
  const covByEra: Record<string, { done: number; total: number }> = {};
  {
    const totalByWork: Record<string, number> = windowsTotal;
    const doneByWork: Record<string, number> = {};
    for (const [w, a] of perWork) doneByWork[w] = a.windowsDone;
    const allWorks = new Set([
      ...Object.keys(totalByWork),
      ...Object.keys(doneByWork),
    ]);
    for (const w of allWorks) {
      const lang = works[w]?.language ?? "unknown";
      const era = works[w]?.era ?? "unknown";
      const t = totalByWork[w] ?? doneByWork[w] ?? 0;
      const d = doneByWork[w] ?? 0;
      (covByLang[lang] ??= { done: 0, total: 0 });
      covByLang[lang].done += d;
      covByLang[lang].total += t;
      (covByEra[era] ??= { done: 0, total: 0 });
      covByEra[era].done += d;
      covByEra[era].total += t;
    }
  }
  const meta = {
    generated_at: new Date().toISOString(),
    ontology_version: "anchor-range-v1",
    paragraphs_indexed: Object.keys(pIndex).length,
    windows_synthesized: files.length,
    windows_total: Object.values(windowsTotal).reduce((s, n) => s + n, 0) || null,
    works_harvested: harvestedWorks.length,
    works_total: Object.keys(works).length,
    sync: syncState,
    totals: {
      entity_rows_premerge: totalEntityRows,
      entities_merged: entityRows.length,
      entity_evidence_objects: totalEvidence,
      entity_verbatim_quotes: totalQuotes,
      citations: citationRows.reduce((s, c) => s + c.count, 0),
      citation_edges: citationRows.length,
      themes: [...themes.values()].reduce((s, t) => s + t.total, 0),
      theme_topics: themes.size,
      quote_events: totalQuoteEvents,
    },
    kinds: kindTotals,
    stances: stanceTotals,
    coverage: { by_language: covByLang, by_era: covByEra },
  };
  await Bun.write(join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  // entity detail files (page-worthy only) + index
  let pages = 0;
  for (const e of entityRows) {
    if (!e.page) continue;
    pages++;
    const detail = {
      slug: e.slug,
      kind: e.kind,
      figure_kind: e.figure_kind,
      name: e.name,
      gloss: e.gloss,
      divine: e.divine,
      surfaces: e.surfaces,
      author_slug: e.author_slug,
      works: e._detail.map((m) => ({
        work: m.work,
        title: works[m.work]?.title ?? m.work,
        author: works[m.work]?.author,
        era: works[m.work]?.era,
        language: works[m.work]?.language,
        count: m.count,
        description: m.description,
        quotes: m.quotes,
      })),
      expressions: e._expressions?.map((x) => ({
        name: x.name,
        gloss: x.gloss,
        mentions: x.mentions,
        works: x.works.map((w) => ({
          ...w,
          title: works[w.work]?.title ?? w.work,
          language: works[w.work]?.language,
        })),
      })),
      mentions: e.mentions,
      evidence: e.evidence,
    };
    await Bun.write(
      join(OUT_DIR, "entities", `${e.kind}--${e.slug}.json`),
      JSON.stringify(detail) + "\n",
    );
  }
  const index = [
    ...entityRows.map(({ _detail, _expressions, _key, ...row }) => row),
    ...seeRows,
  ];
  await Bun.write(
    join(OUT_DIR, "entities-index.json"),
    JSON.stringify(index) + "\n",
  );

  await Bun.write(
    join(OUT_DIR, "citations.json"),
    JSON.stringify(citationRows) + "\n",
  );

  const themeRows = [...themes.entries()]
    .sort((a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : 1))
    .map(([key, t]) => ({
      slug: slugify(key),
      topic: pick(t.names),
      total: t.total,
      implicit: t.implicit,
      works: [...t.works.entries()]
        .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
        .slice(0, 40)
        .map(([w, x]) => ({
          work: w,
          title: works[w]?.title ?? w,
          count: x.count,
          quote: x.quotes[0],
        })),
    }));
  await Bun.write(
    join(OUT_DIR, "themes-index.json"),
    JSON.stringify(themeRows) + "\n",
  );

  // per-work top entities (for the work page's atlas strip)
  const topByWork = new Map<
    string,
    { slug: string; kind: string; name: string; count: number }[]
  >();
  for (const e of entityRows) {
    if (!e.page) continue; // only link entities that have pages
    for (const m of e._detail) {
      const arr = topByWork.get(m.work) ?? [];
      arr.push({ slug: e.slug, kind: e.kind, name: e.name, count: m.count });
      topByWork.set(m.work, arr);
    }
  }
  for (const arr of topByWork.values())
    arr.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));

  const workRows = harvestedWorks
    .sort()
    .map((w) => {
      const a = perWork.get(w)!;
      return {
        top_entities: (topByWork.get(w) ?? []).slice(0, 12),
        work: w,
        title: works[w]?.title ?? w,
        author: works[w]?.author,
        era: works[w]?.era,
        language: works[w]?.language,
        genre: works[w]?.genre,
        windows_done: a.windowsDone,
        windows_total: windowsTotal[w] ?? a.windowsDone,
        entity_rows: a.entityRows,
        kinds: a.kinds,
        citations_out: a.citationsOut,
        quote_events: a.quoteEvents,
        themes: a.themes,
      };
    });
  await Bun.write(
    join(OUT_DIR, "works-atlas.json"),
    JSON.stringify(workRows) + "\n",
  );

  // per-work chapter ontology (reader integration: per-chapter panels +
  // inline term highlighting). One file per harvested work:
  //   works/<slug>.json = { work, chapters: { <chapter>: [entity…] } }
  await mkdir(join(OUT_DIR, "works"), { recursive: true });
  {
    interface ChapterEntity {
      slug: string;
      kind: string;
      name: string;
      page: boolean;
      count: number;
      desc?: string;
      match: string[]; // strings the client highlighter looks for
      p: string[]; // anchored paragraph ids within this chapter
    }
    const perWork = new Map<string, Map<string, ChapterEntity[]>>();
    for (const e of entityRows) {
      const match = [e.name, ...e.surfaces]
        .filter((s) => s.length >= 3 && s.length <= 40)
        .slice(0, 6);
      for (const m of e._detail) {
        if (m.anchors.length === 0) continue;
        const byChapter = new Map<string, string[]>();
        for (const a of m.anchors) {
          const arr = byChapter.get(a.chapter) ?? [];
          arr.push(a.p);
          byChapter.set(a.chapter, arr);
        }
        const wmap = perWork.get(m.work) ?? new Map<string, ChapterEntity[]>();
        for (const [chapter, ps] of byChapter) {
          const list = wmap.get(chapter) ?? [];
          list.push({
            slug: e.slug,
            kind: e.kind,
            name: e.name,
            page: e.page,
            count: m.count,
            desc: m.description
              ? m.description.length > 200
                ? m.description.slice(0, 198).trimEnd() + " …"
                : m.description
              : undefined,
            match,
            p: ps,
          });
          wmap.set(chapter, list);
        }
        perWork.set(m.work, wmap);
      }
    }
    let workFiles = 0;
    for (const [w, wmap] of perWork) {
      const chapters: Record<string, ChapterEntity[]> = {};
      for (const [chapter, list] of [...wmap.entries()].sort()) {
        chapters[chapter] = list
          .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
          .slice(0, 40);
      }
      await Bun.write(
        join(OUT_DIR, "works", `${w}.json`),
        JSON.stringify({ work: w, chapters }) + "\n",
      );
      workFiles++;
    }
    console.log(`per-work ontology files: ${workFiles}`);
  }

  const dt = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    [
      `synthesis complete in ${dt}s`,
      `  windows: ${files.length} · works: ${harvestedWorks.length}/${Object.keys(works).length}`,
      `  entities: ${totalEntityRows} rows → ${entityRows.length} merged (${pages} with pages)`,
      `  citations: ${meta.totals.citations} → ${citationRows.length} edges`,
      `  themes: ${meta.totals.themes} → ${themes.size} topics`,
      `  quotes: ${totalQuotes} verbatim on ${totalEvidence} evidence objects`,
      `  → ${OUT_DIR}`,
    ].join("\n"),
  );
}

await main();
