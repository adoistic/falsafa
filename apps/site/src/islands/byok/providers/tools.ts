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

// The system prompt lives in ./systemPrompt.ts so the island can import it
// without pulling `ai`/`zod` into the eager bundle. Re-exported here because
// the provider adapters have always imported it from this module.
export {
  FALSAFA_SYSTEM_PROMPT,
  buildSystemPrompt,
  type AtlasCoverageFacts,
} from "./systemPrompt";
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
        "Full-text search across every work in the Falsafa corpus. Returns passage-level matches with work_slug, chapter_number, chapter_slug, paragraph_id, a snippet, and a ready-made citation_url.\n\n" +
        "HOW TO QUERY: all words must appear in the same chapter (it is an AND), stemming is automatic, and there is NO regex and no placeholders. Pass plain words.\n" +
        "- To locate a half-remembered quote, search a distinctive 2-3 word phrase from it — proper nouns or unusual pairings, never common words. If that returns nothing, try a DIFFERENT short phrase rather than repeating the same one.\n" +
        "- Do not paste a whole sentence: one paraphrased word makes the whole query miss.\n" +
        "- If a query over 5 words returns nothing, it is retried automatically with its rarest tokens and the response reports that in `auto_fallback`.\n" +
        "For catalog questions ('what works are by X'), use list_works instead — this searches text, not metadata.",
      inputSchema: z.object({
        query: z.string(),
        scope: z
          .enum(["english", "all"])
          .optional()
          .describe(
            "Default 'english' (translations + English-native works). Use 'all' only when the user asked about source-language text.",
          ),
        work_slug: z.string().optional().describe("Restrict the search to one work."),
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

    // ── Atlas: the ontology layer over the corpus ─────────────────────
    // PARTIAL BY CONSTRUCTION. Every response carries a live atlas_coverage
    // block; the descriptions below say so too, because a model that reads
    // "not in the Atlas" as "not in the corpus" will invent absences.

    atlas_search: tool({
      description:
        "Search the Atlas for a named entity — a figure (god, human, author), place, group, idea, object, event, or animal — by name or by any alias the texts use ('son of Kronos' finds Zeus; 'Śakra' finds Indra). Returns each entity's kind + slug (needed by atlas_entity), how many works mention it, and its recorded surface forms.\n\n" +
        "The Atlas is an ontology extracted from the corpus and is only PARTIALLY built — check the atlas_coverage block in the response. An entity missing here may still appear in works that have not been processed yet; search_corpus covers the whole corpus.",
      inputSchema: z.object({
        query: z.string(),
        kind: z
          .enum(["figure", "group", "place", "object", "idea", "event", "animal"])
          .optional()
          .describe("Restrict to one kind of entity."),
        limit: z.number().int().optional(),
      }),
      execute: async (args) => onToolCall("atlas_search", args),
    }),

    atlas_entity: tool({
      description:
        "Open an Atlas entity's dossier: every work that mentions it, what it does in each one (a per-work gloss), mention counts, and verbatim quotes with paragraph_id + citation_url you can cite directly. Use after atlas_search — pass the kind and slug it returned. This is the tool for 'where does X appear across the corpus' and 'how do different traditions portray X'.",
      inputSchema: z.object({
        kind: z.enum(["figure", "group", "place", "object", "idea", "event", "animal"]),
        slug: z.string().describe("Entity slug from atlas_search, e.g. 'zeus'."),
        limit_works: z.number().int().optional(),
      }),
      execute: async (args) => onToolCall("atlas_entity", args),
    }),

    atlas_work: tool({
      description:
        "What the Atlas knows about one work: which entities appear in which chapters (with paragraph ids), the work's top entities, and how completely this particular work has been processed (windows_done / windows_total). Use it to orient inside a long work before reading, or to answer 'is this work in the Atlas yet'. Returns in_atlas=false — not an error — when the work has not been processed; its text is still fully readable.",
      inputSchema: z.object({
        work_slug: z.string(),
        chapter_slug: z.string().optional().describe("Narrow to a single chapter."),
      }),
      execute: async (args) => onToolCall("atlas_work", args),
    }),

    atlas_citations: tool({
      description:
        "Query the citation graph: which work quotes or invokes which other work, with a stance (authority / endorse / refute / extend / neutral), a count, and citable quotes. Use for influence and reception questions — 'who argues against Chrysippus', 'what does this author lean on'. `cited_work_in_corpus` tells you whether the cited text is itself readable here.",
      inputSchema: z.object({
        work_slug: z.string().optional().describe("Edges where this work cites or is cited."),
        cited_work: z
          .string()
          .optional()
          .describe("Match the cited work's title, author, or slug (substring)."),
        stance: z.enum(["authority", "endorse", "refute", "extend", "neutral"]).optional(),
        limit: z.number().int().optional(),
      }),
      execute: async (args) => onToolCall("atlas_citations", args),
    }),

    atlas_coverage: tool({
      description:
        "Exactly how much of the corpus the Atlas covers right now — works processed vs total, text windows synthesized vs total, and the same breakdown per language and per era, plus entity counts by kind. Read live from the generated Atlas metadata, so the numbers are current, not remembered. Call this before making any claim about Atlas completeness, and to answer 'how complete is the Atlas for Latin / for the Hellenistic era'.",
      inputSchema: z.object({}),
      execute: async (args) => onToolCall("atlas_coverage", args),
    }),
  };
}
