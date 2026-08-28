/**
 * inject-paragraph-ids — render markdown to HTML with paragraph_id
 * anchors injected onto each top-level block.
 *
 * Why this exists:
 *   The reader needs id="p-xxx" attributes on rendered blocks so
 *   citation URLs (#p-xxx, ?paragraphs=…) can scroll to and highlight
 *   specific paragraphs. Marked doesn't natively know about our
 *   sidecar paragraph IDs — it tokenises the markdown and renders
 *   plain HTML. We bridge the gap here.
 *
 * Approach:
 *   1. Lex the cleaned markdown — yields a flat list of top-level
 *      tokens (paragraph, heading, blockquote, list, code, html, …).
 *   2. Build a lookup from each sidecar entry's NORMALIZED text to its
 *      position in the sidecar. Normalization strips edge whitespace and
 *      collapses internal whitespace runs so "## PRÉFACE" and
 *      "## PRÉFACE\n" both match the same key.
 *   3. Walk the tokens in order and decide, per token, which sidecar
 *      entry it spells out — alone, or together with the tokens after it.
 *      That walk is `planIds`, and it produces a plan, not HTML.
 *   4. Render each planned step and inject id="p-xxx" into the outermost
 *      opening tag. Concatenate.
 *
 * Robustness:
 *   The matcher is content-based, not offset-based, because cleanBody()
 *   strips boilerplate lines (Source:, Lines:, horizontal rules) which
 *   would shift offsets relative to the sidecar. Content matching also
 *   survives the case where a sidecar entry doesn't appear in the
 *   rendered output (stripped block) or vice-versa — we just don't
 *   inject an ID for that block.
 *
 * Why the walk runs twice:
 *   Content matching alone cannot tell two identical blocks apart, and a
 *   text that is a whole chunk in one place is the opening line of a
 *   longer chunk in another. The first walk resolves those collisions by
 *   first-occurrence-wins, which is what shipped; the second walk resolves
 *   them by position in the sidecar, which is what the corpus actually
 *   means. The ordered walk is used only when it emits every id the
 *   first-occurrence walk emitted, so the anchors on a page can only ever
 *   be a superset of what they were — see `planIds` and the two `Matcher`s.
 */

import { Marked } from "marked";
import type { ParagraphSidecarEntry } from "./corpus";

/**
 * Normalize markdown text for lookup. Strip leading/trailing whitespace
 * and collapse internal whitespace runs to single spaces. The sidecar
 * `text` field and a token's `raw` property both come from the same
 * source file, so after normalization they should match exactly for
 * the vast majority of blocks.
 */
function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Set of opening tag names that wrap a top-level block. The injection
 * regex looks for the FIRST occurrence of any of these, then inserts
 * the id attribute. Order doesn't matter — we use a single regex.
 */
const BLOCK_OPENING_TAG = /<(p|h[1-6]|blockquote|pre|ul|ol|table|hr|figure|div)\b([^>]*)>/i;

/**
 * Inject id="value" into the FIRST block-level opening tag of an HTML
 * fragment. If the fragment has no recognizable opening tag (e.g. raw
 * text or an unsupported element), returns the fragment unchanged.
 */
function injectIdIntoFirstTag(html: string, id: string): string {
  return html.replace(BLOCK_OPENING_TAG, (_match, tag: string, attrs: string) => {
    // If there's already an id="..." in the attrs, leave it alone — we
    // shouldn't overwrite an explicit id from the source markdown.
    if (/\sid\s*=/.test(attrs)) return _match;
    return `<${tag} id="${id}"${attrs}>`;
  });
}

/**
 * A leading verse marker: "**1.1**  ", "**8.23**  ". Five works — the
 * Ṛgveda, the Mahābhārata, the Sāmaveda, the Atharvaveda Paippalāda and the
 * Vālmīki Rāmāyaṇa — carry the verse number in the markdown but not in the
 * sidecar text, which was written before that pass ran, so not one of their
 * 11,708 blocks matched and 67 more variant pages had no anchors. The marker
 * is stripped only as a FALLBACK, after the exact text has failed, so a
 * paragraph that genuinely opens in bold is unaffected.
 */
const VERSE_MARKER = /^\*\*[^*\n]{1,24}\*\*\s*/;

/**
 * The furthest a run of tokens is allowed to reach for one sidecar chunk.
 * The longest real case measured is four tokens (prose, list, prose, list);
 * the bound keeps a chunk that is simply absent from swallowing the blocks
 * after it.
 */
const MAX_RUN = 6;

/**
 * What a piece of raw markdown claims: the position in the sidecar of the
 * entry whose text it is, and whether that entry still lies ahead of
 * everything already anchored. A claim that is not `ahead` is a repeat of a
 * block already anchored earlier on the page.
 */
interface Claim {
  index: number;
  ahead: boolean;
}

/**
 * The decisions the walk delegates. Two implementations exist and both run
 * on every chapter: `firstOccurrence` reproduces the matcher that shipped,
 * `sidecarOrder` resolves the same collisions by position instead.
 */
interface Matcher {
  /** The sidecar entry this raw markdown claims, if any. */
  claim(raw: string): Claim | null;
  /** May a token claiming `c` be swallowed into a run claiming `index`? */
  absorbable(c: Claim | null, index: number): boolean;
  /** With both a single-token and a run claim in hand, does the run win? */
  preferRun(single: Claim | null, run: Claim | null): boolean;
  /** Whether a run is worth computing when the single token already claims. */
  runMayWin: boolean;
  /** Whether one sidecar chunk may span consecutive items of one list. */
  spansListItems: boolean;
  /** The id at a sidecar position, marking everything up to it as anchored. */
  take(index: number): string;
}

/** The sidecar in order, plus the positions each normalized text stands at. */
interface Index {
  entries: ParagraphSidecarEntry[];
  byKey: Map<string, number[]>;
}

function buildIndex(sidecar: ParagraphSidecarEntry[]): Index {
  const entries: ParagraphSidecarEntry[] = [];
  const byKey = new Map<string, number[]>();
  for (const entry of sidecar) {
    if (!entry.id || !entry.text) continue;
    const at = entries.length;
    entries.push(entry);
    const key = normalize(entry.text);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(at);
    else byKey.set(key, [at]);
  }
  return { entries, byKey };
}

/** The sidecar positions this raw markdown could be, exact match preferred. */
function positionsFor(index: Index, raw: string): number[] | undefined {
  const key = normalize(raw);
  return index.byKey.get(key) ?? index.byKey.get(normalize(key.replace(VERSE_MARKER, "")));
}

/**
 * The matcher that shipped: a text belongs to the first sidecar entry that
 * carries it, wherever on the page the text turns up, and a token that
 * matches on its own is never read as the opening of a longer chunk.
 */
function firstOccurrence(index: Index): Matcher {
  return {
    claim(raw) {
      const at = positionsFor(index, raw);
      return at ? { index: at[0]!, ahead: false } : null;
    },
    absorbable: (c) => c === null,
    preferRun: (single, run) => single === null && run !== null,
    runMayWin: false,
    spansListItems: false,
    take: (i) => index.entries[i]!.id,
  };
}

/**
 * The matcher that reads the sidecar as the ordered document it is. A text
 * claims the first entry that has not been passed yet, so the second
 * printing of a refrain anchors the second chunk rather than repeating the
 * first chunk's id; and a token that only matches an entry further down the
 * text yields to a run that matches the entry due here, which is the shape
 * behind most of the dead links — a lead-in line such as "In the *Matsya
 * Purāṇa*:" is a whole chunk in one place and the first line of a
 * lead-in-plus-quotation chunk in another.
 *
 * When nothing lies ahead the claim falls back to the first entry, which is
 * exactly what `firstOccurrence` would have said, so a text the sidecar
 * knows never goes unanchored.
 */
function sidecarOrder(index: Index): Matcher {
  let cursor = -1;
  return {
    claim(raw) {
      const at = positionsFor(index, raw);
      if (!at) return null;
      for (const i of at) if (i > cursor) return { index: i, ahead: true };
      return { index: at[0]!, ahead: false };
    },
    absorbable: (c, i) => c === null || !c.ahead || c.index > i,
    preferRun: (single, run) =>
      run !== null && run.ahead && (single === null || !single.ahead || run.index < single.index),
    runMayWin: true,
    spansListItems: true,
    take(i) {
      if (i > cursor) cursor = i;
      return index.entries[i]!.id;
    },
  };
}

/** One rendered unit: a token, a run of tokens, or a list with per-item ids. */
interface Step {
  start: number;
  end: number;
  id?: string;
  listIds?: (string | undefined)[];
}

function rawOf(token: { raw?: string } | undefined): string {
  return typeof token?.raw === "string" ? token.raw : "";
}

/**
 * The sidecar entry that a run of consecutive tokens starting at `start`
 * spells out, if any. One chunk can lex as SEVERAL tokens: "And they are:"
 * followed by an enumeration is a paragraph and a list to marked, and one
 * blank-line-separated block to the corpus pipeline that wrote the sidecar;
 * so is a lead-in line followed by the verse it introduces, which is 56 of
 * the 74 dead fragments the previous round left standing. A token that
 * claims an entry of its own is never absorbed: that would move an anchor
 * the reader can already reach.
 */
function matchRun(
  tokens: { type?: string; raw?: string }[],
  start: number,
  matcher: Matcher,
): { claim: Claim; end: number } | null {
  let acc = rawOf(tokens[start]);
  const absorbed: (Claim | null)[] = [];
  for (let end = start + 1; end < tokens.length && end - start < MAX_RUN; end++) {
    const t = tokens[end]!;
    const raw = rawOf(t);
    acc += raw;
    if (t.type === "space") continue;
    absorbed.push(matcher.claim(raw));
    const c = matcher.claim(acc);
    if (!c) continue;
    return absorbed.every((a) => matcher.absorbable(a, c.index)) ? { claim: c, end: end + 1 } : null;
  }
  return null;
}

/**
 * A markdown chunk whose text begins "1. ", "2. ", … is lexed by marked as
 * one ORDERED LIST, however many blank lines separate the numbers. 223 works
 * in the corpus number their paragraphs that way — Tertullian, Aelius
 * Aristides, most of the Perseus orations — and for them the whole chapter
 * arrives as a single `list` token whose raw text matches no sidecar entry,
 * so not one id was injected: 884 of 34,512 variant pages carried zero
 * anchors, and every citation and atlas link into them landed at the top of
 * the page instead of at the passage.
 *
 * The sidecar chunks and the list's items are the same blocks, so the ids go
 * on the `<li>`s. One chunk can still span two items — 50 of the 501 chunks
 * of Tertullian's Apologeticum open with a bare section number, "31.", which
 * marked lexes as an item of its own — so the run matcher walks the items
 * too, and the chunk anchors at the first of them.
 */
function planListItems(items: { raw?: string }[], matcher: Matcher): (string | undefined)[] {
  const ids: (string | undefined)[] = new Array(items.length).fill(undefined);
  for (let j = 0; j < items.length; j++) {
    const single = matcher.claim(rawOf(items[j]));
    const run =
      matcher.spansListItems && (single === null || matcher.runMayWin)
        ? matchRun(items, j, matcher)
        : null;
    if (run && (single === null || matcher.preferRun(single, run.claim))) {
      ids[j] = matcher.take(run.claim.index);
      j = run.end - 1;
      continue;
    }
    if (single) ids[j] = matcher.take(single.index);
  }
  return ids;
}

/** Walk the tokens once and decide what each one anchors. */
function planIds(tokens: { type?: string; raw?: string }[], matcher: Matcher): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    // "space" tokens are blank-line separators with no rendered output.
    if (token.type === "space") {
      steps.push({ start: i, end: i + 1 });
      continue;
    }
    const single = matcher.claim(rawOf(token));
    const run = single === null || matcher.runMayWin ? matchRun(tokens, i, matcher) : null;
    if (run && matcher.preferRun(single, run.claim)) {
      steps.push({ start: i, end: run.end, id: matcher.take(run.claim.index) });
      i = run.end - 1;
      continue;
    }
    if (single) {
      steps.push({ start: i, end: i + 1, id: matcher.take(single.index) });
      continue;
    }
    if (run) {
      steps.push({ start: i, end: run.end, id: matcher.take(run.claim.index) });
      i = run.end - 1;
      continue;
    }
    const items = (token as { items?: { raw?: string }[] }).items;
    if (token.type === "list" && Array.isArray(items)) {
      const listIds = planListItems(items, matcher);
      steps.push({ start: i, end: i + 1, listIds: listIds.some(Boolean) ? listIds : undefined });
      continue;
    }
    steps.push({ start: i, end: i + 1 });
  }
  return steps;
}

/** Every id a plan puts on the page, list items included. */
function idsOf(plan: Step[]): Set<string> {
  const ids = new Set<string>();
  for (const step of plan) {
    if (step.id) ids.add(step.id);
    for (const id of step.listIds ?? []) if (id) ids.add(id);
  }
  return ids;
}

/**
 * Inject id="value" into each depth-1 `<li>` of a rendered list, in order.
 * Injecting into the rendered HTML rather than rendering each item
 * separately keeps the markup marked would have produced. A nested list's
 * items are not sidecar chunks and are left alone.
 */
function injectIdsIntoListItems(html: string, ids: (string | undefined)[]): string {
  let depth = 0;
  let seen = 0;
  return html.replace(/<(\/?)(ol|ul|li)\b([^>]*)>/gi, (match, close: string, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (t === "ol" || t === "ul") {
      depth += close ? -1 : 1;
      return match;
    }
    if (close || depth !== 1) return match;
    const id = ids[seen++];
    // An explicit id from the source markdown wins, as it does for blocks.
    if (!id || /\sid\s*=/.test(attrs)) return match;
    return `<li id="${id}"${attrs}>`;
  });
}

/**
 * Render markdown to HTML with paragraph_id anchors injected per block.
 *
 * The marked instance is created fresh inside this function so renderer
 * customisations don't leak to other callers (e.g. the BYOK
 * MarkdownView, which has its own marked config).
 *
 * If the sidecar is empty, we return the same HTML you'd get from
 * plain marked — this keeps the function safe to call when the sidecar
 * is missing.
 */
export function renderMarkdownWithParagraphIds(
  body: string,
  sidecar: ParagraphSidecarEntry[],
): string {
  const m = new Marked({ gfm: true, breaks: false });

  // Fast path: no sidecar → straight render.
  if (sidecar.length === 0) {
    const out = m.parse(body);
    return typeof out === "string" ? out : "";
  }

  const index = buildIndex(sidecar);
  const tokens = m.lexer(body);

  // Both walks run, and the ordered one is adopted only when it anchors
  // every id the shipped matcher anchored. That comparison is the whole
  // safety argument: a page can gain anchors from this file, never lose
  // one, whatever a chapter's markdown does.
  const shipped = planIds(tokens, firstOccurrence(index));
  const ordered = planIds(tokens, sidecarOrder(index));
  const shippedIds = idsOf(shipped);
  const orderedIds = idsOf(ordered);
  let plan = ordered;
  for (const id of shippedIds) {
    if (!orderedIds.has(id)) {
      plan = shipped;
      break;
    }
  }

  const parts: string[] = [];
  for (const step of plan) {
    // Marked's parser accepts a token list; the walked-tokens list type is
    // `(Token | Tokens.Generic)[]`, and we pass it through. Rendering a run
    // as one unit concatenates to exactly what its tokens render to
    // separately.
    const html = m.parser(tokens.slice(step.start, step.end) as never);
    if (typeof html !== "string") continue;
    if (step.id) parts.push(injectIdIntoFirstTag(html, step.id));
    else if (step.listIds) parts.push(injectIdsIntoListItems(html, step.listIds));
    else parts.push(html);
  }

  return parts.join("");
}

// Test hook: exposed for unit tests in the same package; not part of
// the documented public API.
export const __testing = {
  normalize,
  injectIdIntoFirstTag,
  injectIdsIntoListItems,
  buildIndex,
  firstOccurrence,
  sidecarOrder,
  planIds,
  idsOf,
  matchRun,
};
