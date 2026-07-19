const STOPWORDS = new Set(["the","and","that","this","with","from","for","not","are","was","were","his","her","him","its","their","them","they","you","our","who","which","what","when","where","than","then","into","upon","such","may","can","will","would","should","could","must","have","has","had","been","being","also","alone","therefore","thus","every","there","here","these","those","some","any","all","one","two","more","most","much","many","very","but","nor","yet","because","while","whom","whose"]);

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .map((w) => w.replace(/(ings?|ed|es|s)$/,""))  // crude stemming
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

export interface TargetMatch { paragraph_id: string; score: number; snippet: string; }

export function findTargetPassages(
  citingQuote: string,
  targetParagraphs: { id: string; text: string }[],
  topN = 3,
  minScore = 1,
): TargetMatch[] {
  const q = new Set(tokenize(citingQuote));
  if (q.size === 0) return [];
  const scored = targetParagraphs.map((p) => {
    const t = new Set(tokenize(p.text));
    let score = 0;
    for (const w of q) if (t.has(w)) score++;
    return { paragraph_id: p.id, score, snippet: p.text.replace(/\s+/g, " ").slice(0, 140) };
  }).filter((x) => x.score >= minScore).sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
