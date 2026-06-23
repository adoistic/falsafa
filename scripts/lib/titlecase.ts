/**
 * Normalize shouting chapter titles to title case, keeping Roman numerals
 * and initialisms. "CHAPTER I. OF THE DIVISION OF LABOUR" ->
 * "Chapter I. Of the Division of Labour". Titles whose letters are less
 * than 70% uppercase are returned unchanged — only shouting (or mostly
 * shouting, e.g. "Chapter I.: RULES FOR ...") titles are touched.
 */
const SMALL = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "of", "on", "in", "to", "at", "by", "as", "with", "from", "into", "upon", "versus", "vs"]);
const ROMAN = /^[IVXLCDM]+[.,:;]{0,2}$/;

export function unshout(title: string): string {
  const letters = title.replace(/[^A-Za-z]/g, "");
  if (!letters) return title;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  const words = title.split(/\s+/);
  const mostlyShouting = upper / letters.length >= 0.7;
  // When the whole title isn't shouting we still normalize a leading run of
  // shouting words — the structural prefix on titles like
  // "CHAPTER I.: Of Sympathy" or "CHAP. II. Of Paternal Power" — up to the
  // first already-mixed-case word, leaving the rest (and any trailing
  // acronym) untouched.
  let firstMixed = words.findIndex((w) => /[a-z]/.test(w) && w !== w.toUpperCase());
  if (firstMixed < 0) firstMixed = words.length;
  const titleWord = (w: string, i: number) => {
    if (ROMAN.test(w) && w.length <= 8) return w; // Roman numerals stay
    if (w !== w.toUpperCase()) return w;          // already mixed-case word
    const lower = w.toLowerCase();
    const core = lower.replace(/[^a-z]/g, "");
    const afterColon = i > 0 && /[:.;]$/.test(words[i - 1]!);
    if (i !== 0 && !afterColon && SMALL.has(core)) return lower;
    return lower.replace(/[a-z]/, (c) => c.toUpperCase());
  };
  const out = words.map((w, i) => (mostlyShouting || i < firstMixed ? titleWord(w, i) : w));
  return out.join(" ");
}
