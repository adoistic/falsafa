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
 *   2. Build a lookup map from each sidecar entry's NORMALIZED text
 *      to its paragraph_id. Normalization strips edge whitespace and
 *      collapses internal whitespace runs so "## PRÉFACE" and
 *      "## PRÉFACE\n" both match the same key.
 *   3. Walk the tokens in order. For each block-level token, render
 *      JUST that token to HTML (using the same marked instance) and
 *      look up its normalized raw text. If we find a match, inject
 *      id="p-xxx" into the outermost opening tag. Otherwise emit the
 *      HTML as-is.
 *   4. Concatenate.
 *
 * Robustness:
 *   The matcher is content-based, not offset-based, because cleanBody()
 *   strips boilerplate lines (Source:, Lines:, horizontal rules) which
 *   would shift offsets relative to the sidecar. Content matching also
 *   survives the case where a sidecar entry doesn't appear in the
 *   rendered output (stripped block) or vice-versa — we just don't
 *   inject an ID for that block.
 *
 *   Identical block content (e.g. repeated epigraphs, blank refrains)
 *   gets first-occurrence-wins. Acceptable: such blocks rarely need to
 *   be cited individually, and the citation URL would be ambiguous
 *   anyway.
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

  // Build lookup map: normalized sidecar text → paragraph_id.
  // First-occurrence-wins on duplicates.
  const lookup = new Map<string, string>();
  for (const entry of sidecar) {
    if (!entry.id || !entry.text) continue;
    const key = normalize(entry.text);
    if (!lookup.has(key)) lookup.set(key, entry.id);
  }

  // Lex and walk top-level tokens.
  const tokens = m.lexer(body);
  const parts: string[] = [];
  for (const token of tokens) {
    // Render this single token to HTML. Marked's parser accepts a
    // token list, so wrap in an array. The walked-tokens list type
    // is `(Token | Tokens.Generic)[]`; we pass it through.
    const html = m.parser([token] as never);
    if (typeof html !== "string") continue;

    // Skip "space" tokens — they're just blank-line separators with
    // no rendered output anyway.
    if (token.type === "space") {
      parts.push(html);
      continue;
    }

    const raw = typeof token.raw === "string" ? token.raw : "";
    const key = normalize(raw);
    const id = lookup.get(key);
    if (id) {
      parts.push(injectIdIntoFirstTag(html, id));
    } else {
      parts.push(html);
    }
  }

  return parts.join("");
}

// Test hook: exposed for unit tests in the same package; not part of
// the documented public API.
export const __testing = { normalize, injectIdIntoFirstTag };
