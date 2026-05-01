#!/usr/bin/env node
/**
 * Falsafa MCP server — stdio transport.
 *
 * Ten librarian-flavored tools so any LLM can navigate the corpus
 * (eight catalog tools plus read_wiki + read_wiki_full).
 *
 * Install (canonical, one per client):
 *   Claude Code:    claude mcp add falsafa npx -y @falsafa/mcp
 *   Claude Desktop: edit ~/Library/Application Support/Claude/claude_desktop_config.json
 *                     { "mcpServers": { "falsafa": { "command": "npx", "args": ["-y", "@falsafa/mcp"] } } }
 *   Cursor:         Settings → MCP → Add new global MCP server (same JSON)
 *   Codex CLI:      codex mcp add falsafa -- npx -y @falsafa/mcp
 *   Other:          point any stdio MCP client at `npx -y @falsafa/mcp`
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { Corpus, MCPError } from "./corpus.ts";
import {
  list_works,
  list_chapters,
  get_metadata,
  read_chapter,
  get_passage,
  search_corpus,
  find_related,
  compare_works,
  read_wiki,
  read_wiki_full,
} from "./tools.ts";

// ─────────────────────────────────────────────────────────────────────────
// Server setup
// ─────────────────────────────────────────────────────────────────────────

const corpus = new Corpus();
const works = corpus.works();
console.error(`[falsafa-mcp] corpus loaded: ${works.length} works from ${corpus.rootPath}`);

const server = new Server(
  {
    name: "falsafa",
    version: "0.0.1",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Tool definitions (advertised in tools/list)
// ─────────────────────────────────────────────────────────────────────────

const tools = [
  {
    name: "list_works",
    description:
      "List works in the Falsafa corpus, optionally filtered by era, author, language, genre, or difficulty. Returns work-level metadata for catalog navigation. Use this when the user asks 'what works are by X' or 'what philosophy works do you have'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        era: { type: "string", description: "Era name or slug (e.g., 'Medieval', '20th-century')" },
        author: { type: "string", description: "Author name or slug (substring match)" },
        language: { type: "string", description: "Source language name or slug (e.g., 'Sanskrit', 'urdu')" },
        genre: { type: "string", description: "Genre name or slug (e.g., 'Literature', 'Philosophy')" },
        difficulty: { type: "string", description: "Difficulty level (e.g., 'Beginner', 'Advanced')" },
      },
    },
  },
  {
    name: "list_chapters",
    description:
      "List all chapters in a specific work. Returns chapter numbers, titles, layouts (prose/verse/manuscript), and available language variants. Use this to walk a work's table of contents.",
    inputSchema: {
      type: "object" as const,
      properties: {
        work_slug: { type: "string", description: "Work slug, e.g., 'cynewulf-andreas-07b573'" },
      },
      required: ["work_slug"],
    },
  },
  {
    name: "get_metadata",
    description:
      "Get full metadata for a work: author bio, era, genre, language, description, layout distribution, variant types, chapter count. Use this for context before reading or to answer 'tell me about this work'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        work_slug: { type: "string", description: "Work slug" },
      },
      required: ["work_slug"],
    },
  },
  {
    name: "read_chapter",
    description:
      "Read the full text of a chapter. Returns the markdown body plus frontmatter metadata. **For reasoning, always read the English translation** — that's the default and what the corpus is curated for. Only request 'original' or 'transliteration' when the user explicitly asked to see the source-language text, or when you need exact wording for a direct quotation alongside the English. Do not reason over romanized or original-script text; reason over English and quote in the source script only when the user asked for it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        work_slug: { type: "string", description: "Work slug" },
        chapter_number: { type: "number", description: "Chapter number (1-indexed)" },
        variant: {
          type: "string",
          enum: ["original", "transliteration", "translation"],
          description: "Which language variant to read. Omit for the default — the curated English (translation when present, else transliteration, else original-script as last resort). Pass 'original' or 'transliteration' ONLY for source-quotation purposes the user explicitly requested.",
        },
      },
      required: ["work_slug", "chapter_number"],
    },
  },
  {
    name: "get_passage",
    description:
      "Get specific paragraphs from a chapter for precise citation. Specify paragraph_ids (stable hashes) or paragraph_range (0-indexed). Returns just the requested paragraphs, not the full chapter. **Default variant is English** — use that for reasoning. If the user asked you to quote a verse in its source script (e.g. 'show me the Sanskrit' or 'give me the original Urdu'), call this tool a second time with variant='original' or 'transliteration' to get the matching source-language paragraphs alongside the English.",
    inputSchema: {
      type: "object" as const,
      properties: {
        work_slug: { type: "string" },
        chapter_number: { type: "number" },
        paragraph_ids: { type: "array", items: { type: "string" }, description: "Array of paragraph IDs (e.g., ['p-a3f9', 'p-b2e1'])" },
        paragraph_range: {
          type: "object",
          properties: {
            start: { type: "number" },
            end: { type: "number" },
          },
          required: ["start", "end"],
          description: "0-indexed paragraph range, inclusive on both ends",
        },
        variant: {
          type: "string",
          enum: ["original", "transliteration", "translation"],
          description: "Defaults to English. Pass 'original' or 'transliteration' only when the user asked for source-script quotation.",
        },
      },
      required: ["work_slug", "chapter_number"],
    },
  },
  {
    name: "search_corpus",
    description:
      "Search across the corpus for a query. **Default scope is 'english'** — search runs against translations + native-English variants because English is the natural reasoning surface. Use scope='all' only when the user explicitly asked you to search source-language text (Sanskrit/Urdu/Old English etc.). Returns snippets with work, chapter, and paragraph_id for citation.\n\n" +
      "**HOW TO QUERY (read this carefully):**\n" +
      "Multiple words in a query are AND — *all* words must appear in the same chapter. Stemming is automatic (running ↔ ran). NO regex, NO placeholders like 'X' or '(.*?)' — pass plain words.\n\n" +
      "**For needle-in-haystack** (matching a quoted passage to its source):\n" +
      "1. Pick a **distinctive 2-3 word phrase** from the quote — proper nouns, rare nouns, or unusual collocations. Avoid common words like 'the', 'and', 'we', 'have'.\n" +
      "2. Search that phrase. If you get 1-3 hits, you've likely found it.\n" +
      "3. If you get 0 hits, try a *different* short phrase from the same quote — the user's wording may be close but not exact, so committing to one phrase that doesn't match is a dead end.\n" +
      "4. Don't search the entire long sentence — Pagefind requires every word to be present, and minor paraphrases will fail.\n\n" +
      "**Worked examples:**\n" +
      "- Quote: 'We have heard of heroes in ages past, of twelve true thanes' → search 'twelve true thanes' or 'turning stars', NOT the full sentence.\n" +
      "- Quote: 'Boar to lift up a submerged Earth' → search 'Boar' alone (rare word in this corpus), or 'submerged Earth'. Don't search 'Boar avatar' — 'avatar' may not be in the translation.\n" +
      "- Quote contains a placeholder X: substitute distinctive *other* words from the surrounding context, never the literal letter 'X'.\n\n" +
      "**Auto-fallback:** if your query has more than 5 words and returns 0 results, the server automatically retries with the 3 rarest tokens from your query and reports that fallback in the response. Look at the `auto_fallback` field of the response.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search term — distinctive 2-3 words is best. Plain text, no regex. Multiple words are AND." },
        scope: { type: "string", enum: ["english", "all"], description: "Default 'english'. Use 'all' only when the user asked to search across original-language/transliteration text." },
        case_sensitive: { type: "boolean", description: "Default false" },
        limit: { type: "number", description: "Max results (default 30)" },
        work_slug: { type: "string", description: "Optionally restrict to a single work" },
      },
      required: ["query"],
    },
  },
  {
    name: "find_related",
    description:
      "Find works related to a given work. When `chapter_number` is provided AND the build-time cross-link index is present, returns content-similar chapters from other works (TF-IDF cosine over English bodies) merged with structural matches (same author/era/genre). Without `chapter_number`, falls back to structural-only. Use this for discovery — 'what else is like this'. Returns up to 5 related entries.",
    inputSchema: {
      type: "object" as const,
      properties: {
        work_slug: { type: "string" },
        chapter_number: { type: "number", description: "Optional — pass to get content-similar matches for that specific chapter (TF-IDF). Without it, results are structural only." },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["work_slug"],
    },
  },
  {
    name: "compare_works",
    description:
      "Compare two works on a topic. Returns relevant chapter pointers from each work, plus metadata. The host LLM does the actual comparison reasoning — this tool just gathers what to compare.",
    inputSchema: {
      type: "object" as const,
      properties: {
        work_slug_a: { type: "string" },
        work_slug_b: { type: "string" },
        topic: { type: "string", description: "Topic to compare on (e.g., 'courage', 'the divine'). Drives chapter selection via search." },
      },
      required: ["work_slug_a", "work_slug_b"],
    },
  },
  {
    name: "read_wiki",
    description:
      "Read the wiki card for a work or specific chapter. Cheap navigation entry-point (~280 tokens). " +
      "Use this BEFORE read_chapter to decide which chapters are worth a deep read. " +
      "Cards are rule-based summaries (TF-IDF, TextRank, n-gram extraction) with verbatim openings, " +
      "closings, and key passages carrying [p-XXXXXX] cite handles. " +
      "Returns the work card when chapter_number is omitted; the chapter card when it's given.",
    inputSchema: {
      type: "object" as const,
      properties: {
        work_slug: { type: "string", description: "Work slug, e.g., 'unknown-manusmrti-347b76'" },
        chapter_number: {
          type: "integer",
          description:
            "Optional. If present, returns the chapter card; otherwise returns the work card with a chapter map.",
        },
      },
      required: ["work_slug"],
    },
  },
  {
    name: "read_wiki_full",
    description:
      "Read the full wiki sheet — same shape as read_wiki but with the heavy statistical detail: " +
      "n-gram tables, NPMI collocations, all refrains, TextRank top-3 + LexRank cross-check, " +
      "boundary signals, stylometric outlier flag. ~1,500 tokens. " +
      "Opt-in for deep analysis; most queries should call read_wiki first and only escalate when needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        work_slug: { type: "string" },
        chapter_number: { type: "integer", description: "Optional. See read_wiki for shape." },
      },
      required: ["work_slug"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Request handlers
// ─────────────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;
  try {
    let result: unknown;
    switch (name) {
      case "list_works":
        result = list_works(corpus, args ?? {});
        break;
      case "list_chapters":
        result = list_chapters(corpus, (args as { work_slug: string }).work_slug);
        break;
      case "get_metadata":
        result = get_metadata(corpus, (args as { work_slug: string }).work_slug);
        break;
      case "read_chapter":
        result = read_chapter(
          corpus,
          (args as { work_slug: string }).work_slug,
          (args as { chapter_number: number }).chapter_number,
          (args as { variant?: "original" | "transliteration" | "translation" }).variant,
        );
        break;
      case "get_passage":
        result = get_passage(
          corpus,
          (args as { work_slug: string }).work_slug,
          (args as { chapter_number: number }).chapter_number,
          (args as { paragraph_ids?: string[] }).paragraph_ids,
          (args as { paragraph_range?: { start: number; end: number } }).paragraph_range,
          (args as { variant?: "original" | "transliteration" | "translation" }).variant,
        );
        break;
      case "search_corpus":
        result = search_corpus(corpus, (args as { query: string }).query, args as Record<string, unknown>);
        break;
      case "find_related":
        result = find_related(
          corpus,
          (args as { work_slug: string }).work_slug,
          (args as { chapter_number?: number }).chapter_number,
          (args as { limit?: number }).limit,
        );
        break;
      case "compare_works":
        result = compare_works(
          corpus,
          (args as { work_slug_a: string }).work_slug_a,
          (args as { work_slug_b: string }).work_slug_b,
          (args as { topic?: string }).topic,
        );
        break;
      case "read_wiki":
        result = read_wiki(
          corpus,
          (args as { work_slug: string }).work_slug,
          (args as { chapter_number?: number }).chapter_number,
        );
        break;
      case "read_wiki_full":
        result = read_wiki_full(
          corpus,
          (args as { work_slug: string }).work_slug,
          (args as { chapter_number?: number }).chapter_number,
        );
        break;
      default:
        throw new MCPError("BAD_QUERY", `Unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    if (err instanceof MCPError) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: { code: err.code, message: err.message, hint: err.hint } }, null, 2),
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Entry
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[falsafa-mcp] ready (stdio transport connected)`);
}

main().catch((err) => {
  console.error("[falsafa-mcp] fatal:", err);
  process.exit(1);
});
