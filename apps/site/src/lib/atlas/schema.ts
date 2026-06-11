/**
 * The Naql ontology.
 *
 * Six collections: languages, places, people, works, transmissions, sources.
 * A work is a text. A transmission is one crossing of that text into a
 * language: a translation, revision, adaptation, commentary or edition.
 * Transmissions form a tree per work (the stemma) via `from`, which points
 * either at "original" or at the parent transmission's id.
 *
 * Every transmission must cite at least one source and carry a confidence
 * grade. That rule is the whole point of the project; the validator and the
 * schema both enforce it.
 *
 * Years are signed integers. Negative means BCE: -300 is 300 BCE.
 */
import { z } from 'zod';

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slug = z.string().regex(SLUG, 'ids are kebab-case');
const year = z
  .number()
  .int()
  .min(-1000)
  .max(2000)
  .refine((y) => y !== 0, 'there is no year 0');

export const yearSpan = z
  .object({
    from: year,
    to: year.optional(),
    ca: z.boolean().optional(),
  })
  .refine((d) => d.to === undefined || d.to >= d.from, {
    message: 'date.to must not precede date.from',
  });

export const languageSchema = z.object({
  id: slug,
  name: z.string().min(1),
  endonym: z.string().optional(),
  script: z.enum(['greek', 'latin', 'arabic', 'syriac', 'devanagari', 'hebrew', 'pahlavi']),
  dir: z.enum(['ltr', 'rtl']),
  bcp47: z.string().min(2),
  hue: z.string().regex(/^#[0-9a-f]{6}$/),
  note: z.string().min(1),
});

export const placeSchema = z.object({
  id: slug,
  name: z.string().min(1),
  modern: z.string().optional(),
  region: z.string().optional(),
  note: z.string().min(1),
});

export const roleEnum = z.enum([
  'author',
  'translator',
  'reviser',
  'patron',
  'commissioner',
  'commentator',
  'editor',
  'scholar',
]);

const sourceRef = z.object({
  source: slug,
  detail: z.string().optional(),
});

export const personSchema = z.object({
  id: slug,
  name: z.string().min(1),
  original: z.object({ text: z.string().min(1), lang: slug }).optional(),
  aka: z.array(z.string().min(1)).min(1).optional(),
  born: year.optional(),
  died: year.optional(),
  ca: z.boolean().optional(),
  fl: z.string().optional(),
  roles: z.array(roleEnum).min(1),
  note: z.string().min(1),
  sources: z.array(sourceRef).min(1),
});

export const fieldEnum = z.enum([
  'philosophy',
  'logic',
  'medicine',
  'pharmacology',
  'mathematics',
  'astronomy',
  'fables',
]);

const title = z
  .object({
    text: z.string().optional(),
    translit: z.string().optional(),
  })
  .refine((t) => t.text !== undefined || t.translit !== undefined, {
    message: 'a title needs text in the original script, a transliteration, or both',
  });

export const workSchema = z.object({
  id: slug,
  title: z.string().min(1),
  original: title.and(z.object({ lang: slug })),
  author: slug.nullable(),
  attribution: z.enum(['traditional', 'anonymous', 'misattributed']).optional(),
  composed: yearSpan.and(z.object({ place: slug.optional() })),
  field: fieldEnum,
  summary: z.string().min(1),
  detail: z.string().min(1),
  sources: z.array(sourceRef).min(1),
});

export const transmissionSchema = z.object({
  id: slug,
  work: slug,
  from: z.union([z.literal('original'), slug]),
  language: slug,
  title: title.optional(),
  kind: z.enum(['translation', 'revision', 'adaptation', 'commentary', 'edition']),
  people: z
    .array(
      z.object({
        person: slug,
        role: roleEnum,
      }),
    )
    .min(1),
  place: slug.optional(),
  date: yearSpan,
  note: z.string().min(1),
  confidence: z.enum(['attested', 'probable', 'disputed']),
  evidence: z.array(sourceRef).min(1),
});

export const sourceSchema = z.object({
  id: slug,
  kind: z.enum(['book', 'article', 'reference', 'primary']),
  author: z.string().min(1),
  title: z.string().min(1),
  year: z.number().int(),
  publisher: z.string().optional(),
  url: z.url().optional(),
  note: z.string().optional(),
});

export type Language = z.infer<typeof languageSchema>;
export type Place = z.infer<typeof placeSchema>;
export type Person = z.infer<typeof personSchema>;
export type Work = z.infer<typeof workSchema>;
export type Transmission = z.infer<typeof transmissionSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type YearSpan = z.infer<typeof yearSpan>;
export type Confidence = Transmission['confidence'];

export const collections = {
  languages: z.array(languageSchema),
  places: z.array(placeSchema),
  people: z.array(personSchema),
  works: z.array(workSchema),
  transmissions: z.array(transmissionSchema),
  sources: z.array(sourceSchema),
} as const;
