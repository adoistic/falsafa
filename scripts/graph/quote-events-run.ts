import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { quoteEventsFromOntology } from "./ontology";
import type { OntologyQuoteEvent, OntologyWork } from "./types";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = join(ROOT, "corpus");
const ONT_DIR = join(CORPUS, "graph", "ontology", "v1");
const OUT = join(CORPUS, "graph");

interface LooseOntologyWork extends Partial<OntologyWork> {
  slug?: string;
  window?: string;
}

interface IndexedQuoteEvent extends OntologyQuoteEvent {
  id: string;
  work_slug: string;
  window: string;
}

function loadOntologyWorks(): OntologyWork[] {
  if (!existsSync(ONT_DIR)) return [];
  const works: OntologyWork[] = [];
  for (const file of readdirSync(ONT_DIR).sort()) {
    if (!file.endsWith(".json")) continue;
    const raw = JSON.parse(readFileSync(join(ONT_DIR, file), "utf-8")) as LooseOntologyWork;
    const work_slug = raw.work_slug ?? raw.slug ?? file.replace(/\.json$/, "");
    works.push({
      work_slug,
      extracted_at: raw.extracted_at ?? "",
      ontology_version: raw.ontology_version ?? "v1",
      window_chapters: raw.window_chapters ?? (raw.window ? [raw.window] : []),
      entities: raw.entities ?? [],
      themes: raw.themes ?? [],
      citations: raw.citations ?? [],
      quote_events: raw.quote_events,
    });
  }
  return works;
}

function indexQuoteEvents(works: OntologyWork[]): IndexedQuoteEvent[] {
  const events: IndexedQuoteEvent[] = [];
  for (const work of works) {
    quoteEventsFromOntology(work).forEach((event, i) => {
      events.push({
        ...event,
        id: `${work.work_slug}:${event.paragraph_id}:${i}`,
        work_slug: work.work_slug,
        window: work.window_chapters.join(","),
      });
    });
  }
  return events;
}

function main() {
  const works = loadOntologyWorks();
  const events = indexQuoteEvents(works);
  const byKind = Object.fromEntries(
    ["direct_quote", "reported_speech", "citation_quote"].map((kind) => [
      kind,
      events.filter((e) => e.kind === kind).length,
    ]),
  );
  const bySource = Object.fromEntries(
    ["citation", "entity_mention", "manual"].map((source) => [
      source,
      events.filter((e) => e.source === source).length,
    ]),
  );

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "quote-events.json"),
    JSON.stringify({
      stats: {
        ontology_files: works.length,
        quote_events: events.length,
        by_kind: byKind,
        by_source: bySource,
      },
      events,
    }, null, 2),
  );

  console.log({
    ontology_files: works.length,
    quote_events: events.length,
    by_kind: byKind,
    by_source: bySource,
  });
}

main();
