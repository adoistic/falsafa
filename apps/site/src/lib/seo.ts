/**
 * SEO / structured-data helpers.
 *
 * Language codes: BCP-47, chosen for what the text actually is — corpus
 * "Greek" is ancient Greek (grc), "old_english" is ang. Transliterations
 * are the same language in Latin script (-Latn subtag).
 */

const LANG_CODES: Record<string, string> = {
  english: "en",
  french: "fr",
  german: "de",
  greek: "grc",
  kawi: "kaw",
  latin: "la",
  sanskrit: "sa",
  urdu: "ur",
  old_english: "ang",
};

export function langCode(language: string | undefined): string {
  return LANG_CODES[(language ?? "").toLowerCase()] ?? "en";
}

/** BCP-47 for a chapter variant: translations are English; originals carry
 *  the work's language; transliterations are that language romanized. */
export function variantLang(contentType: string, workLanguage: string): string {
  if (contentType === "translation") return "en";
  const base = langCode(workLanguage);
  if (contentType === "transliteration") {
    return base === "en" ? "en" : `${base}-Latn`;
  }
  return base;
}

/** ISO-8601 duration from milliseconds ("PT1H23M45S"). */
export function isoDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${sec || (!h && !m) ? `${sec}S` : ""}`;
}

const SITE = "https://falsafa.ai";

export function websiteLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Falsafa",
    alternateName: "Falsafa — a living library of philosophy and classics",
    url: `${SITE}/`,
    description:
      "A digital library of philosophy and classics: two thousand works across nine languages, from the Rigveda to Russell, carried into English — readable, listenable, and machine-readable.",
    publisher: organizationLd(),
  };
}

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Thothica",
    url: "https://thothica.com",
  };
}

export interface WorkLdInput {
  slug: string;
  title: string;
  author: string;
  authorSlug: string;
  language: string;
  description?: string;
  publishedYear?: number | null;
  chapters?: number;
}

export function bookLd(w: WorkLdInput) {
  const book: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Book",
    "@id": `${SITE}/works/${w.slug}/#book`,
    name: w.title,
    url: `${SITE}/works/${w.slug}/`,
    inLanguage: langCode(w.language),
    author: {
      "@type": "Person",
      name: w.author,
      url: `${SITE}/authors/${w.authorSlug}/`,
    },
    image: `${SITE}/og/works/${w.slug}.png`,
    isAccessibleForFree: true,
  };
  if (w.description) book.description = w.description;
  if (w.publishedYear) book.datePublished = String(w.publishedYear);
  if (w.chapters) book.numberOfPages = undefined; // not a paged medium
  return book;
}

export interface ChapterLdInput {
  work: WorkLdInput;
  chapterSlug: string;
  chapterTitle: string;
  chapterNumber: number;
  variant: string;
  pageLang: string;
  audio?: { durMs: number } | null;
}

export function chapterLd(c: ChapterLdInput) {
  const url = `${SITE}/works/${c.work.slug}/${c.chapterSlug}/${c.variant}/`;
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Chapter",
    name: c.chapterTitle,
    url,
    position: c.chapterNumber,
    inLanguage: c.pageLang,
    isAccessibleForFree: true,
    isPartOf: bookLd(c.work),
  };
  if (c.audio) {
    ld.associatedMedia = {
      "@type": "AudioObject",
      name: `${c.chapterTitle} — ${c.work.title} (audio)`,
      duration: isoDuration(c.audio.durMs),
      encodingFormat: "application/vnd.apple.mpegurl",
      inLanguage: "en",
      isAccessibleForFree: true,
    };
  }
  return ld;
}

export function breadcrumbsLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

export function personLd(name: string, slug: string, bio?: string) {
  const p: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name,
    url: `${SITE}/authors/${slug}/`,
  };
  if (bio) p.description = bio;
  return p;
}
