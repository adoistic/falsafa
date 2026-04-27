#!/usr/bin/env bun
/**
 * MCP-CLI — a CLI wrapper around the falsafa MCP tools so eval sub-agents
 * (which only have shell access) can navigate the corpus the same way an
 * MCP client would.
 *
 * Each tool is a subcommand; arguments are passed as JSON. Output is the
 * raw tool result (the same structured JSON the MCP returns over stdio).
 *
 * Usage:
 *   bun run apps/mcp/eval/mcp-cli.ts list_works
 *   bun run apps/mcp/eval/mcp-cli.ts list_works '{"author":"cynewulf"}'
 *   bun run apps/mcp/eval/mcp-cli.ts list_chapters '{"work_slug":"cynewulf-andreas-07b573"}'
 *   bun run apps/mcp/eval/mcp-cli.ts search_corpus '{"query":"twelve true thanes"}'
 *   bun run apps/mcp/eval/mcp-cli.ts read_chapter '{"work_slug":"cynewulf-andreas-07b573","chapter_number":1}'
 *   bun run apps/mcp/eval/mcp-cli.ts get_passage '{"work_slug":"...","chapter_number":1,"paragraph_range":{"start":0,"end":3}}'
 *   bun run apps/mcp/eval/mcp-cli.ts find_related '{"work_slug":"cynewulf-andreas-07b573","chapter_number":1}'
 *   bun run apps/mcp/eval/mcp-cli.ts compare_works '{"work_slug_a":"...","work_slug_b":"...","topic":"divine"}'
 *   bun run apps/mcp/eval/mcp-cli.ts get_metadata '{"work_slug":"cynewulf-andreas-07b573"}'
 *   bun run apps/mcp/eval/mcp-cli.ts tools     # list all tools + their input schema
 *
 * Output is JSON to stdout. Errors go to stderr with non-zero exit.
 *
 * The CLI imports the tool implementations directly (no stdio transport)
 * because we want sub-agents to interact with the SAME server logic that
 * Claude Desktop / external MCP clients see, not a parallel implementation.
 */

import { Corpus, MCPError } from "../src/corpus.ts";
import {
  list_works,
  list_chapters,
  get_metadata,
  read_chapter,
  get_passage,
  search_corpus,
  find_related,
  compare_works,
} from "../src/tools.ts";

const TOOLS = {
  list_works: { description: "List works with optional filters." },
  list_chapters: { description: "List chapters of a work." },
  get_metadata: { description: "Full metadata + layout/variant counts for a work." },
  read_chapter: { description: "Read full chapter text. Variant: original | transliteration | translation. Default = English." },
  get_passage: { description: "Read specific paragraphs by id or range." },
  search_corpus: { description: "Search English bodies. Use distinctive 2-3 word phrases. Auto-fallback on long-query 0-results." },
  find_related: { description: "Related chapters via TF-IDF + structural fallback." },
  compare_works: { description: "Get pointer chapters for both works on a topic." },
} as const;

function usage(): never {
  console.error("Usage: bun run apps/mcp/eval/mcp-cli.ts <tool> [args-json]");
  console.error("");
  console.error("Tools:");
  for (const [name, info] of Object.entries(TOOLS)) {
    console.error(`  ${name.padEnd(18)} ${info.description}`);
  }
  console.error(`  tools              Print all tools as JSON.`);
  process.exit(2);
}

function parseArgs(): { tool: string; args: Record<string, unknown> } {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage();
  const tool = argv[0]!;
  const rawArgs = argv.slice(1).join(" ").trim();
  let args: Record<string, unknown> = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch (err) {
      console.error(`Invalid JSON args: ${(err as Error).message}`);
      console.error(`Got: ${rawArgs}`);
      process.exit(2);
    }
  }
  return { tool, args };
}

async function main(): Promise<void> {
  const { tool, args } = parseArgs();
  if (tool === "tools") {
    console.log(JSON.stringify(TOOLS, null, 2));
    return;
  }
  if (!(tool in TOOLS)) {
    console.error(`Unknown tool: ${tool}`);
    usage();
  }

  const corpus = new Corpus();
  let result: unknown;
  try {
    switch (tool) {
      case "list_works":
        result = list_works(corpus, args as Parameters<typeof list_works>[1]);
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
        result = search_corpus(
          corpus,
          (args as { query: string }).query,
          args as Parameters<typeof search_corpus>[2],
        );
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
        console.error(`No handler for ${tool}`);
        process.exit(2);
    }
  } catch (err) {
    if (err instanceof MCPError) {
      console.log(JSON.stringify({ error: { code: err.code, message: err.message, hint: err.hint } }, null, 2));
      process.exit(0); // typed errors are NOT process failures — they're a tool result
    }
    console.error(`Tool ${tool} threw:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

main();
