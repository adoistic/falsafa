/**
 * Within-chapter refrain detection.
 *
 * For each pair of paragraphs (i, j) with j > i, compute normalized
 * token-level edit distance (Levenshtein / max-length). If below threshold,
 * classify as a refrain pair. Group transitively (union-find).
 *
 * Default threshold 0.05 = ≤5% token edits. Captures "this is my homeland"
 * (Iqbal Part 1) and Manu's verse formulae cleanly without false positives.
 *
 * Cross-corpus refrain detection (different works) is INTENTIONALLY out of
 * scope for v1. Within-chapter is sufficient for the card / full-sheet
 * surfaces; spec Q3 defers cross-corpus to MinHash-on-shingles in v2.
 *
 * Output sorted by group size desc — biggest refrains surface first in
 * the rendered card.
 */

export interface RefrainParagraph {
  id: string;
  tokens: string[];
}

export interface RefrainResult {
  /** Longest common token-prefix across all group members. */
  phrase: string;
  /** Group size. */
  count: number;
  /** Paragraph IDs in document order. */
  cites: string[];
}

export interface RefrainOpts {
  /** Max normalized edit distance to count as a refrain pair. Default 0.05. */
  threshold?: number;
}

/** Token-level Levenshtein, normalized by max(|a|, |b|). */
function normalizedEditDistance(a: string[], b: string[]): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 0;
  // DP table, sized (a.length+1) × (b.length+1).
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[a.length]![b.length]! / max;
}

export function detectRefrains(
  paragraphs: RefrainParagraph[],
  opts: RefrainOpts = {},
): RefrainResult[] {
  const threshold = opts.threshold ?? 0.05;
  if (paragraphs.length < 2) return [];

  // Union-find for transitive grouping.
  const parent = paragraphs.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (x: number, y: number) => {
    parent[find(x)] = find(y);
  };

  for (let i = 0; i < paragraphs.length; i++) {
    for (let j = i + 1; j < paragraphs.length; j++) {
      const d = normalizedEditDistance(paragraphs[i]!.tokens, paragraphs[j]!.tokens);
      if (d <= threshold) union(i, j);
    }
  }

  // Collect groups (root → member-indices). Drop singletons.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < paragraphs.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  const out: RefrainResult[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const cites = members.map((i) => paragraphs[i]!.id);
    const tokenLists = members.map((i) => paragraphs[i]!.tokens);

    // Phrase = longest common token-prefix across all members.
    const minLen = Math.min(...tokenLists.map((t) => t.length));
    const prefix: string[] = [];
    for (let k = 0; k < minLen; k++) {
      const token = tokenLists[0]![k]!;
      if (tokenLists.every((t) => t[k] === token)) prefix.push(token);
      else break;
    }

    out.push({
      phrase: prefix.join(" "),
      count: members.length,
      cites,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}
