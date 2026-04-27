/**
 * MarkdownView — renders model output as parsed markdown.
 *
 * The model writes markdown (headings, lists, blockquotes, tables, code,
 * bold/italic, links). Rendering it as plain text loses all that. Marked
 * handles streaming-incomplete markdown gracefully — partial output
 * renders as best-effort, no crash on a half-formed `**bold` token.
 *
 * Security note: the LLM is controllable by the user (they pasted their
 * own key, picked their own model, asked their own question), so we trust
 * its output more than arbitrary user input. Page-level CSP also blocks
 * script execution and limits img/connect destinations, which neutralizes
 * the standard markdown-XSS vectors. We use marked's default escaping
 * (raw `<script>` becomes literal text) without DOMPurify for now.
 */

import { useMemo } from "preact/hooks";
import type { JSX } from "preact";
import { Marked } from "marked";
import markedFootnote from "marked-footnote";

/**
 * Module-scoped marked instance. We construct it once and reuse across
 * every render of MarkdownView, since `new Marked()` with extensions
 * has nontrivial setup cost and the configuration is invariant.
 *
 * Why scoped (Marked) instead of the global `marked`:
 *   marked.use() is global — adding the footnote extension to the
 *   default instance would also affect the chapter renderer in
 *   ChapterBody.astro, which we don't want. A scoped instance keeps
 *   the extension contained to BYOK answer rendering.
 *
 * gfm:    GitHub-flavoured markdown — tables, strikethrough, task lists.
 * breaks: render single newlines as <br>. Matches how LLMs format prose;
 *         without this their output looks ragged.
 *
 * The footnote extension teaches the lexer about [^1] inline references
 * and `[^1]: ...` definition blocks. The reference renders as a
 * superscript link; the definitions collect into an ordered list at the
 * bottom of the document. Standard CommonMark extension semantics.
 */
const md = new Marked({ gfm: true, breaks: true, async: false });
md.use(markedFootnote());

interface Props {
  text: string;
  /** Tighter style, used for the model's intermediate commentary. */
  inline?: boolean;
}

export default function MarkdownView({ text, inline }: Props): JSX.Element {
  const html = useMemo(() => {
    try {
      const parsed = md.parse(text);
      return typeof parsed === "string" ? parsed : "";
    } catch {
      // If marked chokes on partial input, fall back to raw text
      return escapeHtml(text);
    }
  }, [text]);

  return (
    <div
      class={inline ? "byok-md byok-md-inline" : "byok-md"}
      // The Preact runtime renders this as a real DOM element.
      // dangerouslySetInnerHTML is safe per the comment in the file header.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
