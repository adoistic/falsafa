/**
 * The book: Carried Across, how ideas travel.
 *
 * The manuscript lives in book/manuscript/ as markdown, one file per chapter.
 * This module is the manifest and loader; the site renders chapters at
 * /book/<slug>/ and the print edition at /book/print/. The appendices of the
 * print edition are generated from the dataset, so the book can never drift
 * from the atlas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './data.ts';

export interface Chapter {
  number: number;
  slug: string;
  title: string;
  file: string;
}

export const bookMeta = {
  title: 'Carried Across',
  subtitle: 'How ideas travel',
  author: 'Adnan Abbasi',
  series: 'A Naql book',
} as const;

export const chapters: Chapter[] = [
  { number: 0, slug: 'preface', title: 'Preface', file: '00-preface.md' },
  {
    number: 1,
    slug: 'the-herb-that-raises-the-dead',
    title: 'The herb that raises the dead',
    file: '01-the-herb-that-raises-the-dead.md',
  },
  { number: 2, slug: 'a-book-is-a-body', title: 'A book is a body', file: '02-a-book-is-a-body.md' },
  {
    number: 3,
    slug: 'the-men-in-the-middle',
    title: 'The men in the middle',
    file: '03-the-men-in-the-middle.md',
  },
  { number: 4, slug: 'who-pays', title: 'Who pays', file: '04-who-pays.md' },
  {
    number: 5,
    slug: 'for-love-of-the-almagest',
    title: 'For love of the Almagest',
    file: '05-for-love-of-the-almagest.md',
  },
  { number: 6, slug: 'traveling-badly', title: 'Traveling badly', file: '06-traveling-badly.md' },
  {
    number: 7,
    slug: 'nobody-planned-this',
    title: 'Nobody planned this',
    file: '07-nobody-planned-this.md',
  },
  {
    number: 8,
    slug: 'the-chains-become-rails',
    title: 'The chains become rails',
    file: '08-the-chains-become-rails.md',
  },
  { number: 9, slug: 'the-new-carriers', title: 'The new carriers', file: '09-the-new-carriers.md' },
  {
    number: 10,
    slug: 'carried-by-mention',
    title: 'Carried by mention',
    file: '10-carried-by-mention.md',
  },
  {
    number: 11,
    slug: 'the-fascination-clause',
    title: 'The fascination clause',
    file: '11-the-fascination-clause.md',
  },
  {
    number: 12,
    slug: 'afterword-why-falsafa',
    title: 'Afterword: why Falsafa',
    file: '12-afterword-why-falsafa.md',
  },
];

export function chapterMarkdown(chapter: Chapter): string {
  return readFileSync(join(repoRoot, 'book', 'manuscript', chapter.file), 'utf-8');
}

export function chapterLabel(chapter: Chapter): string {
  if (chapter.number === 0) return 'Preface';
  if (chapter.slug === 'afterword-why-falsafa') return 'Afterword';
  return `Chapter ${chapter.number}`;
}
