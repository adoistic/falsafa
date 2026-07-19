// Parser for GRETIL's Mahābhārata HTML (MBH1-18U.HTM).
//
// Reference format in the file:  PP,AAA.SSSsuffix\ttext<BR>
//   PP  = parva  (01–18, zero-padded)
//   AAA = adhyāya (zero-padded)
//   SSS = śloka  (zero-padded)
//   suffix = half-verse letter (a/b/c/e/A/B/C/D/E/F/G) or blank (prose line)
//            — lines with d* or x* or d@ or x@ or *N or @N are apparatus, skipped
//
// Lines with AAA=000 or SSS=000 are colophon/banner lines — skipped.
//
// Output ref: "PP.AAA.SSS" (dotted numeric, leading zeros stripped by parseInt).
// Multiple half-verse pāda lines (a+c, etc.) for the same śloka are joined with " ".

export interface MbhVerse {
  ref: string; // dotted "P.A.S" e.g. "1.1.2"
  parva: number;
  adhyaya: number;
  sloka: number;
  text: string;
}

// Lines that match the verse ref pattern (real text — not apparatus)
// ^PP,AAA.SSSsuffix\t  where suffix ∈ {a–g, A–G, blank} and NOT followed by * or @
// Parva 10 uses "<>" as the separator instead of "\t" — handle both.
const LINE_RE =
  /^(\d{2}),(\d{3})\.(\d{3})([a-gA-G]?)(?:\t|<>)(.*?)<BR>\s*$/;

/** Strip HTML tags and entity references from a text fragment. */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-zA-Z#0-9]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the Mahābhārata HTML and return verses (one entry per unique śloka ref).
 * Skips colophon lines (AAA=000 or SSS=000) and apparatus lines (d/x suffixes, *N, @N).
 * Pāda half-lines sharing the same PP.AAA.SSS are joined in document order.
 */
export function parseMbh(html: string): MbhVerse[] {
  // Group pāda texts by ref key (P.A.S numeric)
  const verseMap = new Map<string, { parva: number; adhyaya: number; sloka: number; texts: string[] }>();
  const verseOrder: string[] = []; // insertion order

  for (const line of html.split("\n")) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const parva = parseInt(m[1]!, 10);
    const adhyaya = parseInt(m[2]!, 10);
    const sloka = parseInt(m[3]!, 10);
    // Skip colophon/header lines
    if (adhyaya === 0 || sloka === 0) continue;
    const text = stripHtml(m[5]!);
    if (!text) continue;

    const key = `${parva}.${adhyaya}.${sloka}`;
    if (!verseMap.has(key)) {
      verseMap.set(key, { parva, adhyaya, sloka, texts: [] });
      verseOrder.push(key);
    }
    verseMap.get(key)!.texts.push(text);
  }

  return verseOrder.map((key) => {
    const v = verseMap.get(key)!;
    return {
      ref: key,
      parva: v.parva,
      adhyaya: v.adhyaya,
      sloka: v.sloka,
      text: v.texts.join(" "),
    };
  });
}
