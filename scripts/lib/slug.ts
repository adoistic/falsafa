/**
 * Slug generation — single source of truth across convert + cross-link + MCP.
 *
 * Rules:
 * - lowercase, ASCII-fold diacritics
 * - replace non-alphanumeric with dashes
 * - collapse runs of dashes
 * - trim leading/trailing dashes
 * - cap at 64 chars (cut at last dash before the cap)
 */

export function slugify(input: string): string {
  if (!input) return "";
  // ASCII-fold diacritics (NFD then strip combining marks)
  const folded = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Common ligature replacements
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe")
    .replace(/ð/gi, "d")
    .replace(/þ/gi, "th");

  const dashed = folded
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  if (dashed.length <= 64) return dashed;
  // Cap at 64 chars, cut at last dash before the cap
  const cut = dashed.slice(0, 64);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 32 ? cut.slice(0, lastDash) : cut;
}

/**
 * Pad chapter number to 2 digits (or more if needed).
 */
export function padChapterNumber(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Take first 6 chars of a UUID for human-readable uniqueness suffix.
 */
export function uuid6(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 6);
}

/**
 * Compose a work slug: {author-slug}-{title-slug}-{uuid6}
 * Truncates author + title individually if their combined length is too long.
 */
export function workSlug(authorName: string, title: string, workUuid: string): string {
  const authorPart = slugify(authorName).slice(0, 24);
  const titlePart = slugify(title).slice(0, 32);
  const uuidPart = uuid6(workUuid);
  return [authorPart, titlePart, uuidPart].filter(Boolean).join("-");
}

/**
 * Compose a chapter slug: {NN}-{title-slug} OR just {NN} for generic titles.
 */
export function chapterSlug(chapterNumber: number, title: string | undefined, isGeneric: boolean): string {
  const num = padChapterNumber(chapterNumber);
  if (isGeneric || !title) return num;
  const titleSlug = slugify(title).slice(0, 50);
  return titleSlug ? `${num}-${titleSlug}` : num;
}
