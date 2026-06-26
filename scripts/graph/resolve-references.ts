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
