/**
 * Dataset integrity gate. Runs before every build and in CI.
 *
 * Schema validation happens in src/lib/data.ts at import time. This script
 * enforces the rules a schema cannot see:
 *
 *   - referential integrity across all six collections
 *   - the stemma is a true tree: parents exist, belong to the same work,
 *     and no transmission is its own ancestor
 *   - chronology: a transmission cannot precede the version it came from
 *   - every transmission cites at least one source that exists
 *   - orphans (defined but never referenced) are reported as warnings
 *
 * Errors exit 1. Warnings print and pass.
 */
import {
  languages,
  languageById,
  people,
  personById,
  places,
  placeById,
  sources,
  sourceById,
  sourceLanguageOf,
  transmissions,
  transmissionById,
  works,
  workById,
} from '../apps/site/src/lib/atlas/data.ts';

const errors: string[] = [];
const warnings: string[] = [];

function expect(ok: boolean, message: string) {
  if (!ok) errors.push(message);
}

// --- unique ids -------------------------------------------------------
for (const [name, rows] of Object.entries({ languages, places, people, works, transmissions, sources })) {
  const seen = new Set<string>();
  for (const row of rows as { id: string }[]) {
    expect(!seen.has(row.id), `${name}: duplicate id "${row.id}"`);
    seen.add(row.id);
  }
}

// --- works ------------------------------------------------------------
for (const w of works) {
  expect(
    languageById.has(w.original.lang),
    `work ${w.id}: original.lang "${w.original.lang}" is not a language`,
  );
  if (w.author !== null) {
    expect(personById.has(w.author), `work ${w.id}: author "${w.author}" is not a person`);
  } else {
    expect(
      w.attribution !== undefined,
      `work ${w.id}: anonymous works must say so via "attribution"`,
    );
  }
  if (w.composed.place) {
    expect(placeById.has(w.composed.place), `work ${w.id}: composed.place "${w.composed.place}" is not a place`);
  }
  for (const ref of w.sources) {
    expect(sourceById.has(ref.source), `work ${w.id}: cites unknown source "${ref.source}"`);
  }
}

// --- people -----------------------------------------------------------
for (const p of people) {
  if (p.original) {
    expect(languageById.has(p.original.lang), `person ${p.id}: original.lang "${p.original.lang}" is not a language`);
  }
  if (p.born !== undefined && p.died !== undefined) {
    expect(p.died >= p.born, `person ${p.id}: died before born`);
  }
  for (const ref of p.sources) {
    expect(sourceById.has(ref.source), `person ${p.id}: cites unknown source "${ref.source}"`);
  }
}

// --- transmissions ----------------------------------------------------
for (const t of transmissions) {
  const work = workById.get(t.work);
  expect(work !== undefined, `transmission ${t.id}: work "${t.work}" does not exist`);
  expect(languageById.has(t.language), `transmission ${t.id}: language "${t.language}" is not a language`);
  if (t.place) {
    expect(placeById.has(t.place), `transmission ${t.id}: place "${t.place}" is not a place`);
  }
  for (const { person, role } of t.people) {
    const p = personById.get(person);
    expect(p !== undefined, `transmission ${t.id}: person "${person}" does not exist`);
    if (p) {
      expect(
        p.roles.includes(role),
        `transmission ${t.id}: ${person} acts as "${role}" but does not declare that role`,
      );
      if (p.died !== undefined) {
        expect(
          t.date.from <= p.died + 1,
          `transmission ${t.id}: dated after ${person} died (${p.died})`,
        );
      }
    }
  }
  for (const ref of t.evidence) {
    expect(sourceById.has(ref.source), `transmission ${t.id}: cites unknown source "${ref.source}"`);
  }

  if (t.from !== 'original') {
    const parent = transmissionById.get(t.from);
    expect(parent !== undefined, `transmission ${t.id}: parent "${t.from}" does not exist`);
    if (parent) {
      expect(
        parent.work === t.work,
        `transmission ${t.id}: parent "${t.from}" belongs to a different work`,
      );
      expect(
        t.date.from >= parent.date.from,
        `transmission ${t.id}: dated before its parent "${t.from}"`,
      );
    }
  } else if (work) {
    expect(
      t.date.from >= work.composed.from,
      `transmission ${t.id}: dated before the work was composed`,
    );
  }

  // A translation must change language; staying in-language is a revision,
  // commentary or edition.
  if (t.kind === 'translation' && (t.from === 'original' || transmissionById.has(t.from))) {
    expect(
      sourceLanguageOf(t).id !== t.language,
      `transmission ${t.id}: a "translation" into its own source language`,
    );
  }
}

// --- stemma is acyclic -------------------------------------------------
for (const t of transmissions) {
  const seen = new Set<string>([t.id]);
  let cursor = t.from;
  while (cursor !== 'original') {
    if (seen.has(cursor)) {
      errors.push(`transmission ${t.id}: cycle in stemma via "${cursor}"`);
      break;
    }
    seen.add(cursor);
    const parent = transmissionById.get(cursor);
    if (!parent) break;
    cursor = parent.from;
  }
}

// --- orphans ------------------------------------------------------------
const referencedPeople = new Set<string>();
for (const w of works) if (w.author) referencedPeople.add(w.author);
for (const t of transmissions) for (const { person } of t.people) referencedPeople.add(person);
for (const p of people) {
  if (!referencedPeople.has(p.id)) warnings.push(`person ${p.id} is never referenced`);
}

const referencedPlaces = new Set<string>();
for (const w of works) if (w.composed.place) referencedPlaces.add(w.composed.place);
for (const t of transmissions) if (t.place) referencedPlaces.add(t.place);
for (const p of places) {
  if (!referencedPlaces.has(p.id)) warnings.push(`place ${p.id} is never referenced`);
}

const citedSources = new Set<string>();
for (const w of works) for (const ref of w.sources) citedSources.add(ref.source);
for (const p of people) for (const ref of p.sources) citedSources.add(ref.source);
for (const t of transmissions) for (const ref of t.evidence) citedSources.add(ref.source);
for (const s of sources) {
  if (!citedSources.has(s.id)) warnings.push(`source ${s.id} is never cited`);
}

const usedLanguages = new Set<string>();
for (const w of works) usedLanguages.add(w.original.lang);
for (const t of transmissions) usedLanguages.add(t.language);
for (const p of people) if (p.original) usedLanguages.add(p.original.lang);
for (const l of languages) {
  if (!usedLanguages.has(l.id)) warnings.push(`language ${l.id} is never used`);
}

// --- report -------------------------------------------------------------
for (const w of warnings) console.warn(`warn  ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(
  `dataset valid: ${works.length} works, ${transmissions.length} transmissions, ` +
    `${people.length} people, ${languages.length} languages, ${places.length} places, ` +
    `${sources.length} sources. ${warnings.length} warning(s).`,
);
