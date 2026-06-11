/**
 * Markdown renderings of entities, used by the .md sibling endpoints,
 * /llms-full.txt and the MCP server. One narration of a chain, everywhere.
 */
import {
  languageById,
  personById,
  placeById,
  sourceById,
  stemmaOf,
  sourceLanguageOf,
  transmissionsByPerson,
  transmissionsByPlace,
  transmissionsOf,
  workById,
  worksByAuthor,
  type StemmaNode,
} from './data.ts';
import { attributionLabel, formatSpan, lifeDates } from './format.ts';
import type { Person, Place, Transmission, Work } from './schema.ts';
import { works as allWorks } from './data.ts';

function cite(evidence: { source: string; detail?: string | undefined }[]): string {
  return evidence
    .map(({ source, detail }) => {
      const s = sourceById.get(source)!;
      const name = `${s.author.split(',')[0]} ${s.year}`;
      return detail ? `${name} (${detail})` : name;
    })
    .join('; ');
}

function transmissionLine(t: Transmission, depth: number): string {
  const indent = '  '.repeat(depth);
  const from = sourceLanguageOf(t);
  const to = languageById.get(t.language)!;
  const who = t.people
    .map(({ person, role }) => `${personById.get(person)!.name} (${role})`)
    .join(', ');
  const where = t.place ? `, ${placeById.get(t.place)!.name}` : '';
  const title = t.title ? ` as "${t.title.text ?? t.title.translit}"` : '';
  return [
    `${indent}- **${formatSpan(t.date)}** ${from.name} -> ${to.name}, ${t.kind}${title} [${t.confidence}]`,
    `${indent}  ${who}${where}`,
    `${indent}  ${t.note}`,
    `${indent}  Evidence: ${cite(t.evidence)}`,
  ].join('\n');
}

function renderStemma(nodes: StemmaNode[], depth = 0): string {
  return nodes
    .map((node) =>
      [transmissionLine(node.transmission, depth), renderStemma(node.children, depth + 1)]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
}

export function workToMarkdown(work: Work): string {
  const author = work.author ? personById.get(work.author) : undefined;
  const original = languageById.get(work.original.lang)!;
  const composedAt = work.composed.place ? placeById.get(work.composed.place)!.name : undefined;
  const authorLine = author
    ? author.name
    : (attributionLabel[work.attribution ?? ''] ?? 'unknown');
  const stemma = renderStemma(stemmaOf(work.id));
  const lines = [
    `# ${work.title}`,
    '',
    `- id: ${work.id}`,
    `- original title: ${[work.original.text, work.original.translit].filter(Boolean).join(' / ')}`,
    `- author: ${authorLine}`,
    `- language: ${original.name}`,
    `- composed: ${formatSpan(work.composed)}${composedAt ? `, ${composedAt}` : ''}`,
    `- field: ${work.field}`,
    '',
    work.summary,
    '',
    `## The chain`,
    '',
    stemma || 'No recorded crossings yet.',
    '',
    `## Worth knowing`,
    '',
    work.detail,
    '',
    `## Sources`,
    '',
    ...work.sources.map((ref) => {
      const s = sourceById.get(ref.source)!;
      return `- ${s.author} (${s.year}). ${s.title}.${s.publisher ? ` ${s.publisher}.` : ''}`;
    }),
    '',
    `Confidence grades: attested (named in the medieval record or settled in scholarship), probable (standard view with real uncertainty), disputed (scholars disagree).`,
  ];
  return lines.join('\n');
}

export function personToMarkdown(person: Person): string {
  const wrote = worksByAuthor(person.id);
  const carried = transmissionsByPerson(person.id);
  const lines = [
    `# ${person.name}`,
    '',
    `- id: ${person.id}`,
    ...(person.original ? [`- name in original script: ${person.original.text}`] : []),
    ...(person.aka?.length ? [`- also known as: ${person.aka.join(', ')}`] : []),
    `- dates: ${lifeDates(person.born, person.died, person.ca, person.fl) || 'unknown'}`,
    `- roles: ${person.roles.join(', ')}`,
    '',
    person.note,
    '',
  ];
  if (wrote.length > 0) {
    lines.push('## Works in the atlas', '');
    for (const w of wrote) lines.push(`- ${w.title} (${w.id})`);
    lines.push('');
  }
  if (carried.length > 0) {
    lines.push('## Crossings', '');
    for (const t of carried) {
      const work = workById.get(t.work)!;
      const role = t.people.find((p) => p.person === person.id)!.role;
      lines.push(
        `- ${formatSpan(t.date)}: ${work.title} into ${languageById.get(t.language)!.name} (${role}) [${t.confidence}]`,
      );
    }
    lines.push('');
  }
  lines.push(
    '## Sources',
    '',
    ...person.sources.map((ref) => {
      const s = sourceById.get(ref.source)!;
      return `- ${s.author} (${s.year}). ${s.title}.`;
    }),
  );
  return lines.join('\n');
}

export function placeToMarkdown(place: Place): string {
  const crossings = transmissionsByPlace(place.id);
  const composedHere = allWorks.filter((w) => w.composed.place === place.id);
  const lines = [
    `# ${place.name}`,
    '',
    `- id: ${place.id}`,
    ...(place.modern ? [`- modern: ${place.modern}`] : []),
    ...(place.region ? [`- region: ${place.region}`] : []),
    '',
    place.note,
    '',
  ];
  if (composedHere.length > 0) {
    lines.push('## Composed here', '');
    for (const w of composedHere) {
      lines.push(`- ${formatSpan(w.composed)}: ${w.title} (${w.id})`);
    }
    lines.push('');
  }
  if (crossings.length > 0) {
    lines.push('## Crossings made here', '');
    for (const t of crossings) {
      const work = workById.get(t.work)!;
      lines.push(
        `- ${formatSpan(t.date)}: ${work.title} into ${languageById.get(t.language)!.name} (${t.kind}) [${t.confidence}]`,
      );
    }
  }
  return lines.join('\n');
}

export function transmissionsCount(workId: string): number {
  return transmissionsOf(workId).length;
}
