/**
 * entities-run.ts
 *
 * Per-work entity extraction (7 categories) + corpus aggregation.
 *
 * Cache layout: corpus/graph/entities/v1/<slug>.json  (EntityRaw[])
 * Index output:  corpus/graph/entity-index.json        (EntityNode[])
 *
 * Usage:
 *   bun run scripts/graph/entities-run.ts                         # run all uncached works
 *   bun run scripts/graph/entities-run.ts <slug> [<slug> ...]     # run specific works
 *   bun run scripts/graph/entities-run.ts --next [N]              # next N uncached (default 10)
 *   bun run scripts/graph/entities-run.ts --aggregate-only        # skip extraction, rebuild index
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chat } from "../lib/openrouter-chat";
import { mergeEntities } from "./entities";
import { chunkByCharBudget, mapWithConcurrency } from "./extract-references";
import type { EntityRaw, Manifest } from "./types";

const ROOT    = resolve(import.meta.dir, "..", "..");
const CORPUS  = join(ROOT, "corpus");
const ENT_DIR = join(CORPUS, "graph", "entities", "v1");
const OUT     = join(CORPUS, "graph");

export const ENTITY_EXTRACT_VERSION = "v1";
export const ENTITY_MAX_WINDOW_CHARS = 40000;  // same budget as reference extractor
export const ENTITY_CONCURRENCY      = 4;

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

export const ENTITY_EXTRACTION_PROMPT = `You are an entity extractor for a philosophy/classics corpus.
Read the provided paragraphs from one work and extract ALL named entities under EXACTLY these 7 categories:

CATEGORY RULES (read carefully before labelling):
1. figure — persons, deities, heroes, AND theriomorphic beings that possess personhood, divine agency, or worshipped identity.
   Examples: Rāma, Sītā, Hanumān, Garuḍa, Jaṭāyu, nāga-kings, Vāsuki, Zeus, Achilles, Manu, Bhṛgu.
   KEY RULE: test = personhood/agency/divinity, NOT body-shape. Hanumān is a figure even though he is a monkey.
   Garuḍa is a figure. The vānaras (monkey-army) as a collective clan are a GROUP, but individual named vānaras with divine agency are figures.

2. animal — creatures used AS creatures, as symbols, as ritual objects, or in generic zoological mention.
   Examples: the sacrificial horse (Aśvamedha horse qua animal), the cow as wealth-symbol, generic birds/serpents not worshipped.
   KEY RULE: NEVER classify a theriomorphic being that receives worship, has personal agency, or is named as an individual deity/hero here.
   "The serpents" as a class = animal. Vāsuki the nāga-king = figure.

3. place — cities, kingdoms, regions, rivers, mountains, forests, sacred sites, cosmic worlds, and the *idea* of place (home, homeland, exile).
   Examples: Ayodhyā, Laṅkā, Gaṅgā, Himalaya, Daṇḍaka forest, Svarga, the sea.

4. group — clans, peoples, castes, dynasties, sects, collectivities.
   Examples: Kurus, Pāṇḍavas, Ikṣvākus, Vānaras (the monkey-army as a collective), Āryas, varṇas (brāhmaṇa/kṣatriya/etc.).

5. idea — abstract concepts, values, cosmic principles.
   Examples: dharma, ṛta, karma, mokṣa, kāla (time/fate), daṇḍa (punishment/rod), liberty, virtue, justice, fate.

6. object — specific named artefacts, weapons, implements, substances, mantras.
   Examples: Gāṇḍīva (Arjuna's bow), Vajra (Indra's weapon), Soma (the ritual drink), Gāyatrī (mantra), the Pāśupatastra.

7. event — named occurrences, battles, rituals, cosmic episodes.
   Examples: the Vṛtra-slaying, churning of the ocean (Samudra-manthana), Aśvamedha sacrifice, the exile of Rāma, the War of Laṅkā.

GROUNDING RULES (mandatory):
- Only use paragraph_ids that appear literally in the provided paragraphs list (p-xxxxxx format).
- quote must be a verbatim snippet from that paragraph's text.
- role: one short phrase describing how this entity appears in that paragraph.

FOR EACH ENTITY return:
  canonical_name: the standard/most-common English transliteration or name
  surface_names: every variant spelling/alias seen in this text (include canonical_name)
  kind: one of figure|animal|place|group|idea|object|event
  figure_kind: (only when kind="figure") one of deity|mythological|historical
  mentions: array of {paragraph_id, quote, role} — minimum 1, grounded in real p-ids
  description: one sentence describing how this entity is portrayed in the work
  founding_texts: (only when kind="figure") list of other canonical works that define/originate this figure

Return JSON: { "entities": [...] }`;

// ---------------------------------------------------------------------------
// JSON schema for structured output
// ---------------------------------------------------------------------------

const ENTITY_SCHEMA = {
  name: "extract_entities",
  strict: true,
  schema: {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            canonical_name:  { type: "string" },
            surface_names:   { type: "array", items: { type: "string" } },
            kind:            { type: "string", enum: ["figure", "animal", "place", "group", "idea", "object", "event"] },
            figure_kind:     { type: "string", enum: ["deity", "mythological", "historical", ""] },
            mentions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  paragraph_id: { type: "string" },
                  quote:        { type: "string" },
                  role:         { type: "string" },
                },
                required: ["paragraph_id", "quote", "role"],
                additionalProperties: false,
              },
            },
            description:     { type: "string" },
            founding_texts:  { type: "array", items: { type: "string" } },
          },
          required: ["canonical_name", "surface_names", "kind", "figure_kind", "mentions", "description", "founding_texts"],
          additionalProperties: false,
        },
      },
    },
    required: ["entities"],
    additionalProperties: false,
  },
} as const;

// ---------------------------------------------------------------------------
// Paragraph helpers (reuse extract-references pattern)
// ---------------------------------------------------------------------------

function paragraphIdsFor(slug: string, chapterDirs: string[]): Set<string> {
  const ids = new Set<string>();
  for (const dir of chapterDirs) {
    const file = join(CORPUS, "works", slug, "chapters", dir, "translation.paragraphs.json");
    for (const p of JSON.parse(readFileSync(file, "utf-8")) as { id: string }[]) ids.add(p.id);
  }
  return ids;
}

function loadParagraphs(slug: string, chapterDirs: string[]): { id: string; text: string }[] {
  return chapterDirs.flatMap((dir) => {
    const file = join(CORPUS, "works", slug, "chapters", dir, "translation.paragraphs.json");
    return JSON.parse(readFileSync(file, "utf-8")) as { id: string; text: string }[];
  });
}

// ---------------------------------------------------------------------------
// Validation: drop any entity whose mentions reference non-existent paragraph ids
// ---------------------------------------------------------------------------

export function validateEntities(
  raws: EntityRaw[],
  realParagraphIds: Set<string>,
): { kept: EntityRaw[]; dropped: EntityRaw[] } {
  const kept: EntityRaw[] = [];
  const dropped: EntityRaw[] = [];
  for (const r of raws) {
    const validMentions = r.mentions.filter((m) => realParagraphIds.has(m.paragraph_id));
    if (validMentions.length === 0) {
      dropped.push(r);
    } else {
      kept.push({ ...r, mentions: validMentions });
    }
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// LLM extraction for one window of paragraphs
// ---------------------------------------------------------------------------

interface RawEntityResponse {
  canonical_name: string;
  surface_names: string[];
  kind: string;
  figure_kind: string;
  mentions: { paragraph_id: string; quote: string; role: string }[];
  description: string;
  founding_texts: string[];
}

function coerceEntityRaw(e: RawEntityResponse, slug: string): EntityRaw {
  const kind = e.kind as EntityRaw["kind"];
  const result: EntityRaw = {
    work_slug: slug,
    canonical_name: e.canonical_name,
    surface_names: e.surface_names.length ? e.surface_names : [e.canonical_name],
    kind,
    mentions: e.mentions,
    description: e.description,
  };
  if (kind === "figure" && e.figure_kind && e.figure_kind !== "") {
    // exactOptionalPropertyTypes: only assign when value is definitely non-undefined
    (result as { figure_kind?: EntityRaw["figure_kind"] }).figure_kind =
      e.figure_kind as NonNullable<EntityRaw["figure_kind"]>;
  }
  if (kind === "figure" && e.founding_texts?.length) {
    result.founding_texts = e.founding_texts;
  }
  return result;
}

async function extractEntitiesFromWork(slug: string, chapterDirs: string[]): Promise<EntityRaw[]> {
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
  const model  = process.env["OPENROUTER_MODEL"] ?? "anthropic/claude-sonnet-4-6";

  const realIds   = paragraphIdsFor(slug, chapterDirs);
  const allParas  = loadParagraphs(slug, chapterDirs);
  const windows   = chunkByCharBudget(allParas, ENTITY_MAX_WINDOW_CHARS);

  const perWindow = await mapWithConcurrency(windows, ENTITY_CONCURRENCY, async (paragraphs) => {
    const result = await chat<{ entities: RawEntityResponse[] }>({
      apiKey,
      model,
      messages: [
        { role: "system", content: ENTITY_EXTRACTION_PROMPT },
        { role: "user",   content: JSON.stringify({ slug, paragraphs }) },
      ],
      json_schema: ENTITY_SCHEMA,
      temperature: 0,
    });
    return (result.parsed?.entities ?? []).map((e) => coerceEntityRaw(e, slug));
  });

  const accumulated = perWindow.flat();
  return validateEntities(accumulated, realIds).kept;
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function cachePath(slug: string): string {
  return join(ENT_DIR, `${slug}.json`);
}

function isCached(slug: string): boolean {
  return existsSync(cachePath(slug));
}

async function getEntities(slug: string, chapterDirs: string[]): Promise<EntityRaw[]> {
  const cp = cachePath(slug);
  if (existsSync(cp)) {
    return JSON.parse(readFileSync(cp, "utf-8")) as EntityRaw[];
  }
  const entities = await extractEntitiesFromWork(slug, chapterDirs);
  mkdirSync(dirname(cp), { recursive: true });
  writeFileSync(cp, JSON.stringify(entities, null, 2));
  return entities;
}

// ---------------------------------------------------------------------------
// Aggregation: load all cached entity files → merge → write index
// ---------------------------------------------------------------------------

function loadAllCached(): EntityRaw[] {
  if (!existsSync(ENT_DIR)) return [];
  const all: EntityRaw[] = [];
  for (const f of readdirSync(ENT_DIR)) {
    if (!f.endsWith(".json")) continue;
    const arr = JSON.parse(readFileSync(join(ENT_DIR, f), "utf-8")) as EntityRaw[];
    all.push(...arr);
  }
  return all;
}

function buildIndex(): void {
  const raws  = loadAllCached();
  const nodes = mergeEntities(raws);

  const kindCounts: Record<string, number> = {};
  for (const n of nodes) kindCounts[n.kind] = (kindCounts[n.kind] ?? 0) + 1;

  const stats = {
    entity_files:    existsSync(ENT_DIR) ? readdirSync(ENT_DIR).filter((f) => f.endsWith(".json")).length : 0,
    raw_entities:    raws.length,
    distinct_entities: nodes.length,
    cross_work:      nodes.filter((n) => n.work_count >= 2).length,
    by_kind:         kindCounts,
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "entity-index.json"), JSON.stringify({ stats, entities: nodes }, null, 2));
  console.log("entity-index.json written:", stats);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);

  // --aggregate-only: skip extraction, just rebuild the index from cache
  if (argv[0] === "--aggregate-only") {
    buildIndex();
    return;
  }

  const manifest = JSON.parse(await Bun.file(join(CORPUS, "manifest.json")).text()) as Manifest;

  let batchSlugs: string[];

  if (argv[0] === "--next") {
    const n = argv[1] !== undefined ? parseInt(argv[1], 10) : 10;
    batchSlugs = manifest.works
      .map((w) => w.slug)
      .filter((s) => !isCached(s))
      .slice(0, n);
    console.log(`--next ${n}: selected ${batchSlugs.length} uncached slugs`);
  } else if (argv.length > 0) {
    batchSlugs = argv;
  } else {
    // default: all uncached
    batchSlugs = manifest.works.map((w) => w.slug).filter((s) => !isCached(s));
    console.log(`Running all ${batchSlugs.length} uncached works`);
  }

  for (const slug of batchSlugs) {
    const chapterDirs = readdirSync(join(CORPUS, "works", slug, "chapters"));
    const entities = await getEntities(slug, chapterDirs);
    console.log(`cached ${slug}: ${entities.length} entities`);
  }

  buildIndex();
}

main();
