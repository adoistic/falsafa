# Citation-Graph Data Pipeline (Phase 1a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From explicit references extracted per work, produce a grounded citation graph (works/authors as nodes, `cites` edges carrying paragraph citations + stance) and a ranked acquisition list of referenced-but-absent works.

**Architecture:** A deterministic core — corpus index, reference resolver, acquisition aggregator, graph builder — is fully TDD-tested. A separate LLM step (`openrouter-chat`) emits raw reference records that feed the core; its output is checked by confirming every citing paragraph id exists. Designed to run on any work-set; piloted on the cluster we've already extracted (the three smṛtis + the four Western works) before going corpus-wide.

**Tech Stack:** Bun + TypeScript. Reuses `scripts/lib/slug.ts` (`slugify`) and `scripts/lib/openrouter-chat.ts`. Reads `corpus/manifest.json` and per-chapter `translation.paragraphs.json` sidecars. Outputs JSON artifacts under `corpus/graph/`.

---

## File Structure

- `scripts/graph/types.ts` — shared types (RawReference, ResolvedReference, GraphNode, GraphEdge, CitationGraph, AcquisitionEntry). One contract, imported everywhere.
- `scripts/graph/resolve-references.ts` — `buildCorpusIndex(manifest)` + `resolveReference(ref, index)`. The deterministic heart.
- `scripts/graph/resolve-references.test.ts` — resolver tests.
- `scripts/graph/acquisition-list.ts` — `buildAcquisitionList(resolved)`: rank absent targets by citation count.
- `scripts/graph/acquisition-list.test.ts` — aggregator tests.
- `scripts/graph/build-graph.ts` — `buildCitationGraph(resolved)` + `withBacklinks(graph)`: nodes, edges, inbound-citation counts.
- `scripts/graph/build-graph.test.ts` — graph-builder tests.
- `scripts/graph/extract-references.ts` — per-work LLM extraction → raw reference records; `validateRawReferences(records, paragraphIds)` is the testable seam.
- `scripts/graph/extract-references.test.ts` — validation tests (not the LLM).
- `scripts/graph/run.ts` — orchestrator: extract (or load) → resolve → build → write `corpus/graph/{citation-graph.json, acquisition-list.json, stats.json}`.
- `corpus/graph/` — output artifacts (git-ignored like other generated corpus data; confirm against `.gitignore`).

Tests run co-located with `bun test` from inside `scripts/graph/` (the repo's `bun test` EMFILE gotcha: run from the test's own dir, not the repo root).

---

### Task 1: Shared types

**Files:**
- Create: `scripts/graph/types.ts`

- [ ] **Step 1: Write the types**

```typescript
export type ReferenceStance = "endorse" | "refute" | "extend" | "authority" | "neutral";

export interface RawReference {
  citing_work_slug: string;
  citing_paragraph_id: string; // "p-xxxxxx", must exist in the citing work
  raw_target: string;          // the work or author named, as written
  target_kind: "work" | "author";
  stance: ReferenceStance;
  quote: string;               // short verbatim snippet containing the reference
}

export type ResolutionStatus =
  | "in_corpus_work"
  | "in_corpus_author"
  | "absent"
  | "ambiguous";

export interface ResolvedReference extends RawReference {
  status: ResolutionStatus;
  target_id: string | null;    // resolved work-slug / author-slug, else null
  candidates: string[];        // populated when status === "ambiguous"
}

export interface GraphNode {
  id: string;                  // work-slug | author-slug | "absent:<normalized>"
  kind: "work" | "author" | "absent";
  label: string;
  in_corpus: boolean;
  cited_by_count: number;      // inbound citations (filled by withBacklinks)
}

export interface GraphEdge {
  from: string;                // citing work-slug
  to: string;                  // target node id
  type: "cites";
  stance: ReferenceStance;
  citations: { paragraph_id: string; quote: string }[];
}

export interface CitationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AcquisitionEntry {
  normalized_target: string;
  label: string;
  citation_count: number;
  cited_by: { work_slug: string; paragraph_id: string }[];
}

export interface ManifestWork {
  slug: string;
  title: string;
  author: string;
  author_slug: string;
}
export interface Manifest {
  works: ManifestWork[];
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/graph/types.ts
git commit -m "feat(graph): citation-graph shared types"
```

---

### Task 2: Corpus index + reference resolver

Resolution matches a reference's normalized target against work titles and author names from the manifest, using containment (targets are rarely full titles — "the Wealth of Nations" vs "An Inquiry into the Nature and Causes of the Wealth of Nations"). One match → resolved; several → ambiguous (e.g. "Comte" → Charles + Auguste); none → absent.

**Files:**
- Create: `scripts/graph/resolve-references.ts`
- Test: `scripts/graph/resolve-references.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd scripts/graph && bun test ./resolve-references.test.ts`
Expected: FAIL — `buildCorpusIndex`/`resolveReference` not defined.

- [ ] **Step 3: Implement**

```typescript
import { slugify } from "../lib/slug";
import type { Manifest, RawReference, ResolvedReference } from "./types";

export interface CorpusIndex {
  works: { slug: string; titleSlug: string; label: string }[];
  authors: Map<string, string[]>; // author-slug -> work-slugs (for reference)
  authorSlugs: Set<string>;
  authorLabel: Map<string, string>;
}

export function buildCorpusIndex(manifest: Manifest): CorpusIndex {
  const works = manifest.works.map((w) => ({ slug: w.slug, titleSlug: slugify(w.title), label: w.title }));
  const authors = new Map<string, string[]>();
  const authorLabel = new Map<string, string>();
  for (const w of manifest.works) {
    const list = authors.get(w.author_slug) ?? [];
    list.push(w.slug);
    authors.set(w.author_slug, list);
    authorLabel.set(w.author_slug, w.author);
  }
  return { works, authors, authorSlugs: new Set(authors.keys()), authorLabel };
}

function contains(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return haystack === needle || haystack.includes(needle) || needle.includes(haystack);
}

export function resolveReference(ref: RawReference, index: CorpusIndex): ResolvedReference {
  const target = slugify(ref.raw_target);
  const base = { ...ref, target_id: null as string | null, candidates: [] as string[] };

  if (ref.target_kind === "author") {
    const hits = [...index.authorSlugs].filter((a) => contains(a, target));
    if (hits.length === 1) return { ...base, status: "in_corpus_author", target_id: hits[0]! };
    if (hits.length > 1) return { ...base, status: "ambiguous", candidates: hits.sort() };
    return { ...base, status: "absent" };
  }

  const hits = index.works.filter((w) => contains(w.titleSlug, target)).map((w) => w.slug);
  if (hits.length === 1) return { ...base, status: "in_corpus_work", target_id: hits[0]! };
  if (hits.length > 1) return { ...base, status: "ambiguous", candidates: hits.sort() };
  return { ...base, status: "absent" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd scripts/graph && bun test ./resolve-references.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/resolve-references.ts scripts/graph/resolve-references.test.ts
git commit -m "feat(graph): reference resolver (in-corpus / ambiguous / absent)"
```

---

### Task 3: Acquisition-list aggregator

**Files:**
- Create: `scripts/graph/acquisition-list.ts`
- Test: `scripts/graph/acquisition-list.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd scripts/graph && bun test ./acquisition-list.test.ts`
Expected: FAIL — `buildAcquisitionList` not defined.

- [ ] **Step 3: Implement**

```typescript
import { slugify } from "../lib/slug";
import type { AcquisitionEntry, ResolvedReference } from "./types";

export function buildAcquisitionList(resolved: ResolvedReference[]): AcquisitionEntry[] {
  const byTarget = new Map<string, AcquisitionEntry>();
  for (const ref of resolved) {
    if (ref.status !== "absent") continue;
    const key = slugify(ref.raw_target);
    const entry = byTarget.get(key) ?? { normalized_target: key, label: ref.raw_target, citation_count: 0, cited_by: [] };
    entry.citation_count += 1;
    entry.cited_by.push({ work_slug: ref.citing_work_slug, paragraph_id: ref.citing_paragraph_id });
    byTarget.set(key, entry);
  }
  return [...byTarget.values()].sort(
    (a, b) => b.citation_count - a.citation_count || a.normalized_target.localeCompare(b.normalized_target),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd scripts/graph && bun test ./acquisition-list.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/acquisition-list.ts scripts/graph/acquisition-list.test.ts
git commit -m "feat(graph): ranked acquisition list of absent references"
```

---

### Task 4: Citation-graph builder + backlinks

**Files:**
- Create: `scripts/graph/build-graph.ts`
- Test: `scripts/graph/build-graph.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd scripts/graph && bun test ./build-graph.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement**

```typescript
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd scripts/graph && bun test ./build-graph.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/build-graph.ts scripts/graph/build-graph.test.ts
git commit -m "feat(graph): citation-graph builder with backlink counts"
```

---

### Task 5: LLM reference extractor

The LLM finds explicit references in a work and emits `RawReference` records. The non-deterministic call is isolated; the testable seam is `validateRawReferences`, which drops any record whose `citing_paragraph_id` is not a real paragraph of that work (the grounding guard).

**Files:**
- Create: `scripts/graph/extract-references.ts`
- Test: `scripts/graph/extract-references.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { validateRawReferences } from "./extract-references";
import type { RawReference } from "./types";

const rec = (p: string): RawReference => ({
  citing_work_slug: "parasara", citing_paragraph_id: p, raw_target: "Manu",
  target_kind: "author", stance: "authority", quote: "thus has Manu declared",
});

describe("validateRawReferences", () => {
  test("keeps records with real paragraph ids, drops the rest", () => {
    const real = new Set(["p-8991a9"]);
    const { kept, dropped } = validateRawReferences([rec("p-8991a9"), rec("p-deadbe")], real);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(kept[0]!.citing_paragraph_id).toBe("p-8991a9");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd scripts/graph && bun test ./extract-references.test.ts`
Expected: FAIL — `validateRawReferences` not defined.

- [ ] **Step 3: Implement**

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chatJSON } from "../lib/openrouter-chat"; // confirm exported name; see note below
import type { RawReference } from "./types";

export function validateRawReferences(
  records: RawReference[],
  realParagraphIds: Set<string>,
): { kept: RawReference[]; dropped: RawReference[] } {
  const kept: RawReference[] = [];
  const dropped: RawReference[] = [];
  for (const r of records) (realParagraphIds.has(r.citing_paragraph_id) ? kept : dropped).push(r);
  return { kept, dropped };
}

export function paragraphIdsFor(corpusRoot: string, slug: string, chapterDirs: string[]): Set<string> {
  const ids = new Set<string>();
  for (const dir of chapterDirs) {
    const file = join(corpusRoot, "works", slug, "chapters", dir, "translation.paragraphs.json");
    for (const p of JSON.parse(readFileSync(file, "utf-8")) as { id: string }[]) ids.add(p.id);
  }
  return ids;
}

export const EXTRACTION_PROMPT = `You are extracting EXPLICIT references from one work in a philosophy corpus.
A reference is where the text names another work or author (cites, quotes, invokes as authority, rebuts, extends).
For each, return: citing_paragraph_id (the p-xxxxxx it appears in), raw_target (the work/author named, as written),
target_kind ("work"|"author"), stance ("endorse"|"refute"|"extend"|"authority"|"neutral"), quote (a short verbatim
snippet containing the reference). Cite only real p-ids from the provided paragraphs; quotes must be verbatim.
Return JSON: { "references": RawReference[] }.`;

export async function extractReferences(
  corpusRoot: string, slug: string, chapterDirs: string[],
): Promise<RawReference[]> {
  const realIds = paragraphIdsFor(corpusRoot, slug, chapterDirs);
  const paragraphs = chapterDirs.flatMap((dir) =>
    JSON.parse(readFileSync(join(corpusRoot, "works", slug, "chapters", dir, "translation.paragraphs.json"), "utf-8")) as { id: string; text: string }[]);
  const out = await chatJSON({ system: EXTRACTION_PROMPT, user: JSON.stringify({ slug, paragraphs }) }) as { references: RawReference[] };
  return validateRawReferences((out.references ?? []).map((r) => ({ ...r, citing_work_slug: slug })), realIds).kept;
}
```

> **Note for the implementer:** open `scripts/lib/openrouter-chat.ts` and use its actual exported JSON-chat function and signature; adjust the `chatJSON` import/call above to match. Keep the model behind that lib's existing default.

- [ ] **Step 4: Run to verify it passes**

Run: `cd scripts/graph && bun test ./extract-references.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/extract-references.ts scripts/graph/extract-references.test.ts
git commit -m "feat(graph): LLM reference extractor with paragraph-id grounding guard"
```

---

### Task 6: Orchestrator + pilot run

**Files:**
- Create: `scripts/graph/run.ts`

- [ ] **Step 1: Write the orchestrator**

```typescript
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildCorpusIndex, resolveReference } from "./resolve-references";
import { buildAcquisitionList } from "./acquisition-list";
import { buildCitationGraph, withBacklinks } from "./build-graph";
import { extractReferences } from "./extract-references";
import type { Manifest, RawReference } from "./types";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = join(ROOT, "corpus");
const OUT = join(CORPUS, "graph");

const PILOT = [
  "unknown-manusmrti-347b76", "unknown-yajnavalkya-smrti-cb88d6", "unknown-parasara-smrti-2259be",
  "charles-comte-traite-de-legislation-vol-iv-bca040", "thomas-clarkson-an-essay-on-the-slavery-and-comm-60b084",
  "paul-popenoe-and-roswell-applied-eugenics-d3c68e", "frederick-douglass-the-life-and-times-of-frederick--7be09c",
];

async function main() {
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : PILOT;
  const manifest = JSON.parse(await Bun.file(join(CORPUS, "manifest.json")).text()) as Manifest;
  const index = buildCorpusIndex(manifest);
  const labels = new Map(manifest.works.map((w) => [w.slug, w.title]));

  const raw: RawReference[] = [];
  for (const slug of slugs) {
    const chapterDirs = readdirSync(join(CORPUS, "works", slug, "chapters"));
    raw.push(...(await extractReferences(CORPUS, slug, chapterDirs)));
    console.log(`extracted ${raw.length} refs (through ${slug})`);
  }

  const resolved = raw.map((r) => resolveReference(r, index));
  const graph = withBacklinks(buildCitationGraph(resolved, labels));
  const acquisition = buildAcquisitionList(resolved);
  const stats = {
    works: slugs.length, references: resolved.length,
    in_corpus: resolved.filter((r) => r.status.startsWith("in_corpus")).length,
    absent: resolved.filter((r) => r.status === "absent").length,
    ambiguous: resolved.filter((r) => r.status === "ambiguous").length,
    nodes: graph.nodes.length, edges: graph.edges.length,
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "citation-graph.json"), JSON.stringify(graph, null, 2));
  writeFileSync(join(OUT, "acquisition-list.json"), JSON.stringify(acquisition, null, 2));
  writeFileSync(join(OUT, "stats.json"), JSON.stringify(stats, null, 2));
  console.log(stats);
}
main();
```

- [ ] **Step 2: Confirm `corpus/graph/` is git-ignored**

Run: `grep -n "corpus/graph" .gitignore || echo "ADD corpus/graph/ to .gitignore"`
If absent, add `corpus/graph/` to `.gitignore` (these are regenerable artifacts, like `search.db`).

- [ ] **Step 3: Run the pilot**

Run: `bun run scripts/graph/run.ts`
Expected: console prints `stats` with `references > 0`, a nonzero `in_corpus` (the Parāśara→Manu edge must appear), and `absent > 0` (Pearson, Peckard, Humboldt, etc.). Files written under `corpus/graph/`.

- [ ] **Step 4: Eyeball the grounded edge**

Run: `node -e "const g=require('./corpus/graph/citation-graph.json'); const e=g.edges.find(x=>x.to==='unknown-manusmrti-347b76'); console.log(JSON.stringify(e,null,2))"`
Expected: an edge from a smṛti to Manusmṛti, with at least one real `p-` citation and a verbatim quote.

- [ ] **Step 5: Commit**

```bash
git add scripts/graph/run.ts .gitignore
git commit -m "feat(graph): pilot orchestrator producing citation graph + acquisition list"
```

---

## Self-Review

**Spec coverage (against `2026-06-26-knowledge-graph-design.md`, the citation layer):**
- Reference edges with citing passage + stance → Tasks 1, 4, 5. ✓
- In-corpus resolution (work + author) → Task 2 (`in_corpus_work` / `in_corpus_author`). ✓
- Absent → acquisition list, ranked → Task 3. ✓
- Ambiguous via homonym discipline (Charles ≠ Auguste) → Task 2 (`ambiguous` + candidates, no silent pick). ✓
- Grounding (every citation a real paragraph) → Task 5 `validateRawReferences`. ✓
- Backlinks (who cites X) → Task 4 `withBacklinks`. ✓
- **Deferred to follow-on plans (noted, not gaps):** passage-level resolution of the *target* (matching "Manu declared X" to the exact Manu verse — a Phase-1a.2 enhancement using the target work's paragraphs); the site surfaces / fidelity view (Phase 1b); the framing, figure, and interpretation layers (later phases).

**Placeholder scan:** none — every step has runnable code or an exact command. The one external unknown (the `openrouter-chat` export name) is called out with an explicit instruction to confirm the signature, not left vague.

**Type consistency:** `RawReference`, `ResolvedReference`, `GraphNode/Edge`, `CitationGraph`, `AcquisitionEntry`, `Manifest` defined once in Task 1 and imported unchanged in Tasks 2–6. `status` values (`in_corpus_work|in_corpus_author|absent|ambiguous`) and `stance` values are used identically across resolver, graph builder, and orchestrator.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-26-citation-graph-pipeline.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks, fast iteration.
2. **Inline Execution** — tasks run in this session via executing-plans, batched with checkpoints.

Which approach?
