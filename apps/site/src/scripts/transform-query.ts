/**
 * Pure functions for transforming a user-typed search query into the
 * sequence of strategies we'll feed to Pagefind. Owned by search-runner.ts.
 *
 * Two transforms applied:
 *
 *   1. Comma-OR. "dharma, courage" → first strategy is a Pagefind OR query
 *      that matches chapters mentioning either term. (Pagefind treats
 *      space-separated tokens as AND — that's still useful as a follow-up
 *      strategy when a multi-comma OR returns too many noisy results, but
 *      OR is the user's intent when they type the comma.)
 *
 *   2. Trailing-wildcard typo fallback. Pagefind has no native fuzzy match,
 *      but it does support `term*` prefix wildcards. So when strategy 1
 *      returns 0 hits, we retry with each token suffixed by `*`. This
 *      catches incomplete typing ("cor" → "courage") and many short typos
 *      where the early letters survived. Misses transpositions
 *      ("coruage") — that's the C2 upgrade if usage demands it.
 *
 * Tests in transform-query.test.ts.
 */

export interface QueryStrategies {
  /** Original user-typed query, trimmed. */
  raw: string;
  /** The space- and comma-tokenized terms, lowercase. Used for snippet
   *  highlighting after a result lands. */
  tokens: string[];
  /** Ordered list of Pagefind queries to try. Each is run sequentially;
   *  the first to return ≥1 result is used. */
  strategies: string[];
}

const COMMA_SPLIT_RX = /\s*,\s*/;
const WHITESPACE_SPLIT_RX = /\s+/;

/**
 * Split on commas first (OR groups), then split each group on whitespace
 * (AND inside the group). Drops empty tokens.
 */
function tokenize(raw: string): { groups: string[][] } {
  const trimmed = raw.trim();
  if (!trimmed) return { groups: [] };
  const commaGroups = trimmed.split(COMMA_SPLIT_RX).filter(Boolean);
  const groups = commaGroups
    .map((g) => g.split(WHITESPACE_SPLIT_RX).filter(Boolean))
    .filter((g) => g.length > 0);
  return { groups };
}

/**
 * Build a Pagefind query string from the tokenized groups.
 *  - Single group, single token: "courage"
 *  - Single group, multi-token: "dharma courage" (Pagefind ANDs them)
 *  - Multi-group: "(group1) OR (group2)" — Pagefind doesn't actually
 *    support OR/parens; we approximate by joining all OR groups with
 *    spaces so any single match counts. (See note below — this is the
 *    pragmatic V1 shape; the search runner can also fan out per-group
 *    and union client-side, which gives true OR. For now the fan-out
 *    happens in the runner, and this function returns the per-group
 *    queries that should be unioned.)
 */
function joinTokensForGroup(tokens: string[]): string {
  return tokens.join(" ");
}

function withTrailingWildcard(group: string[]): string {
  // Skip wildcards on already-wildcarded or quoted terms; otherwise append *.
  return group
    .map((t) => (t.endsWith("*") || t.startsWith('"') ? t : `${t}*`))
    .join(" ");
}

/**
 * Build the strategy chain. The runner runs strategies sequentially;
 * if a strategy returns ≥1 result it short-circuits.
 *
 * Special case: when there are multiple comma groups, we can't express
 * native OR in Pagefind's query string, so we return one "strategy" that
 * is actually a list of per-group queries to fan out. The runner uses
 * the `groups` field instead of `strategies` in that case.
 */
export function transformQuery(raw: string): QueryStrategies & { groups: string[][] } {
  const { groups } = tokenize(raw);
  const tokens = groups.flat();

  if (groups.length === 0) {
    return { raw, tokens: [], strategies: [], groups: [] };
  }

  if (groups.length === 1) {
    const g = groups[0]!;
    const exact = joinTokensForGroup(g);
    const wildcarded = withTrailingWildcard(g);
    // Strategy 1: exact (let stemming do its thing).
    // Strategy 2: trailing wildcards on every token (typo recovery).
    const strategies = [exact];
    if (exact !== wildcarded) strategies.push(wildcarded);
    return { raw, tokens, strategies, groups: [g] };
  }

  // Multi-group OR: runner fans out per-group, unions, ranks by max score.
  // strategies[] is empty here — the runner switches on groups.length.
  return { raw, tokens, strategies: [], groups };
}
