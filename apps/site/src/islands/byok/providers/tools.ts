/**
 * Falsafa MCP tool definitions for the BYOK demo.
 *
 * The 8 librarian tools mirror what apps/mcp exposes over stdio. Each tool's
 * `execute` calls the injected onToolCall callback, which the BYOK island
 * routes to either:
 *  - browser-bundled tool implementations (Q1 option A), or
 *  - a remote MCP server at mcp.falsafa.ai (Q1 option B / C in production)
 *
 * Tool descriptions are copied verbatim from apps/mcp/src/index.ts so the
 * model sees the same prompt regardless of which dispatch path runs.
 *
 * Schemas use zod (the AI SDK's preferred runtime validation library).
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";

export type OnToolCall = (name: string, args: unknown) => Promise<unknown>;

export function buildFalsafaTools(onToolCall: OnToolCall): ToolSet {
  return {
    list_works: tool({
      description:
        "List works in the Falsafa corpus. Optionally filter by author, era, language, or genre. Returns slug + title + author + era for each match. Use this to discover what's in the corpus before searching.",
      inputSchema: z.object({
        author: z.string().optional(),
        era: z.string().optional(),
        language: z.string().optional(),
        genre: z.string().optional(),
      }),
      execute: async (args) => onToolCall("list_works", args),
    }),

    list_chapters: tool({
      description: "List chapters in a specific work. Returns chapter_number + title for each chapter.",
      inputSchema: z.object({
        work_slug: z.string().describe("The work's slug, e.g. 'mirza-ghalib-diwan-e-ghalib-74ed4c'."),
      }),
      execute: async (args) => onToolCall("list_chapters", args),
    }),

    get_metadata: tool({
      description:
        "Get full metadata for a work: era, language, author bio, original-language info, total chapters, etc. Useful when you need context before reading.",
      inputSchema: z.object({
        work_slug: z.string(),
      }),
      execute: async (args) => onToolCall("get_metadata", args),
    }),

    read_chapter: tool({
      description:
        "Read a full chapter's translation, original, or transliteration. Default variant is 'translation' (English) — use that for reasoning. Specify 'original' or 'transliteration' if the user asked for source-language text.",
      inputSchema: z.object({
        work_slug: z.string(),
        chapter_number: z.number().int(),
        variant: z.enum(["translation", "original", "transliteration"]).optional(),
      }),
      execute: async (args) => onToolCall("read_chapter", args),
    }),

    get_passage: tool({
      description:
        "Get specific paragraphs from a chapter for precise citation. Specify paragraph_ids (stable hashes) or paragraph_range as a 2-element array [start, end] (0-indexed, inclusive). Returns just the requested paragraphs, not the full chapter. Default variant is English; use 'original' or 'transliteration' if the user asked for source-language text.",
      inputSchema: z.object({
        work_slug: z.string(),
        chapter_number: z.number().int(),
        paragraph_ids: z.array(z.string()).optional(),
        // NOT z.tuple([...]) — tuples compile to JSON Schema 2020-12
        // `prefixItems`, which Google's GenerateContent API and Azure/OpenAI
        // strict validators reject (Google: "missing field `items`"; Azure:
        // "not of type 'object', 'boolean'"). A uniform-items array with
        // length 2 produces a schema that every OpenRouter-routed provider
        // accepts. Runtime shape is identical: [start, end].
        paragraph_range: z.array(z.number().int()).length(2).optional(),
        variant: z.enum(["translation", "original", "transliteration"]).optional(),
      }),
      execute: async (args) => onToolCall("get_passage", args),
    }),

    search_corpus: tool({
      description:
        "Full-text search across the entire Falsafa corpus. Returns paragraph-level matches with work_slug, chapter_number, paragraph_id, and a snippet. Use for finding specific phrases, names, or concepts across many works at once.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().optional(),
      }),
      execute: async (args) => onToolCall("search_corpus", args),
    }),

    find_related: tool({
      description:
        "Find chapters related to a given work or chapter via build-time TF-IDF cross-link. Returns the top related chapters across the corpus. Use for thematic discovery.",
      inputSchema: z.object({
        work_slug: z.string(),
        chapter_number: z.number().int().optional(),
        limit: z.number().int().optional(),
      }),
      execute: async (args) => onToolCall("find_related", args),
    }),

    compare_works: tool({
      description:
        "Compare two works on a topic. Returns relevant chapter pointers from each work, plus metadata. The host LLM does the actual comparison reasoning — this tool just gathers what to compare.",
      inputSchema: z.object({
        work_slug_a: z.string(),
        work_slug_b: z.string(),
        topic: z.string().optional(),
      }),
      execute: async (args) => onToolCall("compare_works", args),
    }),
  };
}

export const FALSAFA_SYSTEM_PROMPT = `You are a librarian for the Falsafa corpus — translated philosophical and classical texts. You have access to 8 tools that let you navigate the corpus directly.

Approach:
1. If you need to discover what's in the corpus, start with list_works.
2. For specific phrases or concepts, search_corpus first.
3. Read chapters with read_chapter when you need full context.
4. Cite paragraphs precisely with get_passage when the user wants quotation.
5. For "what work also covers this", use find_related.
6. For side-by-side comparisons, use compare_works.

If a question can't be answered from the corpus, say so honestly — don't invent. The corpus has 37 works currently; not every topic is covered.

# Citations

Every claim you make from the corpus MUST be cited via markdown footnotes. The reader will see your prose with small superscript [1] [2] markers; clicking each one jumps to a footnote at the bottom that contains the source link.

## How to format citations

Use markdown's footnote syntax: \`[^1]\` inline, \`[^1]: ...\` at the bottom.

\`\`\`
The author argues that property is the foundation of liberty.[^1]

[^1]: Charles Comte, *Traité de la propriété*, [paragraph](/works/charles-comte-...-2c7a99/00-preface/translation/#p-be2857).
\`\`\`

The link target — the URL inside \`[paragraph](url)\` — comes from the \`citation_url\` field that read_chapter and get_passage return. Use it verbatim. Don't reconstruct URLs by hand.

**URL format hard rule:** the citation_url always ends in a trailing slash (e.g. \`.../translation/\`). When you append a paragraph anchor like \`#p-be2857\`, keep that slash — write \`.../translation/#p-be2857\`, NEVER \`.../translation#p-be2857\`. The route is configured with \`trailingSlash: always\`; the version without the slash 404s. If get_passage already gave you a URL with the hash baked in, use it as-is and don't strip anything.

## Picking the right kind of citation

- **Single paragraph quote or claim** — call get_passage with one paragraph_id. The result's \`paragraphs[0].citation_url\` is the link.
- **Multi-paragraph passage** (e.g., "argued across paragraphs 4–7") — call get_passage with the full \`paragraph_ids\` list or a \`paragraph_range\`. The TOP-LEVEL \`citation_url\` field in the result highlights all of them at once.
- **Whole chapter** — call read_chapter. Its \`citation_url\` is the bare chapter URL.
- **Two separate passages from the same source** — emit two footnotes, [^1] and [^2], with the per-paragraph \`citation_url\` for each.

## Hard rule

NEVER write raw paragraph IDs like \`p-be2857\` or \`p-f22236\` in your final answer prose. They are meaningless to the reader. Always wrap them in a markdown link via the \`citation_url\` field. The IDs are an internal handle, not a citation.

The user's question follows. Use the tools, then answer.`;
