/**
 * The data layer. Reads data/*.json from disk, validates everything against
 * the schema once at module load, and exposes typed arrays, lookup maps and
 * join helpers. Used identically by the Astro build, the validator and the
 * MCP server, so there is exactly one definition of what the dataset means.
 *
 * Invalid data throws here, which fails the build. Deeper integrity rules
 * (referential integrity, stemma shape, chronology) live in scripts/validate.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  collections,
  type Language,
  type Person,
  type Place,
  type Source,
  type Transmission,
  type Work,
} from './schema.ts';

/**
 * Find the repository root by walking up until atlas/data/languages.json appears.
 * import.meta.url moves when the build bundles this module (dist/.prerender),
 * so a fixed relative path would break; the walk works from src/, from the
 * bundled output, and from mcp/ alike.
 */
function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'atlas', 'data', 'languages.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('naql: could not locate the data/ directory');
}

const root = findRoot();

/** Repository root, exported for modules that read other repo files (the book). */
export const repoRoot = root;

function load<T>(name: keyof typeof collections): T {
  const raw = JSON.parse(readFileSync(join(root, "atlas", "data", `${name}.json`), 'utf-8'));
  return collections[name].parse(raw) as T;
}

export const languages: Language[] = load('languages');
export const places: Place[] = load('places');
export const people: Person[] = load('people');
export const works: Work[] = load('works');
export const transmissions: Transmission[] = load('transmissions');
export const sources: Source[] = load('sources');

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

export const languageById = byId(languages);
export const placeById = byId(places);
export const personById = byId(people);
export const workById = byId(works);
export const transmissionById = byId(transmissions);
export const sourceById = byId(sources);

/** All transmissions of one work, oldest first. */
export function transmissionsOf(workId: string): Transmission[] {
  return transmissions
    .filter((t) => t.work === workId)
    .sort((a, b) => a.date.from - b.date.from);
}

/** The language a transmission translated out of: its parent's language. */
export function sourceLanguageOf(t: Transmission): Language {
  if (t.from === 'original') {
    const work = workById.get(t.work)!;
    return languageById.get(work.original.lang)!;
  }
  const parent = transmissionById.get(t.from)!;
  return languageById.get(parent.language)!;
}

export interface StemmaNode {
  transmission: Transmission;
  children: StemmaNode[];
}

/**
 * The stemma of a work: its transmissions arranged as a tree under the
 * original. Children are ordered by date so the tree reads chronologically.
 */
export function stemmaOf(workId: string): StemmaNode[] {
  const all = transmissionsOf(workId);
  const nodes = new Map<string, StemmaNode>(
    all.map((t) => [t.id, { transmission: t, children: [] }]),
  );
  const roots: StemmaNode[] = [];
  for (const t of all) {
    const node = nodes.get(t.id)!;
    if (t.from === 'original') {
      roots.push(node);
    } else {
      const parent = nodes.get(t.from);
      if (!parent) {
        // Fail loudly: in `astro dev` the validator has not run, and a typo in
        // `from` would otherwise silently drop the crossing from every surface.
        throw new Error(`stemmaOf(${workId}): ${t.id} has a missing or foreign parent "${t.from}"`);
      }
      parent.children.push(node);
    }
  }
  return roots;
}

/** Every transmission a person took part in, oldest first. */
export function transmissionsByPerson(personId: string): Transmission[] {
  return transmissions
    .filter((t) => t.people.some((p) => p.person === personId))
    .sort((a, b) => a.date.from - b.date.from);
}

/** Works a person wrote. */
export function worksByAuthor(personId: string): Work[] {
  return works.filter((w) => w.author === personId);
}

/** Every transmission made in a place, oldest first. */
export function transmissionsByPlace(placeId: string): Transmission[] {
  return transmissions
    .filter((t) => t.place === placeId)
    .sort((a, b) => a.date.from - b.date.from);
}

/** Crossings into and out of a language, oldest first. */
export function transmissionsByLanguage(langId: string): {
  into: Transmission[];
  outOf: Transmission[];
} {
  const into = transmissions
    .filter((t) => t.language === langId)
    .sort((a, b) => a.date.from - b.date.from);
  const outOf = transmissions
    .filter((t) => sourceLanguageOf(t).id === langId)
    .sort((a, b) => a.date.from - b.date.from);
  return { into, outOf };
}

/** Transmissions citing a given source. */
export function transmissionsBySource(sourceId: string): Transmission[] {
  return transmissions
    .filter((t) => t.evidence.some((e) => e.source === sourceId))
    .sort((a, b) => a.date.from - b.date.from);
}

export function stats() {
  const years = transmissions.flatMap((t) => [t.date.from, t.date.to ?? t.date.from]);
  const composed = works.flatMap((w) => [w.composed.from, w.composed.to ?? w.composed.from]);
  return {
    works: works.length,
    transmissions: transmissions.length,
    people: people.length,
    languages: languages.length,
    places: places.length,
    sources: sources.length,
    earliestComposed: Math.min(...composed),
    earliest: Math.min(...years),
    latest: Math.max(...years),
  };
}

/** Diacritic-folded, case-folded matching used by site search and the MCP server. */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[ʿʾ'’‘]/g, '')
    .toLowerCase();
}
