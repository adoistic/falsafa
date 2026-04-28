/**
 * build-eval-json.ts — bundle the per-run eval artifacts into one JSON
 * file for the /eval explorer.
 *
 * Walks `apps/mcp/eval/runs/<run-dir>/<model>/q-*.json` for each
 * --include glob, picks up the corresponding `_judge/q-*.json` verdicts
 * when present, and merges everything into a single `EvalJson` payload
 * keyed by case id. The case prompts come from the canonical question
 * file at `eval/questions-revised-1000.json` (or, for older case sets,
 * from a `_sample.json` next to the run dir, or — last resort —
 * `apps/mcp/eval/cases.json`).
 *
 * Usage:
 *   bun run eval/build-eval-json.ts \
 *     [--out apps/site/public/eval.json] \
 *     [--include 1k-pilot-sonnet-native] \
 *     [--include 1k-stratified-50-sonnet]
 *
 * If no --include is passed, we include every directory under
 * apps/mcp/eval/runs/. Each run dir contributes one model entry, named
 * after the inner-most subdirectory (e.g. .../1k-pilot-sonnet-native/sonnet
 * → model id "1k-pilot-sonnet-native:sonnet").
 *
 * Targets ≤800KB gzipped for the full set; the script logs the actual
 * size and a warning if we go over.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, basename, dirname, join } from "node:path";

interface CliFlags {
  out: string;
  includes: string[];
}

interface CaseSeed {
  id: string;
  category: string;
  difficulty: string;
  prompt: string;
  rationale?: string;
  expected_works: string[];
}

interface ToolCall {
  name: string;
  args: unknown;
  result_summary?: string;
}

interface Citation {
  work_slug: string;
  chapter_number?: number;
  paragraph_id?: string;
}

interface RawResult {
  answer?: string;
  tool_calls?: ToolCall[];
  citations?: Citation[];
  duration_ms?: number;
}

interface RawJudge {
  factual_correct?: boolean;
  citation_backed?: boolean;
  hallucinated?: boolean;
  naturalness_1to5?: number;
  reasoning?: string;
  judge_model?: string;
}

interface OutModel {
  id: string;
  name: string;
  label: string;
}

interface OutCase extends CaseSeed {
  results: Record<string, OutResult>;
}

interface OutResult {
  answer: string;
  tool_calls: ToolCall[];
  citations: Citation[];
  duration_ms: number;
  /**
   * Build-time mechanical scoring: does the answer mention each
   * expected_work slug or its title? Lets the explorer show honest
   * pass/fail rates before the Sonnet judge layer runs. The judge
   * (when present) overrides this.
   */
  mechanical_pass?: boolean;
  judge?: {
    factual_correct: boolean;
    citation_backed: boolean;
    hallucinated: boolean;
    naturalness_1to5: number;
    reasoning: string;
    judge_model: string;
  };
}

function computeMechanicalPass(answer: string, expectedWorks: string[]): boolean {
  if (expectedWorks.length === 0) return true; // no expectation = trivially passes
  const lower = answer.toLowerCase();
  // Pass if every expected work-slug (or its last token, e.g. "manusmrti" from
  // "unknown-manusmrti-347b76") appears in the answer text. Slug match is
  // strict; token match catches answers that name the work in human prose.
  for (const slug of expectedWorks) {
    const slugLower = slug.toLowerCase();
    if (lower.includes(slugLower)) continue;
    // Try a meaningful token from the slug — drop the leading "unknown-" if
    // present, drop the trailing 6-char hash, take the longest middle token.
    const tokens = slug.replace(/^unknown-/, "").split("-").filter((t) => t.length > 3 && !/^[0-9a-f]{6}$/.test(t));
    const longest = tokens.sort((a, b) => b.length - a.length)[0];
    if (longest && lower.includes(longest.toLowerCase())) continue;
    return false;
  }
  return true;
}

const REPO_ROOT = resolve(import.meta.dir, "..");
const RUNS_ROOT = join(REPO_ROOT, "apps/mcp/eval/runs");

function parseFlags(): CliFlags {
  const argv = Bun.argv.slice(2);
  let out = "apps/site/public/eval.json";
  const includes: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--out") {
      out = argv[++i];
    } else if (flag === "--include") {
      includes.push(argv[++i]);
    } else if (flag.startsWith("--out=")) {
      out = flag.slice("--out=".length);
    } else if (flag.startsWith("--include=")) {
      includes.push(flag.slice("--include=".length));
    } else {
      console.warn(`Unknown flag: ${flag}`);
    }
  }
  return { out: resolve(REPO_ROOT, out), includes };
}

function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    console.warn(`Skipping ${path}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * The canonical case catalogue. We try four sources in order:
 *   1. eval/questions-revised-1000.json  (the audited 1k pool)
 *   2. eval/questions-draft-1000.json    (the pre-revision pool)
 *   3. apps/mcp/eval/runs/<dir>/_sample.json (per-run case file)
 *   4. apps/mcp/eval/cases.json          (the v2-expanded 44-case set)
 *
 * Whichever source resolves a case-id first wins. This lets the explorer
 * cover both the 1k pool and older 44-case "category" runs in the same
 * payload without forcing a single unified case-list rewrite.
 */
function loadCaseCatalogue(): Map<string, CaseSeed> {
  const map = new Map<string, CaseSeed>();
  const candidates = [
    join(REPO_ROOT, "eval/questions-revised-1000.json"),
    join(REPO_ROOT, "eval/questions-draft-1000.json"),
  ];

  for (const path of candidates) {
    const arr = loadJson<unknown[]>(path);
    if (!arr) continue;
    for (const raw of arr) {
      const seed = normaliseSeed(raw);
      if (seed && !map.has(seed.id)) map.set(seed.id, seed);
    }
  }

  // Pull in any _sample.json from runs/ as a last-mile fallback.
  if (existsSync(RUNS_ROOT)) {
    for (const dir of readdirSync(RUNS_ROOT)) {
      const samplePath = join(RUNS_ROOT, dir, "_sample.json");
      const arr = loadJson<unknown[]>(samplePath);
      if (!arr) continue;
      for (const raw of arr) {
        const seed = normaliseSeed(raw);
        if (seed && !map.has(seed.id)) map.set(seed.id, seed);
      }
    }
  }

  // The legacy cases.json uses a wrapper { cases: [...] } shape.
  const legacyPath = join(REPO_ROOT, "apps/mcp/eval/cases.json");
  const legacy = loadJson<{ cases?: unknown[] }>(legacyPath);
  if (legacy?.cases) {
    for (const raw of legacy.cases) {
      const seed = normaliseLegacySeed(raw);
      if (seed && !map.has(seed.id)) map.set(seed.id, seed);
    }
  }

  return map;
}

function normaliseSeed(raw: unknown): CaseSeed | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const prompt = typeof r.prompt === "string" ? r.prompt : null;
  if (!id || !prompt) return null;
  return {
    id,
    category: typeof r.category === "string" ? r.category : "uncategorised",
    difficulty: typeof r.difficulty === "string" ? r.difficulty : "unknown",
    prompt,
    rationale: typeof r.rationale === "string" ? r.rationale : undefined,
    expected_works: Array.isArray(r.expected_works)
      ? r.expected_works.filter((w): w is string => typeof w === "string")
      : [],
  };
}

function normaliseLegacySeed(raw: unknown): CaseSeed | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const prompt = typeof r.prompt === "string" ? r.prompt : null;
  if (!id || !prompt) return null;
  return {
    id,
    category: typeof r.category === "string" ? r.category : "uncategorised",
    difficulty: typeof r.difficulty === "string" ? r.difficulty : "unknown",
    prompt,
    rationale: typeof r.notes === "string" ? r.notes : undefined,
    expected_works: [], // legacy cases use expected_answer_contains; not a slug list.
  };
}

interface ResolvedRun {
  /** Stable model id for the EvalJson payload. */
  modelId: string;
  modelName: string;
  modelLabel: string;
  /** Directory containing q-*.json files. */
  resultsDir: string;
  /** Optional matching `_judge` directory. */
  judgeDir: string | null;
}

function resolveRuns(includes: string[]): ResolvedRun[] {
  if (!existsSync(RUNS_ROOT)) {
    throw new Error(`No runs directory at ${RUNS_ROOT}`);
  }
  // Always exclude quarantined / pre-paper-grade runs:
  //   _INVALIDATED-*    — pre-anti-cheat-patch results, not blind, must not ship
  //   *-NOT-BLIND       — known protocol violations
  //   1k-codex-smoke*   — pre-patch smoke tests, superseded
  //   multi-model-*     — pre-patch 4-case named smoke (not 1000-question pool)
  //   1k-rerun-*        — single-case rerun smokes (not statistically meaningful)
  //   haiku-*           — pre-patch small-N runs
  // These are real directories on disk for audit trail, but they're not the
  // results we want readers to browse.
  const isQuarantined = (d: string) =>
    d.startsWith("_INVALIDATED") ||
    d.includes("NOT-BLIND") ||
    d.startsWith("1k-codex-smoke") ||
    d.startsWith("multi-model-") ||
    d.startsWith("1k-rerun-") ||
    d.startsWith("haiku-");
  const allDirs = readdirSync(RUNS_ROOT).filter((d) => {
    if (isQuarantined(d)) return false;
    try {
      return statSync(join(RUNS_ROOT, d)).isDirectory();
    } catch {
      return false;
    }
  });
  const matchingDirs =
    includes.length === 0
      ? allDirs
      : allDirs.filter((d) =>
          includes.some((g) => matchGlob(d, g)),
        );

  const out: ResolvedRun[] = [];
  for (const runDir of matchingDirs) {
    const runPath = join(RUNS_ROOT, runDir);
    const judgeDir = existsSync(join(runPath, "_judge")) ? join(runPath, "_judge") : null;
    // Each model lives in its own subdirectory inside the run dir.
    for (const sub of readdirSync(runPath)) {
      if (sub.startsWith("_")) continue; // _judge, _sample.json, _score-*.json
      const subPath = join(runPath, sub);
      if (!statSync(subPath).isDirectory()) continue;
      const hasQ = readdirSync(subPath).some((f) => /^q-.+\.json$/.test(f) || /\.json$/.test(f));
      if (!hasQ) continue;
      out.push({
        modelId: `${runDir}:${sub}`,
        modelName: humaniseModelName(sub, runDir),
        modelLabel: sub,
        resultsDir: subPath,
        judgeDir,
      });
    }
  }
  if (out.length === 0) {
    throw new Error(
      `No runs matched. includes=${includes.join(",") || "(all)"} — got dirs: ${allDirs.join(", ")}`,
    );
  }
  return out;
}

function humaniseModelName(sub: string, runDir: string): string {
  const named: Record<string, string> = {
    sonnet: "Claude Sonnet 4.6",
    opus: "Claude Opus 4.7",
    haiku: "Claude Haiku 4.5",
    codex: "GPT-5 Codex",
  };
  const human = named[sub] ?? sub;
  return `${human} · ${runDir}`;
}

function matchGlob(name: string, pattern: string): boolean {
  // Tiny glob: literal text, with `*` as a multi-char wildcard.
  // Sufficient for the run-dir matching we want; not a full minimatch.
  if (pattern === name) return true;
  if (!pattern.includes("*")) return false;
  const re = new RegExp(
    "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return re.test(name);
}

function loadResults(run: ResolvedRun): Map<string, OutResult> {
  const map = new Map<string, OutResult>();
  if (!existsSync(run.resultsDir)) return map;

  // Load per-case mechanical pass from `_score-mechanical.json` if present.
  // Look in both the run-root and the model subdir — orchestrator runs put it
  // at the root, older runs at the model dir.
  const scoreCandidates = [
    join(dirname(run.resultsDir), "_score-mechanical.json"),
    join(run.resultsDir, "_score-mechanical.json"),
  ];
  const passById = new Map<string, boolean>();
  for (const sp of scoreCandidates) {
    const score = loadJson<{ per_question?: Array<{ id?: string; pass?: boolean }> }>(sp);
    if (!score?.per_question) continue;
    for (const pq of score.per_question) {
      if (typeof pq?.id === "string" && typeof pq?.pass === "boolean") {
        passById.set(pq.id, pq.pass);
      }
    }
    if (passById.size > 0) break;
  }

  for (const file of readdirSync(run.resultsDir)) {
    if (!file.endsWith(".json")) continue;
    if (file.startsWith("_")) continue;
    const id = file.replace(/\.json$/, "");
    const raw = loadJson<RawResult>(join(run.resultsDir, file));
    if (!raw) continue;
    const out: OutResult = {
      answer: typeof raw.answer === "string" ? raw.answer : "",
      tool_calls: Array.isArray(raw.tool_calls) ? raw.tool_calls : [],
      citations: Array.isArray(raw.citations) ? raw.citations : [],
      duration_ms: typeof raw.duration_ms === "number" ? raw.duration_ms : 0,
    };
    // Prefer the score file's per-case pass (matches /numbers headline).
    if (passById.has(id)) out.mechanical_pass = passById.get(id);
    if (run.judgeDir) {
      const judgePath = join(run.judgeDir, file);
      const j = loadJson<RawJudge>(judgePath);
      if (j) {
        out.judge = {
          factual_correct: !!j.factual_correct,
          citation_backed: !!j.citation_backed,
          hallucinated: !!j.hallucinated,
          naturalness_1to5: typeof j.naturalness_1to5 === "number" ? j.naturalness_1to5 : 0,
          reasoning: typeof j.reasoning === "string" ? j.reasoning : "",
          judge_model: typeof j.judge_model === "string" ? j.judge_model : "claude-sonnet-4.6",
        };
      }
    }
    map.set(id, out);
  }
  return map;
}

function main() {
  const flags = parseFlags();
  console.log(`Building eval.json → ${flags.out}`);
  if (flags.includes.length > 0) {
    console.log(`  --include ${flags.includes.join(", ")}`);
  } else {
    console.log("  (no --include; using all run directories)");
  }

  const catalogue = loadCaseCatalogue();
  console.log(`  catalogue: ${catalogue.size} cases`);

  const runs = resolveRuns(flags.includes);
  console.log(`  runs: ${runs.length}`);

  const cases = new Map<string, OutCase>();
  const models: OutModel[] = [];

  for (const run of runs) {
    models.push({
      id: run.modelId,
      name: run.modelName,
      label: run.modelLabel,
    });
    const results = loadResults(run);
    console.log(`    ${run.modelId}: ${results.size} results`);
    for (const [id, result] of results) {
      let c = cases.get(id);
      if (!c) {
        const seed = catalogue.get(id) ?? {
          id,
          category: "uncategorised",
          difficulty: "unknown",
          prompt: id, // fall back to the id when the prompt is missing
          expected_works: [],
        };
        c = { ...seed, results: {} };
        cases.set(id, c);
      }
      // Stamp mechanical_pass from the case's expected_works. This is the
      // build-time fallback so the explorer renders honest pass rates before
      // the Sonnet judge layer fills in the structured verdicts.
      if (result.mechanical_pass === undefined) {
        result.mechanical_pass = computeMechanicalPass(result.answer, c.expected_works);
      }
      c.results[run.modelId] = result;
    }
  }

  // Stable ordering: sort cases by id so diffs against previous builds
  // stay readable, sort models alphabetically so the verdict-pill column
  // order is predictable.
  const orderedCases = [...cases.values()].sort((a, b) => a.id.localeCompare(b.id));
  models.sort((a, b) => a.id.localeCompare(b.id));

  const payload = {
    version: "1",
    generated_at: new Date().toISOString(),
    models,
    cases: orderedCases,
  };

  // Make sure the output dir exists.
  mkdirSync(dirname(flags.out), { recursive: true });
  const json = JSON.stringify(payload, null, 2);
  writeFileSync(flags.out, json);

  const raw = Buffer.byteLength(json, "utf8");
  const gz = gzipSync(json).length;
  console.log(`  wrote ${orderedCases.length} cases, ${models.length} models`);
  console.log(`  size: ${formatBytes(raw)} raw / ${formatBytes(gz)} gzipped`);
  if (gz > 800 * 1024) {
    console.warn(
      `  ⚠ gzipped size ${formatBytes(gz)} exceeds the 800KB target. Consider trimming long answers/reasoning.`,
    );
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

main();
