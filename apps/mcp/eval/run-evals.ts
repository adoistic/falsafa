/**
 * Falsafa MCP black-box eval harness.
 *
 * Spawns a fresh LLM context (default Claude Sonnet via OpenRouter) with ONLY
 * the falsafa MCP server attached. Poses corpus-questions, captures every
 * tool call, scores each case on the 3-axis rubric from the test plan.
 *
 * Run:
 *   bun run eval/run-evals.ts                       # all 16 cases
 *   bun run eval/run-evals.ts --case factual-cynewulf
 *   EVAL_MODEL=openai/gpt-4o bun run eval/run-evals.ts
 *
 * Requires OPENROUTER_API_KEY in env. Will exit cleanly with a clear message
 * if the key is missing.
 *
 * Per the test plan: failure threshold = any case scoring < 2/3 fails CI.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeCase, type JudgeInput, type JudgeVerdict } from "./judge.ts";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface EvalCase {
  id: string;
  category: string;
  prompt: string;
  expected_tool_calls: string[];
  expected_answer_contains: string[];
  must_not_hallucinate?: string[];
  expects_citation: boolean;
  notes?: string;
}

interface CasesFile {
  version: string;
  cases: EvalCase[];
}

interface ToolCallTrace {
  name: string;
  args: unknown;
  result_preview: string; // first ~400 chars of result text, for the judge
  is_error: boolean;
}

interface CaseRun {
  id: string;
  category: string;
  prompt: string;
  model: string;
  tool_calls: ToolCallTrace[];
  final_answer: string;
  duration_ms: number;
  error?: string;
}

interface ScoredCase extends CaseRun {
  score_a_tools: 0 | 1; // mechanical
  score_b_factual: 0 | 1; // judge
  score_c_citation: 0 | 1; // judge (only if expects_citation)
  score_total: 0 | 1 | 2 | 3;
  passed: boolean; // total >= 2
  judge_reasoning?: string;
  hallucination_detected: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const MCP_ENTRY = resolve(HERE, "..", "src", "index.ts");

const EVAL_MODEL = process.env["EVAL_MODEL"] ?? "anthropic/claude-sonnet-4.5";
const JUDGE_MODEL = process.env["JUDGE_MODEL"] ?? "anthropic/claude-opus-4.5";
const OPENROUTER_API_KEY = process.env["OPENROUTER_API_KEY"];
const MAX_TOOL_CALLS = 10;
const PER_CASE_TIMEOUT_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

function parseArgs(): { caseId?: string; help: boolean } {
  const args = process.argv.slice(2);
  let caseId: string | undefined;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--case" || a === "-c") {
      caseId = args[++i];
    } else if (a === "--help" || a === "-h") {
      help = true;
    }
  }
  return { caseId, help };
}

function printHelp(): void {
  console.log(`
Falsafa MCP eval harness

Usage:
  bun run eval/run-evals.ts                  # run all 16 cases
  bun run eval/run-evals.ts --case <id>      # run a single case by id

Env:
  OPENROUTER_API_KEY   required — your OpenRouter API key
  EVAL_MODEL           default 'anthropic/claude-sonnet-4.5'
  JUDGE_MODEL          default 'anthropic/claude-opus-4.5'

The harness boots the falsafa MCP via stdio, gives the LLM ONLY those tools,
asks each prompt, and scores 3 axes per the test plan. JSON report is written
to apps/mcp/eval/results/<timestamp>.json.
`);
}

// ─────────────────────────────────────────────────────────────────────────
// MCP client wiring
// ─────────────────────────────────────────────────────────────────────────

interface McpHandle {
  client: Client;
  transport: StdioClientTransport;
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
}

async function bootMcp(): Promise<McpHandle> {
  // Spawn the MCP server as a child process via `bun run`. This mirrors how
  // a real client (Claude Desktop) would launch us — we do NOT in-process the
  // server here; that would defeat the black-box premise.
  const transport = new StdioClientTransport({
    command: process.execPath, // bun's own path
    args: ["run", MCP_ENTRY],
    cwd: REPO_ROOT,
    stderr: "pipe",
    env: {
      // Inherit selectively — we want PATH and node-relevant vars,
      // but we don't pollute the child's env with OPENROUTER_API_KEY etc.
      ...Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !k.startsWith("OPENROUTER")),
      ) as Record<string, string>,
    },
  });

  const client = new Client(
    { name: "falsafa-eval-harness", version: "0.0.1" },
    { capabilities: {} },
  );

  // Surface MCP server stderr to our stderr so `[falsafa-mcp] ready ...` is visible.
  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      process.stderr.write(`[mcp-stderr] ${chunk}`);
    });
  }

  await client.connect(transport);
  const { tools } = await client.listTools();
  return { client, transport, tools };
}

async function shutdownMcp(handle: McpHandle): Promise<void> {
  try {
    await handle.client.close();
  } catch {
    /* ignore */
  }
  try {
    await handle.transport.close();
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────────
// OpenRouter chat (function-calling loop)
// ─────────────────────────────────────────────────────────────────────────

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface OpenRouterToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

async function openRouterChat(
  model: string,
  messages: OpenRouterMessage[],
  tools: OpenRouterToolDef[],
): Promise<{
  choices: Array<{
    message: OpenRouterMessage;
    finish_reason: string;
  }>;
}> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://github.com/adoistic/falsafa",
      "X-Title": "Falsafa MCP Eval Harness",
    },
    body: JSON.stringify({
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
      temperature: 0.0,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }
  return res.json() as Promise<{
    choices: Array<{ message: OpenRouterMessage; finish_reason: string }>;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────
// Single-case agentic loop
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an evaluator answering questions about the Falsafa
literary corpus. You have NO prior knowledge of the corpus contents — you must
use the falsafa MCP tools to navigate it. Cite work slugs, chapter numbers,
and (when possible) paragraph_ids in your answers. If a query has no matches,
say so plainly — do not invent works, authors, or quotes that are not in the
corpus.`;

async function runCase(
  mcp: McpHandle,
  c: EvalCase,
): Promise<CaseRun> {
  const start = Date.now();
  const traces: ToolCallTrace[] = [];

  // Convert MCP tool defs → OpenRouter function-calling format.
  const orTools: OpenRouterToolDef[] = mcp.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));

  const messages: OpenRouterMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: c.prompt },
  ];

  let finalAnswer = "";
  let error: string | undefined;

  // Wall-clock cap per case.
  const deadline = Date.now() + PER_CASE_TIMEOUT_MS;

  try {
    for (let i = 0; i < MAX_TOOL_CALLS + 1; i++) {
      if (Date.now() > deadline) {
        error = `case timed out after ${PER_CASE_TIMEOUT_MS}ms`;
        break;
      }
      const completion = await openRouterChat(EVAL_MODEL, messages, orTools);
      const choice = completion.choices[0];
      if (!choice) {
        error = "no choices in OpenRouter response";
        break;
      }
      const msg = choice.message;
      messages.push(msg);

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const call of msg.tool_calls) {
          if (traces.length >= MAX_TOOL_CALLS) {
            error = `exceeded MAX_TOOL_CALLS=${MAX_TOOL_CALLS}`;
            break;
          }
          let parsedArgs: unknown;
          try {
            parsedArgs = call.function.arguments
              ? JSON.parse(call.function.arguments)
              : {};
          } catch {
            parsedArgs = { _raw: call.function.arguments };
          }
          let resultText = "";
          let isError = false;
          try {
            const r = await mcp.client.callTool({
              name: call.function.name,
              arguments: parsedArgs as Record<string, unknown>,
            });
            // r.content is an array of {type, text}.
            const content = (r.content ?? []) as Array<{
              type: string;
              text?: string;
            }>;
            resultText = content.map((c) => c.text ?? "").join("\n");
            isError = Boolean((r as { isError?: boolean }).isError);
          } catch (err) {
            resultText = `[harness error] ${err instanceof Error ? err.message : String(err)}`;
            isError = true;
          }
          traces.push({
            name: call.function.name,
            args: parsedArgs,
            result_preview: resultText.slice(0, 400),
            is_error: isError,
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: resultText,
          });
        }
        if (error) break;
        continue;
      }

      // No tool_calls → terminal assistant message.
      finalAnswer = msg.content ?? "";
      break;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return {
    id: c.id,
    category: c.category,
    prompt: c.prompt,
    model: EVAL_MODEL,
    tool_calls: traces,
    final_answer: finalAnswer,
    duration_ms: Date.now() - start,
    error,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────

function scoreToolAxis(c: EvalCase, run: CaseRun): 0 | 1 {
  // (a) — mechanical. Pass if at least one expected tool name appears in
  // the trace (loose match per the test plan).
  if (c.expected_tool_calls.length === 0) return 1;
  const called = new Set(run.tool_calls.map((t) => t.name));
  for (const expected of c.expected_tool_calls) {
    if (called.has(expected)) return 1;
  }
  return 0;
}

function detectHallucination(c: EvalCase, run: CaseRun): boolean {
  if (!c.must_not_hallucinate) return false;
  const lower = run.final_answer.toLowerCase();
  return c.must_not_hallucinate.some((s) => lower.includes(s.toLowerCase()));
}

async function scoreCase(c: EvalCase, run: CaseRun): Promise<ScoredCase> {
  const score_a = scoreToolAxis(c, run);
  const hallucinated = detectHallucination(c, run);

  let score_b: 0 | 1 = 0;
  let score_c: 0 | 1 = 0;
  let judgeReasoning: string | undefined;

  if (run.error) {
    judgeReasoning = `Skipped judge (run error): ${run.error}`;
  } else {
    const verdict = await judgeCase(
      {
        prompt: c.prompt,
        expected_answer_contains: c.expected_answer_contains,
        expects_citation: c.expects_citation,
        must_not_hallucinate: c.must_not_hallucinate ?? [],
        notes: c.notes ?? "",
        final_answer: run.final_answer,
        tool_call_summary: run.tool_calls.map((t) => `${t.name}(${JSON.stringify(t.args)})`).join("\n"),
      },
      {
        model: JUDGE_MODEL,
        apiKey: OPENROUTER_API_KEY!,
      },
    );
    score_b = verdict.factual_correct ? 1 : 0;
    score_c = c.expects_citation && verdict.citation_backed ? 1 : 0;
    if (!c.expects_citation) score_c = 1; // not applicable → free point
    judgeReasoning = verdict.reasoning;
  }

  if (hallucinated) score_b = 0;

  const total = (score_a + score_b + score_c) as 0 | 1 | 2 | 3;
  return {
    ...run,
    score_a_tools: score_a,
    score_b_factual: score_b,
    score_c_citation: score_c,
    score_total: total,
    passed: total >= 2,
    judge_reasoning: judgeReasoning,
    hallucination_detected: hallucinated,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function printCaseResult(r: ScoredCase): void {
  const mark = r.passed ? "PASS" : "FAIL";
  const tools = r.tool_calls.map((t) => t.name).join(",") || "(none)";
  console.log(
    `${mark} ${pad(r.id, 38)} [${r.score_total}/3]  ` +
      `a=${r.score_a_tools} b=${r.score_b_factual} c=${r.score_c_citation}  ` +
      `tools=[${tools}]  ${r.duration_ms}ms` +
      (r.error ? `  ERR=${r.error}` : "") +
      (r.hallucination_detected ? "  HALLUCINATION" : ""),
  );
}

function printSummary(results: ScoredCase[]): void {
  const totalScore = results.reduce((acc, r) => acc + r.score_total, 0);
  const maxScore = results.length * 3;
  const passes = results.filter((r) => r.passed).length;
  const fails = results.length - passes;
  const totalMs = results.reduce((acc, r) => acc + r.duration_ms, 0);
  console.log("");
  console.log("─".repeat(80));
  console.log(
    `SUMMARY  ${passes}/${results.length} pass  |  ${totalScore}/${maxScore} pts  |  ${(totalMs / 1000).toFixed(1)}s wall`,
  );
  if (fails > 0) {
    console.log(`FAILED CASES:`);
    for (const r of results.filter((x) => !x.passed)) {
      console.log(`  - ${r.id} [${r.score_total}/3]  ${r.judge_reasoning ?? r.error ?? ""}`);
    }
  }
  console.log("─".repeat(80));
}

function writeReport(results: ScoredCase[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(HERE, "results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${stamp}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        eval_model: EVAL_MODEL,
        judge_model: JUDGE_MODEL,
        case_count: results.length,
        passes: results.filter((r) => r.passed).length,
        total_score: results.reduce((acc, r) => acc + r.score_total, 0),
        max_score: results.length * 3,
        results,
      },
      null,
      2,
    ),
  );
  return path;
}

// ─────────────────────────────────────────────────────────────────────────
// Entry
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { caseId, help } = parseArgs();
  if (help) {
    printHelp();
    process.exit(0);
  }

  if (!OPENROUTER_API_KEY) {
    console.error(
      "OPENROUTER_API_KEY is not set. The eval harness needs OpenRouter to drive the LLM.",
    );
    console.error("Get a key at https://openrouter.ai and re-run with:");
    console.error("  OPENROUTER_API_KEY=sk-or-... bun run eval/run-evals.ts");
    // Per the test plan, on CI when EVALS_REQUIRED=true we exit non-zero;
    // otherwise (e.g. external contributor PRs) we exit 0 with a clear skip.
    if (process.env["EVALS_REQUIRED"] === "true") {
      process.exit(2);
    }
    process.exit(0);
  }

  const casesPath = join(HERE, "cases.json");
  const cases = (JSON.parse(readFileSync(casesPath, "utf-8")) as CasesFile).cases;
  const filtered = caseId ? cases.filter((c) => c.id === caseId) : cases;
  if (filtered.length === 0) {
    console.error(`No case matched id=${caseId}`);
    process.exit(1);
  }

  console.log(
    `Falsafa MCP eval — model=${EVAL_MODEL} judge=${JUDGE_MODEL} cases=${filtered.length}`,
  );

  const mcp = await bootMcp();
  console.log(`MCP ready — ${mcp.tools.length} tools advertised`);

  // Clean shutdown on SIGINT / SIGTERM. Without this, a Ctrl-C during the
  // OpenRouter call would orphan the bun child process running the MCP.
  let shutting = false;
  const cleanup = async (): Promise<void> => {
    if (shutting) return;
    shutting = true;
    await shutdownMcp(mcp);
    process.exit(130);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const results: ScoredCase[] = [];
  try {
    for (const c of filtered) {
      console.log(`\n→ ${c.id} (${c.category})`);
      const run = await runCase(mcp, c);
      const scored = await scoreCase(c, run);
      results.push(scored);
      printCaseResult(scored);
    }
  } finally {
    await shutdownMcp(mcp);
  }

  printSummary(results);
  const reportPath = writeReport(results);
  console.log(`Report: ${reportPath}`);

  const allPass = results.every((r) => r.passed);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
