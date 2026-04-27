#!/usr/bin/env bun
/**
 * Codex CLI driver harness for the Falsafa MCP black-box eval.
 *
 * One question per `codex exec` child. The MCP attaches via the operator's
 * `~/.codex/config.toml` `[mcp_servers.falsafa]` block — codex inherits it.
 * Codex runs sandboxed, prints final assistant text to stdout, exits. We
 * post-extract the last fenced ```json block and write the canonical
 * `<q-id>.json` ourselves. This is the same capture path the 4-question
 * pilot at runs/multi-model-20260427-230126/codex used; runbook in
 * docs/designs/eval-1000-run-plan.md ("Codex sandbox writes").
 *
 * Why a separate file from run-subagent-evals.ts:
 *   - sub-agent runs are dispatched FROM the host (Claude Code main session)
 *     via the Agent tool — that's a 10–30K-token return per question, fine
 *     for 50 but not for 1000.
 *   - codex runs as a child process — output lands on disk, zero host
 *     context cost. We can launch 1000 in the background overnight.
 *
 * Usage:
 *   bun run apps/mcp/eval/run-1000-codex.ts \
 *     --input eval/questions-revised-1000.json \
 *     --out apps/mcp/eval/runs/1k-codex-$(date +%Y%m%d-%H%M%S) \
 *     [--sample N | --stratified N] \
 *     [--filter category=citation,comparative] \
 *     [--filter difficulty=hard] \
 *     [--resume] \
 *     [--concurrency N]   # default 5
 *     [--model gpt-5.4]   # default codex's default
 *     [--smoke]           # run a 3-question end-to-end smoke test
 *     [--skip-smoke]      # skip the startup codex liveness check
 *
 * See apps/mcp/eval/RUN-1000-CODEX.md for the operator runbook.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNativeMcpPrompt } from "./run-subagent-evals.ts";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface RawQuestion {
  id: string;
  category: string;
  difficulty: string;
  prompt: string;
  rationale?: string;
  expected_works?: string[];
  quality?: unknown;
}

interface CanonicalResult {
  answer: string;
  tool_calls: Array<{ name: string; args: unknown; result_summary?: string }>;
  citations?: Array<{
    work_slug: string;
    chapter_number?: number;
    paragraph_id?: string;
  }>;
}

interface CliOptions {
  input: string;
  out: string;
  sample: number | null;
  stratified: number | null;
  filters: { category: string[] | null; difficulty: string[] | null };
  resume: boolean;
  concurrency: number;
  model: string | null;
  smokeOnly: boolean;
  skipStartupCheck: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

function resolveRepoPath(p: string): string {
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}

// ─────────────────────────────────────────────────────────────────────────
// CLI parsing
// ─────────────────────────────────────────────────────────────────────────

function printUsage(): void {
  process.stderr.write(
    "Usage: bun run apps/mcp/eval/run-1000-codex.ts \\\n" +
      "  --input <path> --out <dir> \\\n" +
      "  [--sample N | --stratified N] \\\n" +
      "  [--filter category=citation,comparative] \\\n" +
      "  [--filter difficulty=hard] \\\n" +
      "  [--resume] [--concurrency N] [--model NAME] \\\n" +
      "  [--smoke] [--skip-smoke]\n",
  );
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    input: "eval/questions-revised-1000.json",
    out: "",
    sample: null,
    stratified: null,
    filters: { category: null, difficulty: null },
    resume: false,
    concurrency: 5,
    model: null,
    smokeOnly: false,
    skipStartupCheck: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = (): string => {
      const v = argv[++i];
      if (v == null) {
        process.stderr.write(`Missing value for ${a}\n`);
        process.exit(2);
      }
      return v;
    };
    switch (a) {
      case "--input":
        opts.input = need();
        break;
      case "--out":
        opts.out = need();
        break;
      case "--sample":
        opts.sample = Number.parseInt(need(), 10);
        break;
      case "--stratified":
        opts.stratified = Number.parseInt(need(), 10);
        break;
      case "--filter": {
        const raw = need();
        const eq = raw.indexOf("=");
        if (eq < 0) {
          process.stderr.write(`--filter expects key=val,val (got ${raw})\n`);
          process.exit(2);
        }
        const key = raw.slice(0, eq);
        const vals = raw
          .slice(eq + 1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (key === "category") opts.filters.category = vals;
        else if (key === "difficulty") opts.filters.difficulty = vals;
        else {
          process.stderr.write(`Unknown filter key: ${key}\n`);
          process.exit(2);
        }
        break;
      }
      case "--resume":
        opts.resume = true;
        break;
      case "--concurrency":
        opts.concurrency = Math.max(1, Number.parseInt(need(), 10));
        break;
      case "--model":
        opts.model = need();
        break;
      case "--smoke":
        opts.smokeOnly = true;
        break;
      case "--skip-smoke":
        opts.skipStartupCheck = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        process.stderr.write(`Unknown arg: ${a}\n`);
        printUsage();
        process.exit(2);
    }
  }
  if (!opts.out) {
    process.stderr.write("--out is required\n");
    printUsage();
    process.exit(2);
  }
  return opts;
}

// ─────────────────────────────────────────────────────────────────────────
// Question selection
// ─────────────────────────────────────────────────────────────────────────

function loadQuestions(path: string): RawQuestion[] {
  const abs = resolveRepoPath(path);
  const raw = readFileSync(abs, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${abs} to be a JSON array, got ${typeof parsed}`);
  }
  return parsed as RawQuestion[];
}

function applyFilters(qs: RawQuestion[], opts: CliOptions): RawQuestion[] {
  let out = qs;
  if (opts.filters.category) {
    const set = new Set(opts.filters.category);
    out = out.filter((q) => set.has(q.category));
  }
  if (opts.filters.difficulty) {
    const set = new Set(opts.filters.difficulty);
    out = out.filter((q) => set.has(q.difficulty));
  }
  return out;
}

/** Stable seeded PRNG so --sample N is reproducible across runs. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function sampleN(qs: RawQuestion[], n: number, seed: number): RawQuestion[] {
  if (n >= qs.length) return [...qs];
  const rng = mulberry32(seed);
  const copy = [...qs];
  shuffleInPlace(copy, rng);
  return copy.slice(0, n);
}

/** Stratified: take ceil(n / categoryCount) per category, then trim to n. */
function stratifiedN(
  qs: RawQuestion[],
  n: number,
  seed: number,
): RawQuestion[] {
  const buckets = new Map<string, RawQuestion[]>();
  for (const q of qs) {
    const arr = buckets.get(q.category) ?? [];
    arr.push(q);
    buckets.set(q.category, arr);
  }
  const cats = [...buckets.keys()].sort();
  const perCat = Math.max(1, Math.ceil(n / cats.length));
  const rng = mulberry32(seed);
  const out: RawQuestion[] = [];
  for (const c of cats) {
    const bucket = [...(buckets.get(c) ?? [])];
    shuffleInPlace(bucket, rng);
    out.push(...bucket.slice(0, perCat));
  }
  shuffleInPlace(out, rng);
  return out.slice(0, n);
}

// ─────────────────────────────────────────────────────────────────────────
// JSON extraction from codex stdout
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find the LAST well-formed fenced ```json block in the codex stdout.
 * Codex prepends a token-trace banner and reasoning; the final answer block
 * is what we want. We scan from the end because earlier blocks might be the
 * shape examples we sent in the prompt, echoed back.
 */
function extractLastJsonBlock(text: string): string | null {
  // Accept ```json ... ``` and tolerant of leading/trailing whitespace.
  const re = /```json\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(text)) !== null) {
    last = m[1] ?? null;
  }
  return last;
}

/** Two checks: (a) JSON parses; (b) has the canonical keys. */
function validateCanonical(
  raw: string,
): { ok: true; value: CanonicalResult } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      reason: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.answer !== "string") {
    return { ok: false, reason: "missing string 'answer'" };
  }
  if (!Array.isArray(obj.tool_calls)) {
    return { ok: false, reason: "missing array 'tool_calls'" };
  }
  if (obj.citations !== undefined && !Array.isArray(obj.citations)) {
    return { ok: false, reason: "'citations' present but not an array" };
  }
  return { ok: true, value: obj as unknown as CanonicalResult };
}

// ─────────────────────────────────────────────────────────────────────────
// Codex spawn — single question
// ─────────────────────────────────────────────────────────────────────────

interface RunOutcome {
  status: "ok" | "err";
  reason?: string;
  duration_ms: number;
  exit_code: number | null;
}

/**
 * Run codex on a single question. Streams stdout/stderr to disk so a 100K-
 * char trace doesn't blow up our memory. Reads the stdout file back AFTER
 * the child exits to do JSON extraction (single-pass, bounded by file size).
 */
function runOneQuestion(
  q: RawQuestion,
  outDir: string,
  promptsDir: string,
  failuresDir: string,
  model: string | null,
): Promise<RunOutcome> {
  return new Promise((resolveOutcome) => {
    const started = Date.now();
    // Prompt path is what the agent SEES referenced in Step A — it's relative
    // to repo root because that's what humans navigate by. Internally we
    // operate on absolute paths.
    const runDirRel = relativizeToRepo(outDir);
    const prompt = buildNativeMcpPrompt({ id: q.id, prompt: q.prompt }, runDirRel);

    const promptPath = join(promptsDir, `${q.id}.txt`);
    writeFileSync(promptPath, prompt);

    const stdoutPath = join(outDir, `${q.id}.stdout`);
    const stderrPath = join(outDir, `${q.id}.stderr`);
    const stdoutStream = createWriteStream(stdoutPath);
    const stderrStream = createWriteStream(stderrPath);

    const args = [
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--cd",
      REPO_ROOT,
    ];
    if (model) args.push("--model", model);
    // `-` tells codex to read the prompt from stdin.
    args.push("-");

    const child = spawn("codex", args, {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);

    // Write prompt to stdin; close it so codex starts processing.
    child.stdin.write(prompt);
    child.stdin.end();

    child.on("error", (err) => {
      const reason = `spawn error: ${err.message}`;
      writeFileSync(join(failuresDir, `${q.id}.txt`), reason);
      resolveOutcome({
        status: "err",
        reason,
        duration_ms: Date.now() - started,
        exit_code: null,
      });
    });

    child.on("close", (code) => {
      // Wait for both streams to flush before reading back.
      const finalize = (): void => {
        const duration_ms = Date.now() - started;
        if (code !== 0) {
          const reason = `codex exit ${code}`;
          writeFileSync(
            join(failuresDir, `${q.id}.txt`),
            `${reason}\n--- last stderr ---\n${tailFile(stderrPath, 4000)}`,
          );
          resolveOutcome({ status: "err", reason, duration_ms, exit_code: code });
          return;
        }
        const stdoutText = readFileSync(stdoutPath, "utf-8");
        const blob = extractLastJsonBlock(stdoutText);
        if (blob == null) {
          const reason = "no fenced ```json block found in stdout";
          writeFileSync(
            join(failuresDir, `${q.id}.txt`),
            `${reason}\n--- last 2KB of stdout ---\n${stdoutText.slice(-2000)}`,
          );
          resolveOutcome({ status: "err", reason, duration_ms, exit_code: code });
          return;
        }
        const v = validateCanonical(blob);
        if (!v.ok) {
          writeFileSync(
            join(failuresDir, `${q.id}.txt`),
            `${v.reason}\n--- extracted block ---\n${blob.slice(0, 4000)}`,
          );
          resolveOutcome({
            status: "err",
            reason: v.reason,
            duration_ms,
            exit_code: code,
          });
          return;
        }
        writeFileSync(
          join(outDir, `${q.id}.json`),
          JSON.stringify(v.value, null, 2),
        );
        resolveOutcome({ status: "ok", duration_ms, exit_code: code });
      };
      // The 'close' event fires after both stdio streams emit 'close' — the
      // pipes will flush before that. But createWriteStream is async, so
      // give it a microtask to settle before reading the file back.
      stdoutStream.end(() => stderrStream.end(finalize));
    });
  });
}

function relativizeToRepo(p: string): string {
  const abs = resolveRepoPath(p);
  if (!abs.startsWith(REPO_ROOT + "/")) return abs;
  return abs.slice(REPO_ROOT.length + 1);
}

function tailFile(path: string, bytes: number): string {
  try {
    const buf = readFileSync(path, "utf-8");
    return buf.length > bytes ? buf.slice(-bytes) : buf;
  } catch {
    return "(could not read)";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Concurrency: tiny worker pool
// ─────────────────────────────────────────────────────────────────────────

interface WorkResult {
  q: RawQuestion;
  outcome: RunOutcome;
  skipped: boolean;
}

async function runPool(
  questions: RawQuestion[],
  outDir: string,
  promptsDir: string,
  failuresDir: string,
  concurrency: number,
  resume: boolean,
  model: string | null,
  total: number,
  startWall: number,
): Promise<WorkResult[]> {
  const results: WorkResult[] = [];
  let cursor = 0;
  let progressTick = 0;
  const tickEvery = Math.max(1, Math.floor(total / 10));

  const log = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  const printProgressIfDue = (): void => {
    const done = results.length;
    if (done === 0) return;
    if (done < progressTick + tickEvery && done < total) return;
    progressTick = done - (done % tickEvery);
    const elapsedMin = (Date.now() - startWall) / 60_000;
    const rate = done / Math.max(elapsedMin, 1 / 60); // q per min
    const remaining = total - done;
    const remMin = remaining / Math.max(rate, 0.0001);
    log(
      `[progress] ${done}/${total} done, ${elapsedMin.toFixed(1)}m elapsed, est ${remMin.toFixed(1)}m remaining`,
    );
  };

  const worker = async (id: number): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= questions.length) return;
      const q = questions[i]!;
      const outPath = join(outDir, `${q.id}.json`);
      if (resume && existsSync(outPath)) {
        results.push({
          q,
          skipped: true,
          outcome: { status: "ok", duration_ms: 0, exit_code: 0 },
        });
        log(`[skip] ${q.id} (resume — result exists)`);
        printProgressIfDue();
        continue;
      }
      const t0 = Date.now();
      log(`[w${id} start] ${q.id} (${q.category}/${q.difficulty})`);
      const outcome = await runOneQuestion(
        q,
        outDir,
        promptsDir,
        failuresDir,
        model,
      );
      const tag = outcome.status === "ok" ? "ok" : "err";
      log(
        `[${tag}] ${q.id} ${outcome.duration_ms}ms${outcome.reason ? `  reason=${outcome.reason}` : ""}`,
      );
      results.push({ q, skipped: false, outcome });
      printProgressIfDue();
      void t0;
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, questions.length) },
      (_, i) => worker(i + 1),
    ),
  );
  return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Codex liveness check
// ─────────────────────────────────────────────────────────────────────────

interface LivenessResult {
  ok: boolean;
  reason?: string;
  codexVersion: string | null;
}

function runCodexLiveness(model: string | null): LivenessResult {
  // Cheap version probe first — catches "codex not on PATH".
  const v = spawnSync("codex", ["--version"], { encoding: "utf-8" });
  if (v.status !== 0) {
    return {
      ok: false,
      reason: `codex --version failed: ${v.stderr || v.error?.message || "unknown"}`,
      codexVersion: null,
    };
  }
  const codexVersion = v.stdout.trim();

  const probePrompt =
    'Use the falsafa MCP to list works by Cynewulf. One line per title.';
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd",
    REPO_ROOT,
  ];
  if (model) args.push("--model", model);
  args.push(probePrompt);

  const r = spawnSync("codex", args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (r.status !== 0) {
    return {
      ok: false,
      reason: `codex liveness exec failed (exit ${r.status}): ${(r.stderr || "").slice(-1000)}`,
      codexVersion,
    };
  }
  const out = (r.stdout || "").toLowerCase();
  // Cynewulf has 4 works in the corpus (Andreas, Christ I/II, Elene,
  // Juliana). At least one title should surface — "andreas" is the most
  // distinctive low-false-positive needle.
  if (!out.includes("andreas") && !out.includes("juliana") && !out.includes("elene")) {
    return {
      ok: false,
      reason:
        "liveness probe ran but did not mention any Cynewulf work. Likely the falsafa MCP did not attach. " +
        "Check ~/.codex/config.toml for [mcp_servers.falsafa].\n" +
        `--- stdout tail ---\n${r.stdout.slice(-2000)}`,
      codexVersion,
    };
  }
  return { ok: true, codexVersion };
}

// ─────────────────────────────────────────────────────────────────────────
// Manifest + summary
// ─────────────────────────────────────────────────────────────────────────

function gitSha(): string {
  const r = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], {
    encoding: "utf-8",
  });
  return r.stdout?.trim() || "unknown";
}

function writeManifest(
  outDir: string,
  opts: CliOptions,
  questions: RawQuestion[],
  codexVersion: string | null,
): void {
  const manifest = {
    timestamp: new Date().toISOString(),
    git_sha: gitSha(),
    driver: "codex",
    codex_version: codexVersion,
    model: opts.model ?? "(codex default)",
    concurrency: opts.concurrency,
    input: opts.input,
    out: relativizeToRepo(outDir),
    sample: opts.sample,
    stratified: opts.stratified,
    filters: opts.filters,
    resume: opts.resume,
    question_count: questions.length,
    question_ids: questions.map((q) => q.id),
  };
  writeFileSync(
    join(outDir, "_manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  // Also dump the question slice we'll run, with ground-truth — needed for
  // post-hoc scoring even if the master JSON file moves.
  writeFileSync(
    join(outDir, "_sample.json"),
    JSON.stringify(questions, null, 2),
  );
}

function writeSummary(
  outDir: string,
  results: WorkResult[],
  totalWallMs: number,
): void {
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  const byCat = new Map<string, { ok: number; failed: number; skipped: number }>();
  const byDiff = new Map<string, { ok: number; failed: number; skipped: number }>();
  for (const r of results) {
    const bumpCat = byCat.get(r.q.category) ?? { ok: 0, failed: 0, skipped: 0 };
    const bumpDiff = byDiff.get(r.q.difficulty) ?? { ok: 0, failed: 0, skipped: 0 };
    if (r.skipped) {
      skipped++;
      bumpCat.skipped++;
      bumpDiff.skipped++;
    } else if (r.outcome.status === "ok") {
      ok++;
      bumpCat.ok++;
      bumpDiff.ok++;
    } else {
      failed++;
      bumpCat.failed++;
      bumpDiff.failed++;
    }
    byCat.set(r.q.category, bumpCat);
    byDiff.set(r.q.difficulty, bumpDiff);
  }
  const summary = {
    timestamp_end: new Date().toISOString(),
    counts: { ok, failed, skipped, total: results.length },
    total_wall_ms: totalWallMs,
    total_wall_min: +(totalWallMs / 60_000).toFixed(2),
    by_category: Object.fromEntries(byCat),
    by_difficulty: Object.fromEntries(byDiff),
    failures: results
      .filter((r) => !r.skipped && r.outcome.status === "err")
      .map((r) => ({ id: r.q.id, reason: r.outcome.reason ?? "(unknown)" })),
  };
  writeFileSync(
    join(outDir, "_summary.json"),
    JSON.stringify(summary, null, 2),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = resolveRepoPath(opts.out);
  const promptsDir = join(outDir, "_prompts");
  const failuresDir = join(outDir, "_failures");

  // Validate input.
  const allQuestions = loadQuestions(opts.input);
  let pool = applyFilters(allQuestions, opts);

  if (opts.smokeOnly) {
    // Reproducible 3-question smoke test: 1 easy, 1 medium, 1 hard
    // (when available), otherwise just the first 3 after stratification.
    pool = stratifiedN(pool, 3, /* seed */ 42);
    process.stdout.write(
      `[smoke] running 3-question smoke test on ${pool.map((q) => q.id).join(", ")}\n`,
    );
  } else if (opts.stratified != null) {
    pool = stratifiedN(pool, opts.stratified, /* seed */ 42);
  } else if (opts.sample != null) {
    pool = sampleN(pool, opts.sample, /* seed */ 42);
  }

  if (pool.length === 0) {
    process.stderr.write("Empty question pool after filters. Aborting.\n");
    process.exit(2);
  }

  // Make output dirs.
  for (const d of [outDir, promptsDir, failuresDir]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }

  // Liveness probe (unless skipped). Catches the most common operator
  // failure: codex installed but `[mcp_servers.falsafa]` block missing.
  let codexVersion: string | null = null;
  if (!opts.skipStartupCheck) {
    process.stdout.write("[liveness] probing codex + falsafa MCP...\n");
    const live = runCodexLiveness(opts.model);
    codexVersion = live.codexVersion;
    if (!live.ok) {
      process.stderr.write(
        `\n[liveness FAILED]\n${live.reason}\n\n` +
          "Operator action: confirm ~/.codex/config.toml contains:\n\n" +
          "  [mcp_servers.falsafa]\n" +
          '  command = "/bin/sh"\n' +
          '  args = ["-c", "exec /Users/siraj/.bun/bin/bun run /Users/siraj/falsafa/apps/mcp/src/index.ts 2>/dev/null"]\n\n' +
          "Then re-run. Use --skip-smoke to bypass this probe (not recommended).\n",
      );
      process.exit(2);
    }
    process.stdout.write(`[liveness] ok — codex ${codexVersion}\n`);
  } else {
    const v = spawnSync("codex", ["--version"], { encoding: "utf-8" });
    codexVersion = v.status === 0 ? v.stdout.trim() : null;
  }

  // Manifest BEFORE the run so a partial run still has a paper trail.
  writeManifest(outDir, opts, pool, codexVersion);

  process.stdout.write(
    `[run] ${pool.length} questions, concurrency ${opts.concurrency}, model ${opts.model ?? "(default)"}\n`,
  );
  const startWall = Date.now();
  const results = await runPool(
    pool,
    outDir,
    promptsDir,
    failuresDir,
    opts.concurrency,
    opts.resume,
    opts.model,
    pool.length,
    startWall,
  );
  const totalWallMs = Date.now() - startWall;
  writeSummary(outDir, results, totalWallMs);

  const ok = results.filter((r) => !r.skipped && r.outcome.status === "ok").length;
  const failed = results.filter((r) => !r.skipped && r.outcome.status === "err").length;
  const skipped = results.filter((r) => r.skipped).length;
  process.stdout.write(
    `\n[done] ${ok} ok, ${failed} failed, ${skipped} skipped — ${(totalWallMs / 60_000).toFixed(1)}m wall\n` +
      `       results: ${relativizeToRepo(outDir)}\n` +
      `       summary: ${relativizeToRepo(join(outDir, "_summary.json"))}\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
