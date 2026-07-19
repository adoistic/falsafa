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

function tokens(s: string): string[] {
  return s.split("-").filter(Boolean);
}

function isContiguousSubseq(small: string[], big: string[]): boolean {
  if (small.length === 0 || small.length > big.length) return false;
  for (let i = 0; i + small.length <= big.length; i++) {
    let ok = true;
    for (let j = 0; j < small.length; j++) {
      if (big[i + j] !== small[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

export function contains(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const h = tokens(haystack);
  const n = tokens(needle);
  if (h.length === 0 || n.length === 0) return false;
  return isContiguousSubseq(n, h) || isContiguousSubseq(h, n);
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
