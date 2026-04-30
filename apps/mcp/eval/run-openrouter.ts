#!/usr/bin/env bun
/**
 * Eval runner — calls any tool-using model on OpenRouter against the
 * Falsafa MCP, saves results per-question to disk.
 *
 * Designed so anyone with an OpenRouter key can run it. The model id
 * is a CLI flag, so swapping `x-ai/grok-4.1-fast` → `anthropic/claude-sonnet-4`
 * → `openai/gpt-5` is a one-arg change.
 *
 * ## Usage
 *
 *   export OPENROUTER_API_KEY=sk-or-...
 *
 *   # Pilot (5 questions) — defaults to Grok 4.1 Fast.
 *   bun run apps/mcp/eval/run-openrouter.ts
 *
 *   # Different model, more questions, custom run name.
 *   bun run apps/mcp/eval/run-openrouter.ts \
 *     --model "anthropic/claude-sonnet-4" \
 *     --count 30 \
 *     --run-name "sonnet-rerun-20260429"
 *
 *   # Resume an interrupted run — same command. Questions whose result
 *   # JSON already exists on disk are skipped.
 *
 *   # Custom slice of the pool.
 *   bun run apps/mcp/eval/run-openrouter.ts --start 50 --count 10
 *
 * ## Output
 *
 *   apps/mcp/eval/runs/<run-name>/<model-tag>/q-NNNN.json
 *
 * Each q-NNNN.json matches the EvalCaseResult shape in
 * apps/site/src/lib/eval-types.ts so the existing build-eval-json.ts
 * picks them up directly.
 *
 * ## Resilience
 *
 * - Per-question writes are atomic (write .tmp, rename).
 * - SIGINT (Ctrl-C) flushes the in-flight question's partial state to
 *   q-NNNN.json.partial then exits — the next run skips the partial
 *   and continues. No lost work.
 * - Network / API errors on a single question are caught, logged, and
 *   the question is skipped (no q-NNNN.json written). Re-running picks
 *   it up.
 *
 * ## Cost guardrails
 *
 * - Default to 5 questions (the pilot). Bump --count explicitly for
 *   the full re-run. The full 1,000-question pool against Grok 4.1
 *   Fast is roughly $5-15 in OpenRouter credits at current pricing,
 *   ~1-2 hours wallclock serial. Other models cost more.
 * - Hard cap of 15 tool-call iterations per question. Beyond that we
 *   stop the loop and record whatever the model has produced — keeps
 *   pathological cases from burning tokens forever.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface PoolQuestion {
  id: string;
  category: string;
  difficulty: string;
  prompt: string;
  rationale?: string;
  expected_works: string[];
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface RecordedToolCall {
  name: string;
  args: unknown;
  result_summary?: string;
}

interface RecordedCitation {
  work_slug: string;
  chapter_number?: number;
  paragraph_id?: string;
}

interface CaseResult {
  answer: string;
  tool_calls: RecordedToolCall[];
  citations: RecordedCitation[];
  duration_ms: number;
  from_run: string;
  // Mechanical-pass left for build-eval-json to compute against expected_works.
}

// ─────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────

interface Args {
  model: string;
  count: number;
  start: number;
  runName: string;
  modelTag: string;
  pool: string;
  concurrency: number;
  random: boolean;
  seed: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const opts: Record<string, string> = {};
  const flags: Record<string, true> = {};
  for (let i = 0; i < a.length; i++) {
    const arg = a[i]!;
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
    if (arg === "--random") {
      flags.random = true;
      continue;
    }
    if (arg.startsWith("--")) {
      opts[arg.slice(2)] = a[i + 1] ?? "";
      i++;
    }
  }

  const model = opts.model ?? "x-ai/grok-4.1-fast";
  const count = parseInt(opts.count ?? "5", 10);
  const start = parseInt(opts.start ?? "1", 10);
  const concurrency = parseInt(opts.concurrency ?? "1", 10);
  const seed = parseInt(opts.seed ?? "42", 10);
  // Derive a run-name + model-tag from the model id when not provided.
  // model-tag is the last segment ("grok-4.1-fast"), with non-filesystem-
  // safe chars stripped. run-name defaults to "<model-tag>-YYYYMMDD".
  const modelTag = (opts["model-tag"] ?? model.split("/").pop() ?? "model")
    .replace(/[^a-z0-9.-]/gi, "-");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const runName = opts["run-name"] ?? `${modelTag}-${today}`;
  const pool = opts.pool ?? "eval/questions-revised-1000.json";

  if (!Number.isFinite(count) || count < 1) {
    throw new Error(`--count must be a positive integer; got ${opts.count}`);
  }
  if (!Number.isFinite(start) || start < 1) {
    throw new Error(`--start must be a positive integer; got ${opts.start}`);
  }
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer; got ${opts.concurrency}`);
  }
  return { model, count, start, runName, modelTag, pool, concurrency, random: !!flags.random, seed };
}

const USAGE = `
Usage: OPENROUTER_API_KEY=sk-or-... bun run apps/mcp/eval/run-openrouter.ts [flags]

Flags:
  --model <id>       OpenRouter model id (default: x-ai/grok-4.1-fast)
  --count <n>        Number of questions to run (default: 5 — the pilot)
  --start <n>        1-based index into the pool to start at (default: 1)
  --concurrency <n>  Parallel in-flight questions (default: 1)
  --random           Shuffle the pool with --seed before slicing
  --seed <n>         RNG seed used by --random (default: 42)
  --run-name <s>     Output dir name under apps/mcp/eval/runs/ (default: <model-tag>-YYYYMMDD)
  --model-tag <s>    Override the per-model subdir name (default: derived from --model)
  --pool <path>      Path to question pool JSON or JSONL (default: eval/questions-revised-1000.json)
  --help             Show this help
`.trim();

// ─────────────────────────────────────────────────────────────────────────
// MCP tool definitions (OpenAI-compatible JSON Schema for OpenRouter).
// Descriptions mirror apps/mcp/eval/mcp-cli.ts.
// ─────────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_works",
      description: "List works in the corpus with optional filters by author/era/genre/language.",
      parameters: {
        type: "object",
        properties: {
          author: { type: "string", description: "Author slug filter, e.g. 'cynewulf'." },
          era: { type: "string" },
          genre: { type: "string" },
          language: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_chapters",
      description: "List chapters of a work.",
      parameters: {
        type: "object",
        properties: { work_slug: { type: "string" } },
        required: ["work_slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_metadata",
      description: "Full metadata + layout/variant counts for a work.",
      parameters: {
        type: "object",
        properties: { work_slug: { type: "string" } },
        required: ["work_slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_chapter",
      description:
        "Read full chapter text. Variant: original | transliteration | translation. Default = translation. " +
        "Body is annotated with [p-xxxxxx] paragraph_id markers — use those exact ids for paragraph citations.",
      parameters: {
        type: "object",
        properties: {
          work_slug: { type: "string" },
          chapter_number: { type: "integer" },
          variant: { type: "string", enum: ["original", "transliteration", "translation"] },
        },
        required: ["work_slug", "chapter_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_passage",
      description:
        "Read specific paragraphs by id list or 0-indexed range. Returns each paragraph with a citation_url already attached.",
      parameters: {
        type: "object",
        properties: {
          work_slug: { type: "string" },
          chapter_number: { type: "integer" },
          paragraph_ids: { type: "array", items: { type: "string" } },
          paragraph_range: {
            type: "object",
            properties: { start: { type: "integer" }, end: { type: "integer" } },
            required: ["start", "end"],
          },
          variant: { type: "string", enum: ["original", "transliteration", "translation"] },
        },
        required: ["work_slug", "chapter_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_corpus",
      description:
        "Search English bodies. Use distinctive 2-3 word phrases. Auto-fallback on long-query 0-results.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_related",
      description: "Related chapters via TF-IDF + structural fallback.",
      parameters: {
        type: "object",
        properties: {
          work_slug: { type: "string" },
          chapter_number: { type: "integer" },
          limit: { type: "integer" },
        },
        required: ["work_slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_works",
      description: "Get pointer chapters for both works on a topic.",
      parameters: {
        type: "object",
        properties: {
          work_slug_a: { type: "string" },
          work_slug_b: { type: "string" },
          topic: { type: "string" },
        },
        required: ["work_slug_a", "work_slug_b"],
      },
    },
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────
// System prompt — mirrors apps/site/src/islands/byok/providers/tools.ts:
// FALSAFA_SYSTEM_PROMPT. Hard-coded here so this script has zero
// cross-package imports outside apps/mcp/src/.
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a librarian for the Falsafa corpus — translated philosophical and classical texts. You have access to 8 tools that let you navigate the corpus directly.

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
- **Multi-paragraph passage** — call get_passage with the full \`paragraph_ids\` list or a \`paragraph_range\`. The TOP-LEVEL \`citation_url\` field in the result highlights all of them at once.
- **Whole chapter** — call read_chapter. Its \`citation_url\` is the bare chapter URL.
- **Two separate passages from the same source** — emit two footnotes, [^1] and [^2], with the per-paragraph \`citation_url\` for each.

## Hard rule

NEVER write raw paragraph IDs like \`p-be2857\` or \`p-f22236\` in your final answer prose. They are meaningless to the reader. Always wrap them in a markdown link via the \`citation_url\` field. The IDs are an internal handle, not a citation.

The user's question follows. Use the tools, then answer.`;

// ─────────────────────────────────────────────────────────────────────────
// Tool execution — calls the same MCP implementations the stdio server
// uses, so the model sees identical behavior.
// ─────────────────────────────────────────────────────────────────────────

const corpus = new Corpus();

function executeTool(name: string, args: Record<string, unknown>): unknown {
  try {
    switch (name) {
      case "list_works":
        return list_works(corpus, args as Parameters<typeof list_works>[1]);
      case "list_chapters":
        return list_chapters(corpus, args.work_slug as string);
      case "get_metadata":
        return get_metadata(corpus, args.work_slug as string);
      case "read_chapter":
        return read_chapter(
          corpus,
          args.work_slug as string,
          args.chapter_number as number,
          args.variant as "original" | "transliteration" | "translation" | undefined,
        );
      case "get_passage":
        return get_passage(
          corpus,
          args.work_slug as string,
          args.chapter_number as number,
          args.paragraph_ids as string[] | undefined,
          args.paragraph_range as { start: number; end: number } | undefined,
          args.variant as "original" | "transliteration" | "translation" | undefined,
        );
      case "search_corpus":
        return search_corpus(corpus, args.query as string, args as Parameters<typeof search_corpus>[2]);
      case "find_related":
        return find_related(
          corpus,
          args.work_slug as string,
          args.chapter_number as number | undefined,
          args.limit as number | undefined,
        );
      case "compare_works":
        return compare_works(
          corpus,
          args.work_slug_a as string,
          args.work_slug_b as string,
          args.topic as string | undefined,
        );
      default:
        return { error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } };
    }
  } catch (err) {
    if (err instanceof MCPError) {
      return { error: { code: err.code, message: err.message, hint: err.hint } };
    }
    return {
      error: {
        code: "TOOL_THREW",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// OpenRouter chat completions
// ─────────────────────────────────────────────────────────────────────────

interface OpenRouterResponse {
  choices: Array<{
    message: { content: string | null; tool_calls?: ToolCall[] };
    finish_reason: string;
  }>;
  error?: { message: string; code?: number | string };
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[],
): Promise<OpenRouterResponse> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // OpenRouter recommends app identification headers — purely informational.
      "HTTP-Referer": "https://falsafa.ai",
      "X-Title": "Falsafa eval runner",
    },
    body: JSON.stringify({
      model,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      // Reasonable token budget — Falsafa answers are typically <1000 tokens.
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as OpenRouterResponse;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-question loop
// ─────────────────────────────────────────────────────────────────────────

const MAX_TOOL_ITERATIONS = 15;

async function runQuestion(
  apiKey: string,
  model: string,
  runName: string,
  question: PoolQuestion,
): Promise<CaseResult> {
  const startedAt = Date.now();
  const messages: OpenRouterMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question.prompt },
  ];
  const recordedCalls: RecordedToolCall[] = [];

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const response = await callOpenRouter(apiKey, model, messages);
    if (response.error) {
      throw new Error(`OpenRouter error: ${response.error.message}`);
    }
    const choice = response.choices[0];
    if (!choice) throw new Error("OpenRouter returned no choices");

    const message = choice.message;
    // Push the assistant's turn into the history exactly as it came back so
    // tool_call_id refs line up.
    messages.push({
      role: "assistant",
      content: message.content,
      tool_calls: message.tool_calls,
    });

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const call of message.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          parsedArgs = { _malformed: call.function.arguments };
        }
        const result = executeTool(call.function.name, parsedArgs);
        recordedCalls.push({
          name: call.function.name,
          args: parsedArgs,
          result_summary: summarizeToolResult(call.function.name, result),
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    // No tool calls — model emitted final text.
    const answer = (message.content ?? "").trim();
    return {
      answer,
      tool_calls: recordedCalls,
      citations: extractCitations(answer, recordedCalls),
      duration_ms: Date.now() - startedAt,
      from_run: runName,
    };
  }

  // Hit the iteration cap. Record whatever's there.
  console.warn(`  [warn] hit MAX_TOOL_ITERATIONS=${MAX_TOOL_ITERATIONS}, finalizing`);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
  return {
    answer: (lastAssistant?.content ?? "").toString().trim(),
    tool_calls: recordedCalls,
    citations: extractCitations((lastAssistant?.content ?? "").toString(), recordedCalls),
    duration_ms: Date.now() - startedAt,
    from_run: runName,
  };
}

/**
 * Trim a tool result to a single-line summary for storage. Full results
 * (chapter bodies, search hits) are too big to keep verbatim, but the
 * model already saw them in its context. result_summary is for human
 * skim of the trace.
 */
function summarizeToolResult(toolName: string, result: unknown): string {
  if (!result || typeof result !== "object") return JSON.stringify(result).slice(0, 200);
  const r = result as Record<string, unknown>;
  if (r.error) {
    const e = r.error as { code?: string; message?: string };
    return `error ${e.code ?? "UNKNOWN"}: ${e.message ?? ""}`.slice(0, 200);
  }
  switch (toolName) {
    case "list_works":
      return `Listed ${Array.isArray(r.works) ? r.works.length : "?"} works`;
    case "list_chapters":
      return `Listed ${Array.isArray(r.chapters) ? r.chapters.length : "?"} chapters`;
    case "search_corpus":
      return `Found ${Array.isArray(r.results) ? r.results.length : "?"} hits`;
    case "read_chapter":
      return `Read ch.${r.chapter_number ?? "?"} of ${r.work_slug ?? "?"} (${r.variant ?? "?"})`;
    case "get_passage":
      return `Returned ${Array.isArray(r.passages) ? r.passages.length : "?"} passages`;
    case "find_related":
      return `Found ${Array.isArray(r.related) ? r.related.length : "?"} related`;
    default:
      return JSON.stringify(r).slice(0, 200);
  }
}

/**
 * Extract paragraph_id citations from the answer text. Pairs each
 * `p-XXXXXX` token with the most-recent (work_slug, chapter_number)
 * the model fetched via read_chapter / get_passage. Imperfect for
 * answers that interleave many works, but adequate for the eval.
 */
function extractCitations(
  answer: string,
  toolCalls: ReadonlyArray<RecordedToolCall>,
): RecordedCitation[] {
  const tokens = Array.from(answer.matchAll(/\bp-[0-9a-f]{6}\b/g)).map((m) => m[0]);
  if (tokens.length === 0) return [];
  // Default work/chapter context = the last read_chapter / get_passage call.
  let lastWork: string | undefined;
  let lastChapter: number | undefined;
  for (const tc of toolCalls) {
    const a = tc.args as Record<string, unknown>;
    if (tc.name === "read_chapter" || tc.name === "get_passage") {
      if (typeof a.work_slug === "string") lastWork = a.work_slug;
      if (typeof a.chapter_number === "number") lastChapter = a.chapter_number;
    }
  }
  const seen = new Set<string>();
  const out: RecordedCitation[] = [];
  for (const t of tokens) {
    const key = `${lastWork ?? ""}|${lastChapter ?? ""}|${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ work_slug: lastWork ?? "", chapter_number: lastChapter, paragraph_id: t });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Atomic per-question writes
// ─────────────────────────────────────────────────────────────────────────

function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // parseArgs() handles --help internally and exits before we get here, so
  // --help never trips the missing-key check. Order matters.
  const args = parseArgs();
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENROUTER_API_KEY.");
    console.error("");
    console.error("Two ways to set it:");
    console.error("  1. Edit .env at the repo root, paste your key after OPENROUTER_API_KEY=");
    console.error("     (Bun auto-loads .env. Copy .env.example if you don't have one yet.)");
    console.error("  2. Inline: OPENROUTER_API_KEY=sk-or-... bun run apps/mcp/eval/run-openrouter.ts");
    console.error("");
    console.error("Get a key at https://openrouter.ai/keys");
    console.error("");
    console.error(USAGE);
    process.exit(2);
  }
  const repoRoot = resolve(import.meta.dir, "..", "..", "..");
  const poolPath = resolve(repoRoot, args.pool);
  const outDir = resolve(repoRoot, "apps/mcp/eval/runs", args.runName, args.modelTag);
  mkdirSync(outDir, { recursive: true });

  const pool = loadPool(poolPath);

  // Optional shuffle (deterministic) before slicing.
  let working = pool;
  if (args.random) {
    working = shuffle(pool, args.seed);
  }
  const slice = working.slice(args.start - 1, args.start - 1 + args.count);

  console.log(`runner: ${args.model}`);
  console.log(
    `pool:   ${poolPath} (${pool.length} questions; running ${slice.length} starting at ${args.start}` +
      (args.random ? `, random seed=${args.seed}` : "") +
      `)`,
  );
  console.log(`output: ${outDir}`);
  console.log(`concurrency: ${args.concurrency}`);
  console.log("");

  let done = 0;
  let skipped = 0;
  let failed = 0;
  const overallStart = Date.now();

  // Pre-filter so the in-flight worker count reflects real work, not skips.
  const todo: PoolQuestion[] = [];
  for (const q of slice) {
    const outPath = join(outDir, `${q.id}.json`);
    if (existsSync(outPath)) {
      skipped++;
      console.log(`  [skip] ${q.id} (already done)`);
      continue;
    }
    todo.push(q);
  }

  // Worker pool — N workers pull from a shared cursor.
  let cursor = 0;
  async function worker(workerId: number): Promise<void> {
    void workerId;
    while (true) {
      const i = cursor++;
      if (i >= todo.length) return;
      const q = todo[i]!;
      const outPath = join(outDir, `${q.id}.json`);
      // Guard against another concurrent runner racing us — re-check.
      if (existsSync(outPath)) {
        skipped++;
        console.log(`  [skip] ${q.id} (raced — already done)`);
        continue;
      }
      const tStart = Date.now();
      console.log(`  [start] ${q.id} (${q.category}/${q.difficulty})`);
      try {
        const result = await runQuestion(apiKey, args.model, args.runName, q);
        atomicWriteJson(outPath, result);
        done++;
        const sec = (result.duration_ms / 1000).toFixed(1);
        const tools = result.tool_calls.length;
        const cites = result.citations.length;
        const ans = result.answer.length;
        console.log(
          `  [done]  ${q.id} · ${sec}s · ${tools} tool calls · ${cites} citations · ${ans} chars`,
        );
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        const sec = ((Date.now() - tStart) / 1000).toFixed(1);
        console.log(`  [FAIL]  ${q.id} (${sec}s) ${msg.slice(0, 200)}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(args.concurrency, todo.length || 1) }, (_, i) =>
    worker(i),
  );
  await Promise.all(workers);

  const totalSec = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log("");
  console.log(`done: ${done} new · ${skipped} skipped · ${failed} failed (${totalSec}s)`);
  console.log(`output: ${outDir}`);
  if (failed > 0) process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// Pool loading — supports both .json (array) and .jsonl (one per line).
// ─────────────────────────────────────────────────────────────────────────

function loadPool(poolPath: string): PoolQuestion[] {
  const raw = readFileSync(poolPath, "utf-8");
  if (poolPath.endsWith(".jsonl")) {
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as PoolQuestion);
  }
  return JSON.parse(raw) as PoolQuestion[];
}

// Tiny deterministic LCG-based shuffle — same seed → same order, every run.
function shuffle<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  let state = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// SIGINT handler — leave any partial result for the next run to pick up.
process.on("SIGINT", () => {
  console.log("\n[ctrl-c] stopping. Already-saved q-NNNN.json files are intact; rerun the same command to continue.");
  process.exit(130);
});

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
