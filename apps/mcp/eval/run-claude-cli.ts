#!/usr/bin/env bun
/**
 * run-claude-cli.ts — Eval runner that wraps Claude Code's `claude --print`
 * CLI to evaluate the published @falsafa/mcp@0.1.2 against the question pool.
 *
 * Mirrors run-openrouter.ts's output shape (per-question JSON in
 * runs/<arm>-<ts>/q-NNNN.json) so build-eval-json.ts treats both runner
 * outputs identically.
 *
 * Usage:
 *   bun run run-claude-cli.ts \
 *     --model claude-sonnet-4-5 \
 *     --treatment wiki \
 *     --run-name sonnet-4.6-via-mcp-20260501-090000 \
 *     [--concurrency 1] [--limit 1120]
 *
 * Treatment values: "wiki" (10-tool whitelist) or "baseline" (8-tool, no wiki).
 *
 * Per-question contract:
 *   1. Spawn `claude --print --bare --mcp-config <pinned> --allowedTools <list>
 *      --model <m> --output-format json` with question on stdin.
 *   2. 5-minute timeout per spawn (SIGKILL on overrun).
 *   3. Parse JSON envelope: result, total_cost_usd, usage{input_tokens,
 *      cache_creation_input_tokens, cache_read_input_tokens, output_tokens}.
 *   4. Synthesize a single UsageStep matching run-openrouter.ts shape.
 *   5. Compute cost from Anthropic list rates (cost_basis annotated).
 *   6. Atomic .tmp + rename write to runs/<run-name>/q-NNNN.json.
 *
 * Resilience:
 *   - Resume-safe: skip questions whose q-NNNN.json already exists.
 *   - Retry on exit code matching 429 / "usage_limit_reached" with 5-min sleep,
 *     max 3 retries, then skip the question.
 *   - Sequential (concurrency 1) by design — Anthropic Max-plan rate limits.
 *   - Skip + log on malformed JSON envelope; resume picks up next run.
 *
 * Cost imputation (Anthropic list rates as of 2026-05-01):
 *   Sonnet 4.6: $3 fresh / $0.30 cached read / $3.75 cache write / $15 output (per 1M)
 *   Haiku 4.5:  $1 fresh / $0.10 cached read / $1.25 cache write / $5  output (per 1M)
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// --------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const MCP_CONFIG = resolve(REPO_ROOT, ".github/scripts/falsafa-mcp-config.json");

const TEN_TOOL_LIST = [
  "mcp__falsafa__list_works",
  "mcp__falsafa__list_chapters",
  "mcp__falsafa__get_metadata",
  "mcp__falsafa__read_chapter",
  "mcp__falsafa__get_passage",
  "mcp__falsafa__search_corpus",
  "mcp__falsafa__find_related",
  "mcp__falsafa__compare_works",
  "mcp__falsafa__read_wiki",
  "mcp__falsafa__read_wiki_full",
].join(",");

const EIGHT_TOOL_LIST = [
  "mcp__falsafa__list_works",
  "mcp__falsafa__list_chapters",
  "mcp__falsafa__get_metadata",
  "mcp__falsafa__read_chapter",
  "mcp__falsafa__get_passage",
  "mcp__falsafa__search_corpus",
  "mcp__falsafa__find_related",
  "mcp__falsafa__compare_works",
].join(",");

/**
 * Anthropic list rates as of 2026-05-01 (USD per 1M tokens).
 *
 * IMPORTANT: when Anthropic changes prices, update both these numbers
 * AND bump the `cost_basis` string in main() (currently
 * "anthropic_list_2026_05_01"). The output JSON's cost_basis field is
 * what makes future cost columns comparable across rate-card changes.
 *
 * Rates source: https://docs.anthropic.com/en/api/pricing (claude-sonnet-4-5
 * + claude-haiku-4-5 endpoints). Cache multipliers per Anthropic Prompt
 * Caching docs: 0.1× (cached read) and 1.25× (cache write) of fresh input.
 */
const RATES = {
  "claude-sonnet-4-5": { fresh: 3.0, cached_read: 0.30, cache_write: 3.75, output: 15.0 },
  "claude-haiku-4-5":  { fresh: 1.0, cached_read: 0.10, cache_write: 1.25, output: 5.0 },
} as const;

const PER_QUESTION_TIMEOUT_MS = 5 * 60_000;     // 5 min
const RATE_LIMIT_SLEEP_MS = 5 * 60_000;         // 5 min
const MAX_RETRIES = 3;

// --------------------------------------------------------------------
// CLI flag parsing
// --------------------------------------------------------------------

interface Flags {
  model: keyof typeof RATES;
  treatment: "wiki" | "baseline";
  runName: string;
  limit?: number;
}

function parseFlags(): Flags {
  const args = process.argv.slice(2);
  let model: string | undefined;
  let treatment: string | undefined;
  let runName: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--model") model = args[++i];
    else if (a === "--treatment") treatment = args[++i];
    else if (a === "--run-name") runName = args[++i];
    else if (a === "--limit") limit = parseInt(args[++i] ?? "", 10);
  }

  if (!model || !(model in RATES)) {
    console.error(`--model required (one of ${Object.keys(RATES).join(", ")})`);
    process.exit(1);
  }
  if (treatment !== "wiki" && treatment !== "baseline") {
    console.error(`--treatment required (wiki | baseline)`);
    process.exit(1);
  }
  if (!runName) {
    console.error(`--run-name required (e.g. sonnet-4.6-via-mcp-20260501-090000)`);
    process.exit(1);
  }
  return { model: model as keyof typeof RATES, treatment, runName, limit };
}

// --------------------------------------------------------------------
// Question pool (mirrors run-openrouter.ts:loadQuestionPool)
// --------------------------------------------------------------------

interface PoolQuestion {
  id: string;
  prompt: string;
  expected_works: string[];
  category?: string;
  difficulty?: string;
  tier?: "named" | "hidden";
}

function loadQuestionPool(): PoolQuestion[] {
  const named = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "eval/questions-revised-1000.json"), "utf8")
  ) as PoolQuestion[];
  const hiddenLines = readFileSync(
    resolve(REPO_ROOT, "eval/questions-discovery-v1.jsonl"), "utf8"
  ).split("\n").filter((l) => l.trim());
  const hidden = hiddenLines.map((l) => JSON.parse(l) as PoolQuestion);
  return [...named, ...hidden];
}

// --------------------------------------------------------------------
// Single-question runner
// --------------------------------------------------------------------

interface ClaudeEnvelope {
  result: string;
  total_cost_usd?: number;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  };
  duration_ms?: number;
  num_turns?: number;
  session_id?: string;
}

type SpawnResult = {
  ok: true;
  envelope: ClaudeEnvelope;
} | {
  ok: false;
  reason: "timeout" | "rate_limit" | "malformed_json" | "non_zero_exit" | "spawn_failed";
  exitCode: number | null;
  signal: string | null;
  stderr: string;
};

async function spawnClaude(
  prompt: string,
  flags: Flags,
): Promise<SpawnResult> {
  const tools = flags.treatment === "wiki" ? TEN_TOOL_LIST : EIGHT_TOOL_LIST;
  const args = [
    "--print",
    "--bare",
    "--mcp-config", MCP_CONFIG,
    "--allowedTools", tools,
    "--model", flags.model,
    "--output-format", "json",
  ];

  return new Promise((res) => {
    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: PER_QUESTION_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => { stdout += c.toString(); });
    proc.stderr.on("data", (c) => { stderr += c.toString(); });

    proc.on("error", () => {
      res({ ok: false, reason: "spawn_failed", exitCode: null, signal: null, stderr });
    });

    proc.on("close", (code, signal) => {
      if (signal === "SIGKILL") {
        return res({ ok: false, reason: "timeout", exitCode: code, signal, stderr });
      }
      if (code !== 0) {
        const lower = stderr.toLowerCase();
        if (lower.includes("usage_limit_reached") || lower.includes("rate limit") || code === 429) {
          return res({ ok: false, reason: "rate_limit", exitCode: code, signal, stderr });
        }
        return res({ ok: false, reason: "non_zero_exit", exitCode: code, signal, stderr });
      }
      try {
        const envelope = JSON.parse(stdout) as ClaudeEnvelope;
        res({ ok: true, envelope });
      } catch {
        res({ ok: false, reason: "malformed_json", exitCode: code, signal, stderr });
      }
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// --------------------------------------------------------------------
// Cost imputation
// --------------------------------------------------------------------

function imputeCost(model: keyof typeof RATES, usage: ClaudeEnvelope["usage"]): number {
  const r = RATES[model];
  // Anthropic Messages API reports input_tokens as UNCACHED input only.
  // cache_creation_input_tokens and cache_read_input_tokens are reported
  // separately. Do NOT subtract; sum the four buckets independently.
  return (
    (usage.input_tokens * r.fresh +
     usage.cache_creation_input_tokens * r.cache_write +
     usage.cache_read_input_tokens * r.cached_read +
     usage.output_tokens * r.output) / 1_000_000
  );
}

// --------------------------------------------------------------------
// Atomic per-question write
// --------------------------------------------------------------------

function writeAtomic(path: string, data: unknown): void {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

// --------------------------------------------------------------------
// Main loop
// --------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseFlags();
  const runDir = resolve(REPO_ROOT, "apps/mcp/eval/runs", flags.runName);
  mkdirSync(runDir, { recursive: true });

  const pool = loadQuestionPool();
  const limit = flags.limit ?? pool.length;
  const questions = pool.slice(0, limit);

  console.error(`[run-claude-cli] model=${flags.model} treatment=${flags.treatment} run=${flags.runName} questions=${questions.length}`);

  // Resume: skip already-done
  const done = new Set(readdirSync(runDir).filter((f) => /^q-.+\.json$/.test(f)).map((f) => f.replace(/\.json$/, "")));
  console.error(`[run-claude-cli] resume: ${done.size} questions already done`);

  let costSum = 0;
  let i = 0;
  for (const q of questions) {
    i++;
    if (done.has(q.id)) continue;

    let attempt = 0;
    let result: SpawnResult | null = null;
    while (attempt < MAX_RETRIES) {
      result = await spawnClaude(q.prompt, flags);
      if (result.ok) break;
      if (result.reason !== "rate_limit") break;
      attempt++;
      console.error(`[run-claude-cli] q=${q.id} rate-limited, sleep ${RATE_LIMIT_SLEEP_MS / 1000}s (retry ${attempt}/${MAX_RETRIES})`);
      await new Promise((res) => setTimeout(res, RATE_LIMIT_SLEEP_MS));
    }

    if (!result || !result.ok) {
      console.error(`[run-claude-cli] q=${q.id} SKIP reason=${result?.reason ?? "unknown"} stderr=${(result?.stderr ?? "").slice(0, 200)}`);
      continue;
    }

    const env = result.envelope;
    const cost_usd = env.total_cost_usd ?? imputeCost(flags.model, env.usage);
    costSum += cost_usd;

    const out = {
      id: q.id,
      run_name: flags.runName,
      model: flags.model,
      treatment: flags.treatment,
      prompt: q.prompt,
      expected_works: q.expected_works,
      category: q.category,
      difficulty: q.difficulty,
      tier: q.tier,
      answer: env.result,
      tool_calls: [],   // Claude CLI doesn't expose per-tool-call breakdowns
      citations: [],    // populated by extractCitations after answer parsed; stub for now
      usage_per_call: [{
        api_call_index: 1,
        trigger: "initial",
        preceded_by: [],
        prompt_tokens: env.usage.input_tokens + env.usage.cache_read_input_tokens,
        completion_tokens: env.usage.output_tokens,
        cached_tokens: env.usage.cache_read_input_tokens,
        cost_usd,
      }],
      usage: {
        prompt_tokens: env.usage.input_tokens + env.usage.cache_read_input_tokens,
        completion_tokens: env.usage.output_tokens,
        total_tokens: env.usage.input_tokens + env.usage.cache_read_input_tokens + env.usage.output_tokens,
        api_calls: 1,
        cost_usd,
        model: flags.model,
      },
      cost_basis: "anthropic_list_2026_05_01",
      duration_ms: env.duration_ms,
    };

    writeAtomic(join(runDir, `${q.id}.json`), out);
    if (i % 10 === 0) {
      console.error(`[run-claude-cli] ${i}/${questions.length} cost=$${costSum.toFixed(2)}`);
    }
  }

  console.error(`[run-claude-cli] DONE total_cost=$${costSum.toFixed(2)}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
