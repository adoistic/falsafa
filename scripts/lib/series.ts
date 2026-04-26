/**
 * Series taxonomy — groups works that should share visual cohesion (palette,
 * mood, watercolor treatment) so siblings read as related when displayed
 * next to each other.
 *
 * The grouping rules below derive a series_id from work metadata. Series
 * anchors (palette, mood, watercolor treatment) live in style-guide.json
 * keyed by series_id.
 */

export interface WorkMeta {
  slug: string;
  title: string;
  author: string;
  era: string;
  language: string;
  genre?: string;
}

/**
 * Derive a stable series_id from work metadata. Multi-volume series, multi-part
 * series, and single-language corpus groups are all collapsed into one series.
 * Solo works get their own per-work series_id.
 */
export function deriveSeriesId(work: WorkMeta): string {
  // The corpus JSON stores titles in NFD form (combining diacritics) but our
  // string literals here are NFC. Without normalization, "Traité" (NFD)
  // doesn't startsWith("Traité") (NFC) — silent miss. Normalize both sides.
  const author = (work.author ?? "").normalize("NFC");
  const title = (work.title ?? "").normalize("NFC");
  const lang = (work.language ?? "").toLowerCase();

  // ── Cynewulf trilogy (Andreas, Elene, Juliana) ───────────────────────
  if (author === "Cynewulf") return "cynewulf-trilogy";

  // ── Iqbal: Bang-E-Dara Part 1/2/3 ────────────────────────────────────
  if (author === "Allama Iqbal" && title.startsWith("Bang-E-Dara")) {
    return "iqbal-bang-e-dara";
  }

  // ── Charles Comte: Traité de Législation (Vol I-IV) ──────────────────
  if (author === "Charles Comte" && title.startsWith("Traité de Législation")) {
    return "comte-legislation";
  }

  // ── Charles Comte: Traité de la propriété (Vol I-II) ─────────────────
  if (author === "Charles Comte" && title.startsWith("Traité de la propriété")) {
    return "comte-propriete";
  }

  // ── Charles Dunoyer: Nouveau traité d'économie (Vol I-II) ────────────
  if (author === "Charles Dunoyer") return "dunoyer-economie";

  // ── Sanskrit smṛti corpus (Manu, Yājñavalkya, Nārada, etc.) ──────────
  // All Sanskrit works share visual register — sandalwood palette, palm-leaf
  // manuscript mood, sacred verse-numbered structure
  if (lang === "sanskrit") return "sanskrit-smrti";

  // ── Old Javanese / Kawi tattva corpus ────────────────────────────────
  // San Hyan series + Vrhaspatitattva, Gaṇapatitattva, Slokantara, etc.
  if (lang === "kawi") return "kawi-tattva";

  // ── Solo works get per-work series_id ────────────────────────────────
  return `solo-${work.slug}`;
}

/**
 * Convenience: returns the slugs of all works in the same series as `work`,
 * useful for the prompt pipeline to pass siblings into the LLM context.
 */
export function findSeriesSiblings(work: WorkMeta, allWorks: WorkMeta[]): WorkMeta[] {
  const seriesId = deriveSeriesId(work);
  return allWorks.filter((w) => w.slug !== work.slug && deriveSeriesId(w) === seriesId);
}

/**
 * Group all works by series_id. Useful for printing series rosters or for
 * generating series-anchor stubs in the style guide.
 */
export function groupBySeriesId(allWorks: WorkMeta[]): Record<string, WorkMeta[]> {
  const groups: Record<string, WorkMeta[]> = {};
  for (const w of allWorks) {
    const id = deriveSeriesId(w);
    if (!groups[id]) groups[id] = [];
    groups[id]!.push(w);
  }
  return groups;
}
