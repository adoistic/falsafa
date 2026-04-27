#!/usr/bin/env bun
/**
 * judge-1000.ts — reusable Sonnet-judge harness for the 1k-question Falsafa MCP eval.
 *
 * The headline numbers in the paper come from this harness. Two locked decisions
 * shape the design:
 *   1. Per-question artifacts on disk (`<run-dir>/_judge/<q-id>.json`) so any
 *      verdict is auditable in isolation and the run is fully resumable.
 *   2. The judge itself uses the falsafa MCP to verify citations — same shape as
 *      `gen-judge-prompts.ts` for the 44-case suite. Quotes get pulled via
 *      `mcp__falsafa__get_passage` and compared verbatim.
 *
 * Two drivers:
 *   - `codex` (default): autonomous via `codex exec --dangerously-bypass-approvals-and-sandbox`.
 *     Falsafa MCP must be in `~/.codex/config.toml` under `[mcp_servers.falsafa]`.
 *   - `subagent`: writes prompt files to /tmp and prints a manifest. Claude Code
 *     sub-agents can only be dispatched from inside an interactive session via the
 *     Agent tool, so this driver punts the actual dispatch to the operator.
 *
 * Usage:
 *   bun run apps/mcp/eval/judge-1000.ts <run-result-dir> \
 *     [--sample-dir <dir>] \
 *     [--driver subagent|codex] \
 *     [--concurrency N] \
 *     [--resume]
 *
 * The `<run-result-dir>` contains `<q-id>.json` files (one per agent answer).
 * `--sample-dir` defaults to `<run-result-dir>/..` (the parent that holds `_sample.json`).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Types — match the per-question shape used in 1k-pilot-sonnet-native/_judge
// ─────────────────────────────────────────────────────────────────────────

interface Question {
  id: string;
  category: string;
  difficulty: string;
  prompt: string;
  rationale: string;
  expected_works: string[];
  quality?: Record<string, unknown>;
}

interface AgentResult {
  answer: string;
  tool_calls?: Array<{ name: string; args: unknown; result_summary?: string }>;
  citations?: Array<{ work_slug: string; chapter_number?: number; paragraph_id?: string }>;
}

interface JudgeVerdict {
  factual_correct: boolean;
  citation_backed: boolean;
  hallucinated: boolean;
  naturalness_1to5: number;
  reasoning: string;
  judge_model: string;
  judge_duration_ms: number;
  /** populated by the harness itself, not the judge */
  error?: string;
}

interface CliArgs {
  runDir: string;
  sampleDir: string;
  driver: "codex" | "subagent";
  concurrency: number;
  resume: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// CLI parsing
// ─────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let driver: CliArgs["driver"] = "codex";
  let concurrency = 5;
  let resume = false;
  let sampleDir: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--driver") {
      const v = argv[++i];
      if (v !== "codex" && v !== "subagent") {
        throw new Error(`--driver must be 'codex' or 'subagent', got '${v}'`);
      }
      driver = v;
    } else if (a === "--concurrency") {
      concurrency = Number(argv[++i]);
      if (!Number.isFinite(concurrency) || concurrency < 1) {
        throw new Error(`--concurrency must be a positive integer`);
      }
    } else if (a === "--sample-dir") {
      sampleDir = argv[++i] ?? null;
    } else if (a === "--resume") {
      resume = true;
    } else if (a?.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else if (a) {
      positional.push(a);
    }
  }

  if (positional.length < 1) {
    throw new Error("Missing <run-result-dir>. See usage at top of file.");
  }
  const runDir = resolve(positional[0]!);
  // Default the sample dir to the parent of the result dir — that's where
  // _sample.json lives in the 1k-pilot-sonnet-native layout.
  const resolvedSampleDir = sampleDir ? resolve(sampleDir) : dirname(runDir);
  return { runDir, sampleDir: resolvedSampleDir, driver, concurrency, resume };
}

// ─────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────

function loadSample(sampleDir: string): Question[] {
  const path = join(sampleDir, "_sample.json");
  if (!existsSync(path)) {
    throw new Error(
      `_sample.json not found at ${path}. Pass --sample-dir if it's elsewhere.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(`${path} must be a JSON array of question objects`);
  }
  return raw as Question[];
}

function loadAgentResult(runDir: string, qid: string): AgentResult | null {
  const path = join(runDir, `${qid}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AgentResult;
  } catch (err) {
    console.error(`! failed to parse ${path}: ${(err as Error).message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Judge prompt — anti-confound: judge MUST output ONLY a fenced ```json block.
// The prompt names the falsafa MCP tools the judge has at hand and pins the
// verdict shape.
// ─────────────────────────────────────────────────────────────────────────

function buildJudgePrompt(q: Question, r: AgentResult): string {
  const toolCallsBlock = (r.tool_calls ?? [])
    .map((t, i) => `${i + 1}. ${t.name}(${JSON.stringify(t.args)})${t.result_summary ? ` -> ${t.result_summary}` : ""}`)
    .join("\n");
  const citationsBlock = (r.citations ?? [])
    .map(
      (c) =>
        `- work_slug=${c.work_slug} chapter=${c.chapter_number ?? "?"} paragraph_id=${c.paragraph_id ?? "(none)"}`,
    )
    .join("\n");

  return `# Falsafa MCP eval — JUDGE pass on question ${q.id}

You are an independent judge for the Falsafa MCP. A different LLM acted as a librarian and
produced the answer below. Your job: decide whether the answer is **substantively correct**,
not just shape-correct, and return ONE fenced \`\`\`json verdict.

## The question

- id: ${q.id}
- category: ${q.category}
- difficulty: ${q.difficulty}

> ${q.prompt}

## Ground truth (you have it; the librarian did NOT)

- expected_works: ${JSON.stringify(q.expected_works)}
- rationale: ${q.rationale}

The librarian was supposed to land on (at minimum) the expected_works above. Other works can be
acceptable additions if they genuinely fit the question, but missing all expected_works is a
factual problem.

## Librarian's answer

${r.answer}

## Librarian's tool_calls trace

${toolCallsBlock || "(no tool calls)"}

## Librarian's structured citations

${citationsBlock || "(no structured citations)"}

## How to verify

You have the falsafa MCP available. Use it to spot-check the librarian's claims:

- \`mcp__falsafa__get_passage\` with the work_slug + chapter + paragraph_ids the librarian cited
  — confirm each cited paragraph_id resolves and the quoted text is verbatim. A fabricated
  paragraph_id (resolves to empty / different text) means the citation is not backed.
- \`mcp__falsafa__read_chapter\` if you need surrounding context.
- \`mcp__falsafa__list_works\` / \`mcp__falsafa__get_metadata\` for factual / negative cases.
- \`mcp__falsafa__search_corpus\` to confirm a quote really exists in the corpus before
  flagging it as fabricated.

Do not penalize a librarian for not citing every expected_work — penalize for fabricated quotes,
wrong work, off-by-chapter retrieval, or hallucinated paragraph_ids.

## Rubric

Return STRICT JSON with these fields:

- **factual_correct** (bool) — does the answer correctly answer the question, grounded in the
  corpus? Loose semantic match is fine. If the answer cites the wrong work or misses the
  ground-truth work entirely without a defensible substitute, false.
- **citation_backed** (bool) — when the question implies a quote/passage is needed: do the
  cited paragraph_ids resolve AND contain the quoted text verbatim? When citations aren't needed
  (e.g. negative / discovery questions), default true unless a citation that IS present is wrong.
- **hallucinated** (bool) — true if the answer invents a work, author, quote, or paragraph_id
  the corpus doesn't contain. Mentioning a non-corpus item only as a denial ("Plato is NOT in
  the corpus") is NOT a hallucination.
- **naturalness_1to5** (int 1-5) — how natural / scholar-readable is the prose? 5 = a Falsafa
  user would be happy. 3 = adequate, robotic. 1 = unreadable.
- **reasoning** (string) — 1-3 sentences. Cite the specific paragraph_id you verified or the
  specific defect. This is the audit trail.

## Output format — STRICT

Output **ONLY** a single fenced \`\`\`json block. No preamble, no postamble, no other prose.

\`\`\`json
{
  "factual_correct": true,
  "citation_backed": true,
  "hallucinated": false,
  "naturalness_1to5": 5,
  "reasoning": "Verified p-xxxxxx contains the quoted text verbatim; expected work landed."
}
\`\`\`
`;
}

// ─────────────────────────────────────────────────────────────────────────
// Verdict parsing — match parseSubagentJson's tolerance for fenced blocks.
// ─────────────────────────────────────────────────────────────────────────

function parseVerdictJson(raw: string): Omit<JudgeVerdict, "judge_model" | "judge_duration_ms"> | null {
  // Try fenced ```json first, then bare JSON object.
  const fenced = raw.match(/```json\s*\n?([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : raw;
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s);
      if (
        typeof v?.factual_correct === "boolean" &&
        typeof v?.citation_backed === "boolean" &&
        typeof v?.hallucinated === "boolean"
      ) {
        return {
          factual_correct: v.factual_correct,
          citation_backed: v.citation_backed,
          hallucinated: v.hallucinated,
          naturalness_1to5: clampInt(v.naturalness_1to5, 1, 5, 3),
          reasoning: typeof v.reasoning === "string" ? v.reasoning : "",
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  };
  const a = tryParse(candidate.trim());
  if (a) return a;
  // Last-ditch: find any object with the right keys anywhere in the output.
  const objMatch = raw.match(/\{[\s\S]*"factual_correct"[\s\S]*"citation_backed"[\s\S]*\}/);
  if (objMatch) return tryParse(objMatch[0]);
  return null;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? Math.round(v) : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

// ─────────────────────────────────────────────────────────────────────────
// Codex driver — autonomous via Bun.spawn(codex exec ...).
// Bypasses approvals/sandbox because the judge needs network + MCP. The MCP
// itself is read-only against the corpus, so this is safe for eval runs.
// ─────────────────────────────────────────────────────────────────────────

const CODEX_MODEL = "gpt-5-codex"; // codex default; surfaced here so it shows up in artifacts
const JUDGE_MODEL_LABEL = "codex/gpt-5-codex"; // recorded in the verdict file

async function dispatchCodex(prompt: string): Promise<{ stdout: string; durationMs: number }> {
  const t0 = Date.now();
  // Use node:child_process.spawn (not Bun.spawn) — Bun.spawn's stdin
  // handling didn't reliably deliver the full prompt before close, so
  // codex saw an empty stdin and exited 1 with "Reading additional
  // input from stdin..." in its banner. The runner harness
  // (run-1000-codex.ts) uses this same node spawn pattern and works.
  const { spawn } = await import("node:child_process");
  return new Promise<{ stdout: string; durationMs: number }>((resolveOut, rejectOut) => {
    const child = spawn(
      "codex",
      [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-C",
        "/Users/siraj/falsafa",
        "-",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (err) => rejectOut(err));
    child.on("close", (exitCode) => {
      const durationMs = Date.now() - t0;
      if (exitCode !== 0) {
        rejectOut(new Error(`codex exec exited ${exitCode}: ${stderr.slice(0, 600)}`));
        return;
      }
      resolveOut({ stdout, durationMs });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Subagent driver — write prompt files to /tmp and print a manifest. The
// operator pipes the manifest into a Claude Code session and dispatches via
// the Agent tool. (Sub-agents are not callable from a TS script.)
// ─────────────────────────────────────────────────────────────────────────

function writeSubagentPromptFile(qid: string, runDir: string, prompt: string): string {
  const runId = runDir.split("/").filter(Boolean).pop() ?? "run";
  const path = `/tmp/judge-${runId}-${qid}.txt`;
  writeFileSync(path, prompt);
  return path;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-question worker
// ─────────────────────────────────────────────────────────────────────────

async function judgeOne(
  q: Question,
  r: AgentResult,
  judgeDir: string,
  driver: "codex" | "subagent",
  runDir: string,
): Promise<{ qid: string; ok: boolean; durationMs: number; error?: string }> {
  const verdictPath = join(judgeDir, `${q.id}.json`);
  const prompt = buildJudgePrompt(q, r);

  if (driver === "subagent") {
    // Subagent driver doesn't run the judge — it stages the prompt for the operator.
    const promptPath = writeSubagentPromptFile(q.id, runDir, prompt);
    return { qid: q.id, ok: true, durationMs: 0, error: `staged: ${promptPath}` };
  }

  try {
    const { stdout, durationMs } = await dispatchCodex(prompt);
    const parsed = parseVerdictJson(stdout);
    if (!parsed) {
      const placeholder: JudgeVerdict = {
        factual_correct: false,
        citation_backed: false,
        hallucinated: false,
        naturalness_1to5: 1,
        reasoning: `judge returned non-JSON. raw[0:400]=${stdout.slice(0, 400).replace(/\s+/g, " ")}`,
        judge_model: JUDGE_MODEL_LABEL,
        judge_duration_ms: durationMs,
        error: "non-JSON judge output",
      };
      writeFileSync(verdictPath, JSON.stringify(placeholder, null, 2));
      return { qid: q.id, ok: false, durationMs, error: "non-JSON judge output" };
    }
    const verdict: JudgeVerdict = {
      ...parsed,
      judge_model: JUDGE_MODEL_LABEL,
      judge_duration_ms: durationMs,
    };
    writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));
    return { qid: q.id, ok: true, durationMs };
  } catch (err) {
    const msg = (err as Error).message;
    const placeholder: JudgeVerdict = {
      factual_correct: false,
      citation_backed: false,
      hallucinated: false,
      naturalness_1to5: 1,
      reasoning: `judge dispatch failed: ${msg}`,
      judge_model: JUDGE_MODEL_LABEL,
      judge_duration_ms: 0,
      error: msg,
    };
    writeFileSync(verdictPath, JSON.stringify(placeholder, null, 2));
    return { qid: q.id, ok: false, durationMs: 0, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Concurrency: roll-your-own pool — Bun.spawn-friendly, no external dep.
// ─────────────────────────────────────────────────────────────────────────

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await worker(items[i]!);
    }
  });
  await Promise.all(lanes);
}

// ─────────────────────────────────────────────────────────────────────────
// Aggregation — same shape philosophy as aggregate-judge.ts: per-category
// breakdown + headline numbers, written to <run-dir>/_score-judge.json.
// ─────────────────────────────────────────────────────────────────────────

interface CategoryAgg {
  pass: number;
  total: number;
  factual_correct: number;
  citation_backed: number;
  hallucinated: number;
  naturalness_sum: number;
}

interface ScoreSummary {
  run_dir: string;
  judge_model: string;
  questions_judged: number;
  questions_total: number;
  factual_correct_count: number;
  citation_backed_count: number;
  hallucinated_count: number;
  naturalness_avg: number;
  pass_count: number;
  pass_rate: number;
  by_category: Record<string, CategoryAgg & { naturalness_avg: number; pass_rate: number }>;
  per_question: Array<{
    id: string;
    category: string;
    factual_correct: boolean;
    citation_backed: boolean;
    hallucinated: boolean;
    naturalness_1to5: number;
    reasoning: string;
  }>;
}

function passes(v: { factual_correct: boolean; citation_backed: boolean; hallucinated: boolean }): boolean {
  // Pass = factually correct AND citation-backed AND not hallucinated. Same axes
  // the haiku-20260427 report headlined on; this is the load-bearing rule.
  return v.factual_correct && v.citation_backed && !v.hallucinated;
}

function aggregate(runDir: string, judgeDir: string, sample: Question[]): ScoreSummary {
  const byCat: Record<string, CategoryAgg> = {};
  const perQ: ScoreSummary["per_question"] = [];
  const qById = new Map(sample.map((q) => [q.id, q]));

  let factual = 0, cite = 0, hall = 0, natSum = 0, passN = 0, judged = 0;
  let judgeModel = "(unknown)";

  for (const q of sample) {
    const path = join(judgeDir, `${q.id}.json`);
    if (!existsSync(path)) continue;
    const v = JSON.parse(readFileSync(path, "utf8")) as JudgeVerdict;
    judged++;
    judgeModel = v.judge_model ?? judgeModel;
    if (v.factual_correct) factual++;
    if (v.citation_backed) cite++;
    if (v.hallucinated) hall++;
    natSum += v.naturalness_1to5;
    const ok = passes(v);
    if (ok) passN++;
    byCat[q.category] ??= {
      pass: 0, total: 0, factual_correct: 0, citation_backed: 0, hallucinated: 0, naturalness_sum: 0,
    };
    const c = byCat[q.category]!;
    c.total++;
    if (ok) c.pass++;
    if (v.factual_correct) c.factual_correct++;
    if (v.citation_backed) c.citation_backed++;
    if (v.hallucinated) c.hallucinated++;
    c.naturalness_sum += v.naturalness_1to5;
    perQ.push({
      id: q.id,
      category: q.category,
      factual_correct: v.factual_correct,
      citation_backed: v.citation_backed,
      hallucinated: v.hallucinated,
      naturalness_1to5: v.naturalness_1to5,
      reasoning: v.reasoning,
    });
  }

  const byCategory: ScoreSummary["by_category"] = {};
  for (const [cat, c] of Object.entries(byCat)) {
    byCategory[cat] = {
      ...c,
      naturalness_avg: c.total > 0 ? c.naturalness_sum / c.total : 0,
      pass_rate: c.total > 0 ? c.pass / c.total : 0,
    };
  }

  // Sort per-question by category then id so the artifact is diffable.
  perQ.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));

  return {
    run_dir: runDir,
    judge_model: judgeModel,
    questions_judged: judged,
    questions_total: sample.length,
    factual_correct_count: factual,
    citation_backed_count: cite,
    hallucinated_count: hall,
    naturalness_avg: judged > 0 ? natSum / judged : 0,
    pass_count: passN,
    pass_rate: judged > 0 ? passN / judged : 0,
    by_category: byCategory,
    per_question: perQ,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.runDir)) {
    throw new Error(`run-result-dir not found: ${args.runDir}`);
  }
  const judgeDir = join(args.runDir, "_judge");
  mkdirSync(judgeDir, { recursive: true });

  const sample = loadSample(args.sampleDir);
  console.log(`# judge-1000`);
  console.log(`run_dir   = ${args.runDir}`);
  console.log(`sample    = ${args.sampleDir}/_sample.json (${sample.length} questions)`);
  console.log(`judge_dir = ${judgeDir}`);
  console.log(`driver    = ${args.driver}`);
  console.log(`concur.   = ${args.concurrency}`);
  console.log(`resume    = ${args.resume}`);
  console.log("");

  // Build the work queue: questions that have a result file but no verdict yet.
  // The `--resume` flag and the default behavior coincide here: we always skip
  // already-judged questions, because partial-credit per-question artifacts
  // are the source of truth. The flag is kept so the CLI surface matches the
  // spec and so a future "force re-judge" mode can flip its meaning.
  const queue: Array<{ q: Question; r: AgentResult }> = [];
  let missingResult = 0;
  let alreadyJudged = 0;
  for (const q of sample) {
    const verdictPath = join(judgeDir, `${q.id}.json`);
    if (existsSync(verdictPath)) {
      alreadyJudged++;
      continue;
    }
    const r = loadAgentResult(args.runDir, q.id);
    if (!r) {
      missingResult++;
      continue;
    }
    queue.push({ q, r });
  }
  console.log(`queued        : ${queue.length}`);
  console.log(`already judged: ${alreadyJudged}`);
  console.log(`missing result: ${missingResult}`);
  console.log("");

  // Subagent driver: stage prompts and print a manifest. Manifest is one row per
  // question so the operator can paste it into a Claude Code session.
  if (args.driver === "subagent") {
    const manifest: Array<{ qid: string; prompt_path: string; verdict_path: string }> = [];
    for (const { q, r } of queue) {
      const prompt = buildJudgePrompt(q, r);
      const promptPath = writeSubagentPromptFile(q.id, args.runDir, prompt);
      manifest.push({
        qid: q.id,
        prompt_path: promptPath,
        verdict_path: join(judgeDir, `${q.id}.json`),
      });
    }
    const manifestPath = join(args.runDir, "_judge-subagent-manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Staged ${manifest.length} prompt files in /tmp.`);
    console.log(`Manifest written to ${manifestPath}.`);
    console.log("");
    console.log("Sub-agents cannot be dispatched from a TS script. Inside an");
    console.log("interactive Claude Code session, dispatch each manifest entry");
    console.log("via the Agent tool (subagent_type=general-purpose, model=sonnet).");
    console.log("Each sub-agent should read the prompt file, run the judge, and");
    console.log("Write its verdict to the verdict_path. Re-run this harness with");
    console.log("--driver codex (or just the aggregator) afterward to roll up.");
    return;
  }

  // Codex driver: run autonomously with a small concurrency pool.
  const t0 = Date.now();
  let done = 0;
  const failures: Array<{ qid: string; error: string }> = [];
  await runPool(queue, args.concurrency, async ({ q, r }) => {
    const res = await judgeOne(q, r, judgeDir, args.driver, args.runDir);
    done++;
    const status = res.ok ? "ok" : "FAIL";
    const ms = res.durationMs.toString().padStart(6);
    console.log(`  [${done}/${queue.length}] ${q.id} ${status} ${ms}ms${res.error ? ` (${res.error.slice(0, 80)})` : ""}`);
    if (!res.ok) failures.push({ qid: q.id, error: res.error ?? "unknown" });
  });
  const elapsedSec = Math.round((Date.now() - t0) / 1000);
  console.log(`\nJudge dispatch finished in ${elapsedSec}s. Failures: ${failures.length}.`);
  if (failures.length > 0) {
    for (const f of failures.slice(0, 10)) {
      console.log(`  - ${f.qid}: ${f.error.slice(0, 200)}`);
    }
  }

  // Aggregate. We do this regardless of failures — a placeholder verdict is
  // already on disk for any failed dispatch.
  const summary = aggregate(args.runDir, judgeDir, sample);
  const summaryPath = join(args.runDir, "_score-judge.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote summary: ${summaryPath}`);
  console.log(`  judged       : ${summary.questions_judged} / ${summary.questions_total}`);
  console.log(`  pass         : ${summary.pass_count} (${(summary.pass_rate * 100).toFixed(1)}%)`);
  console.log(`  factual_ok   : ${summary.factual_correct_count}`);
  console.log(`  citation_ok  : ${summary.citation_backed_count}`);
  console.log(`  hallucinated : ${summary.hallucinated_count}`);
  console.log(`  naturalness  : ${summary.naturalness_avg.toFixed(2)} avg`);
  console.log("");
  console.log("Per-category:");
  for (const [cat, c] of Object.entries(summary.by_category).sort()) {
    console.log(
      `  ${cat.padEnd(20)} ${c.pass}/${c.total} pass  fact=${c.factual_correct}  cite=${c.citation_backed}  halluc=${c.hallucinated}  nat=${c.naturalness_avg.toFixed(2)}`,
    );
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`! ${err.message}`);
    process.exit(1);
  });
}
