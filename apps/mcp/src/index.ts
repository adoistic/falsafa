#!/usr/bin/env node
/**
 * Falsafa MCP server — stdio transport.
 *
 * Eight librarian-flavored tools so any LLM can navigate the corpus.
 * Run via:  npx @falsafa/mcp
 * Or in Claude Desktop config:
 *   { "mcpServers": { "falsafa": { "command": "npx", "args": ["@falsafa/mcp"] } } }
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
} from "./tools.ts";

// ─────────────────────────────────────────────────────────────────────────
// Server setup
// ─────────────────────────────────────────────────────────────────────────

const corpus = new Corpus();

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
      "Read the full text of a chapter. Returns the markdown body plus frontmatter metadata. For multilingual works, specify variant ('original', 'transliteration', 'translation') or omit for the default variant. Use this when the user wants to actually see the text.",
    inputSchema: {
      type: "object" as const,
      properties: {
        work_slug: { type: "string", description: "Work slug" },
        chapter_number: { type: "number", description: "Chapter number (1-indexed)" },
        variant: {
          type: "string",
          enum: ["original", "transliteration", "translation"],
          description: "Which language variant to read. Omit for default (translation when present, else original).",
        },
      },
      required: ["work_slug", "chapter_number"],
    },
  },
  {
    name: "get_passage",
    description:
      "Get specific paragraphs from a chapter for precise citation. Specify paragraph_ids (stable hashes) or paragraph_range (0-indexed). Returns just the requested paragraphs, not the full chapter. Use this when citing or quoting a specific passage.",
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
        variant: { type: "string", enum: ["original", "transliteration", "translation"] },
      },
      required: ["work_slug", "chapter_number"],
    },
  },
  {
    name: "search_corpus",
    description:
      "Search across the corpus for a query. Default scope is 'english' (translations + native English). Use scope='all' to include original-language and transliteration variants. Returns snippets with work, chapter, and paragraph_id for citation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search term (literal substring or simple regex)" },
        scope: { type: "string", enum: ["english", "all"], description: "Default 'english' for translation+native-English content" },
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
      "Find works related to a given work via structural signals (same author, same era, same genre). Use this for discovery — 'what else is like this'. Returns up to 5 related work pointers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        work_slug: { type: "string" },
        chapter_number: { type: "number", description: "Optional — for chapter-specific relatedness (currently structural-only)" },
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
  console.error(`[falsafa-mcp] ready. corpus=${corpus.rootPath}, works=${corpus.works().length}`);
}

main().catch((err) => {
  console.error("[falsafa-mcp] fatal:", err);
  process.exit(1);
});
