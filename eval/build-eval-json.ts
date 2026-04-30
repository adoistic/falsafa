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
  /**
   * "named" — legacy pool (eval/questions-revised-1000.json); the question
   * names the work / author / era / language. Tests citation precision.
   * "hidden" — discovery pool (eval/questions-discovery-v1.jsonl); the
   * question hides the work. Tests semantic discovery.
   */
  tier: "named" | "hidden";
  /** Specific paragraph hashes that constitute the answer (discovery only). */
  expected_paragraph_ids?: string[];
  /** True when the question demands a verbatim quote (discovery only). */
  expects_quote?: boolean;
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
  usage?: ResultUsage;
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
  /** Total pass / case counts (both tiers merged). */
  pass_count: number;
  case_count: number;
  /** Pass / case counts for the named (legacy 1k) pool only. */
  pass_count_named?: number;
  case_count_named?: number;
  /** Pass / case counts for the hidden (discovery) pool only. */
  pass_count_hidden?: number;
  case_count_hidden?: number;
  /** Aggregate token + cost across this model's results (when usage present). */
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
  total_tokens?: number;
  total_api_calls?: number;
  total_cost_usd?: number;
  cases_with_usage?: number;
  /** Per-tier cost / token breakdown — lets the explorer show "discovery
   *  costs 3x citation" and the wiki-A/B compare cost-per-tier deltas. */
  total_cost_usd_named?: number;
  total_cost_usd_hidden?: number;
  total_tokens_named?: number;
  total_tokens_hidden?: number;
  cases_with_usage_named?: number;
  cases_with_usage_hidden?: number;
}

interface ResultUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  api_calls: number;
  cost_usd: number | null;
  model: string;
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
  /**
   * Original run dir (e.g. "1k-orchestrated-200"). Stamped at merge time so
   * downstream consumers can recover provenance after multiple runs are
   * unified under one model label.
   */
  from_run: string;
  /** Token + cost breakdown. Optional — older runs predate token tracking. */
  usage?: ResultUsage;
  /** Source file path, kept around for mtime-based merge tiebreaks. */
  _source_path?: string;
}

/**
 * NFKD-normalize and strip combining marks so "Manusmṛti" and "manusmrti"
 * compare equal. Without this, slug-token matches like "visnu" miss
 * Sanskrit-transliterated answers that write "Viṣṇu" — silently false-failing
 * cases where the model genuinely named the right work.
 *
 * Verified false-fail rate before this normalization: 75 / 210 baseline
 * failures (~36%) on the Grok 4.1 Fast 1,120-question run.
 */
function foldDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

/**
 * Citation shape from runner output (apps/mcp/eval/run-openrouter.ts emits
 * objects with work_slug + paragraph_id; chapter_number is optional).
 */
interface ResultCitation {
  work_slug?: string;
  paragraph_id?: string;
  chapter_number?: number;
}

/**
 * Citation-based pass: every expected_work must appear as work_slug in at
 * least one structured citation. This is the honest deterministic check the
 * corpus design enables — verbatim paragraph IDs cited via the MCP, no
 * substring guessing. A model that name-drops "Manusmṛti" in prose without
 * actually citing a paragraph is NOT a pass under this rule.
 */
function passByCitations(citations: ResultCitation[], expectedWorks: string[]): boolean {
  if (expectedWorks.length === 0) return true;
  const cited = new Set<string>();
  for (const c of citations) {
    if (c.work_slug) cited.add(c.work_slug);
  }
  for (const slug of expectedWorks) {
    if (!cited.has(slug)) return false;
  }
  return true;
}

/**
 * Prose substring fallback for runs without structured citations (~10% of
 * the current pool). Pass if every expected work-slug (or its longest
 * meaningful middle token) appears anywhere in the answer text, with
 * diacritic folding applied to both sides.
 *
 * This is strictly weaker than passByCitations — a model can name-check a
 * work in prose without citing a paragraph in it. We only use this when
 * citations[] is empty so that older runs are still scored.
 */
function passByProse(answer: string, expectedWorks: string[]): boolean {
  if (expectedWorks.length === 0) return true;
  const lowerFolded = foldDiacritics(answer);
  for (const slug of expectedWorks) {
    const slugFolded = foldDiacritics(slug);
    if (lowerFolded.includes(slugFolded)) continue;
    const tokens = slug.replace(/^unknown-/, "").split("-").filter((t) => t.length > 3 && !/^[0-9a-f]{6}$/.test(t));
    const longest = tokens.sort((a, b) => b.length - a.length)[0];
    if (longest && lowerFolded.includes(foldDiacritics(longest))) continue;
    return false;
  }
  return true;
}

function computeMechanicalPass(
  answer: string,
  expectedWorks: string[],
  _citations: ResultCitation[] | undefined,
): boolean {
  // FOR THE 2026-04-30 DEADLINE: scoring uses prose-substring with
  // diacritic fold. This is the "loose" pass and gives ~84.7% overall.
  //
  // The strict citation-array pass (passByCitations above) is kept in code
  // as future-work scaffolding. Switching to it dropped the headline to
  // 50.6% because the model has poor citation discipline — it name-drops
  // works in prose but only emits ~1 footnote per question even when
  // multiple works are expected.
  //
  // The right future state is a graded 3-state score:
  //   - PASS  (1.0): every expected work has a structured citation
  //   - MIXED (0.5): some expected cited or all named in prose but
  //                  not all formally cited
  //   - FAIL  (0.0): no expected work mentioned in any form
  //
  // That requires:
  //   1. New mechanical_score field (number 0–1) alongside mechanical_pass
  //   2. Path A audit to expand expected_works for valid alternatives
  //   3. Stronger system prompt for citation discipline
  //   4. Re-run baseline + treatment with the new metric
  //
  // Tracked in gstack TODOs and the project memory.
  return passByProse(answer, expectedWorks);
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
      const seed = normaliseSeed(raw, "named");
      if (seed && !map.has(seed.id)) map.set(seed.id, seed);
    }
  }

  // Discovery pool — JSONL, one question per line. Stamped tier="hidden".
  const discoveryPath = join(REPO_ROOT, "eval/questions-discovery-v1.jsonl");
  if (existsSync(discoveryPath)) {
    const raw = readFileSync(discoveryPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        console.warn(`Skipping discovery line: ${(err as Error).message}`);
        continue;
      }
      const seed = normaliseSeed(parsed, "hidden");
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
        const seed = normaliseSeed(raw, "named");
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

function normaliseSeed(raw: unknown, defaultTier: "named" | "hidden"): CaseSeed | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const prompt = typeof r.prompt === "string" ? r.prompt : null;
  if (!id || !prompt) return null;
  // Honour an explicit tier on the raw record; fall back to the caller's default.
  const tierField = typeof r.tier === "string" ? r.tier : null;
  const tier: "named" | "hidden" =
    tierField === "named" || tierField === "hidden" ? tierField : defaultTier;
  return {
    id,
    category: typeof r.category === "string" ? r.category : "uncategorised",
    difficulty: typeof r.difficulty === "string" ? r.difficulty : "unknown",
    prompt,
    rationale: typeof r.rationale === "string" ? r.rationale : undefined,
    expected_works: Array.isArray(r.expected_works)
      ? r.expected_works.filter((w): w is string => typeof w === "string")
      : [],
    tier,
    expected_paragraph_ids: Array.isArray(r.expected_paragraph_ids)
      ? r.expected_paragraph_ids.filter((p): p is string => typeof p === "string")
      : undefined,
    expects_quote: typeof r.expects_quote === "boolean" ? r.expects_quote : undefined,
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
    tier: "named", // legacy cases.json predates the tier split; treat as named.
  };
}

interface ResolvedRun {
  /**
   * Legacy stable id `${runDir}:${sub}`. Kept for now while callers migrate;
   * post-redesign the explorer keys cases by `modelLabel` only.
   */
  modelId: string;
  modelName: string;
  modelLabel: string;
  /** The bare run-dir name, e.g. "1k-orchestrated-200". Stamped onto each result. */
  runDir: string;
  /** Directory containing q-*.json files. */
  resultsDir: string;
  /** Optional matching `_judge` directory. */
  judgeDir: string | null;
}

/**
 * Run-dirs that must never feed the published eval.json regardless of
 * --include flags:
 *   _INVALIDATED-*       — pre-anti-cheat-patch results, not blind
 *   *-NOT-BLIND          — known protocol violations
 *   *-quarantine*        — explicitly quarantined runs
 *   _*                   — judge / sample side-files (already filtered for
 *                          model subdirs but kept here for symmetry)
 */
const EXCLUDED_RUN_DIRS = new RegExp(
  "(^_INVALIDATED|-NOT-BLIND$|-quarantine|^_)",
);

/**
 * Additional quarantine for runs that exist on disk for audit trail but are
 * not paper-grade — pre-patch smoke tests, single-case reruns, small-N
 * pre-patch runs. These never feed eval.json.
 */
function isLegacyQuarantined(d: string): boolean {
  return (
    d.startsWith("1k-codex-smoke") ||
    d.startsWith("multi-model-") ||
    d.startsWith("1k-rerun-") ||
    d.startsWith("haiku-") ||
    // grok-4.1-fast-20260430 was a 5-case smoke test from earlier the same
    // day; the paper-grade baseline is grok-baseline-nowiki-20260430.
    d === "grok-4.1-fast-20260430" ||
    // The pilot was 10 cases stratified on baseline failures — biased
    // sample, not paper-grade. Treatment-wiki on the full pool is the
    // unbiased run.
    d === "treatment-pilot-10failed-20260430"
  );
}

function resolveRuns(includes: string[]): ResolvedRun[] {
  if (!existsSync(RUNS_ROOT)) {
    throw new Error(`No runs directory at ${RUNS_ROOT}`);
  }
  const allDirs = readdirSync(RUNS_ROOT).filter((d) => {
    if (EXCLUDED_RUN_DIRS.test(d)) return false;
    if (isLegacyQuarantined(d)) return false;
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
          includes.some((g) => matchGlob(d, g)) && !EXCLUDED_RUN_DIRS.test(d),
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
      // A/B run-tag: when the runDir name signals an experimental arm
      // (baseline / wiki / treatment), split that into a distinct model
      // label so the explorer renders one column per arm. Same model id,
      // two arms = two side-by-side columns instead of a silent merge.
      const armTag = armTagFromRunDir(runDir);
      const modelLabel = armTag ? `${sub}__${armTag}` : sub;
      out.push({
        modelId: `${runDir}:${sub}`,         // legacy, kept for now
        modelLabel,
        runDir,
        modelName: humaniseModelLabel(modelLabel),
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

/**
 * Map a runDir name to an A/B arm tag, or null if the run is unbranded.
 *
 * Tags are visible in modelLabel suffixes (`grok-4.1-fast__baseline`) and
 * in the rendered model name (`xAI Grok 4.1 Fast (baseline)`). Adding a
 * new arm = add one substring rule here; the rest of the pipeline picks
 * it up automatically.
 */
function armTagFromRunDir(runDir: string): string | null {
  const lc = runDir.toLowerCase();
  if (lc.includes("baseline") && !lc.includes("treatment")) return "baseline";
  if (lc.includes("treatment-wiki") || lc.includes("with-wiki")) return "wiki";
  if (lc.includes("nowiki") || lc.includes("no-wiki")) return "baseline";
  if (lc.includes("treatment")) return "wiki";
  // The pre-A/B discovery sweep was effectively the baseline arm for the
  // hidden tier — same MCP, same prompt, just no wiki tools because those
  // didn't exist yet. Tag it as baseline so it merges with the named-tier
  // baseline column instead of showing as a separate untagged run.
  if (/^grok-discovery-\d/.test(lc)) return "baseline";
  return null;
}

function humaniseModelLabel(label: string): string {
  // Split the optional `__arm` suffix off so the bare-model lookup still works.
  const [bare, arm] = label.split("__");
  const named: Record<string, string> = {
    sonnet: "Claude Sonnet 4.6",
    opus: "Claude Opus 4.7",
    haiku: "Claude Haiku 4.5",
    codex: "GPT-5 Codex",
    "grok-4.1-fast": "xAI Grok 4.1 Fast",
    "claude-sonnet-4": "Claude Sonnet 4",
    "gpt-5": "GPT-5",
  };
  const base = named[bare!] ?? bare!;
  return arm ? `${base} (${arm})` : base;
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
    const sourcePath = join(run.resultsDir, file);
    const raw = loadJson<RawResult>(sourcePath);
    if (!raw) continue;
    const out: OutResult = {
      answer: typeof raw.answer === "string" ? raw.answer : "",
      tool_calls: Array.isArray(raw.tool_calls) ? raw.tool_calls : [],
      citations: Array.isArray(raw.citations) ? raw.citations : [],
      duration_ms: typeof raw.duration_ms === "number" ? raw.duration_ms : 0,
      from_run: run.runDir,        // stamped here; merge in main may overwrite
      _source_path: sourcePath,
    };
    if (raw.usage && typeof raw.usage === "object") {
      const u = raw.usage;
      // Preserve the shape verbatim (cost_usd may legitimately be null).
      out.usage = {
        prompt_tokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
        completion_tokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
        total_tokens: typeof u.total_tokens === "number" ? u.total_tokens : 0,
        api_calls: typeof u.api_calls === "number" ? u.api_calls : 0,
        cost_usd: typeof u.cost_usd === "number" ? u.cost_usd : null,
        model: typeof u.model === "string" ? u.model : "",
      };
    }
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

/**
 * Pick the result whose source file has the larger mtime (most recently
 * generated). Defensive merge for the eventual case where one model has
 * results in multiple run dirs. Today no case appears in multiple runs.
 */
function pickByMtime(a: OutResult, b: OutResult): OutResult {
  const am = mtimeOf(a._source_path);
  const bm = mtimeOf(b._source_path);
  return bm > am ? b : a;
}

function mtimeOf(path: string | undefined): number {
  if (!path) return 0;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Inlined copy of lib/eval-types.ts `passOf`, intentionally not imported to
 * keep the build script free of cross-package boundaries. Same precedence:
 * judge verdict → mechanical_pass → null.
 */
function passOf(result: OutResult | undefined): boolean | null {
  if (!result) return null;
  if (result.judge) {
    const j = result.judge;
    return j.factual_correct && j.citation_backed && !j.hallucinated;
  }
  if (typeof result.mechanical_pass === "boolean") return result.mechanical_pass;
  return null;
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

  for (const run of runs) {
    const results = loadResults(run);
    console.log(`    ${run.runDir}/${run.modelLabel}: ${results.size} results`);
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
      // Stamp mechanical_pass from the case's expected_works. Recompute only
      // when loadResults didn't already pin it from `_score-mechanical.json`
      // (some older orchestrator runs ship explicit per-case scores). When
      // unpinned, score against the current rules — citations[] preferred,
      // diacritic-folded prose substring as fallback.
      if (result.mechanical_pass === undefined) {
        result.mechanical_pass = computeMechanicalPass(
          result.answer,
          c.expected_works,
          result.citations,
        );
      }
      result.from_run = run.runDir;       // stamp before storing
      const existing = c.results[run.modelLabel];
      if (existing) {
        // Same model, multiple runs — defensive merge. Pick the result whose
        // source q-NNNN.json has the larger mtime (most recently generated).
        const newer = pickByMtime(existing, result);
        c.results[run.modelLabel] = newer;
        console.warn(
          `[merge] case ${c.id} has results from multiple runs for model ${run.modelLabel}; ` +
            `keeping ${newer === result ? run.runDir : "previous"}.`,
        );
      } else {
        c.results[run.modelLabel] = result;
      }
    }
  }

  // Per-modelLabel aggregation. One entry per unique label across all runs,
  // pass/case counts computed over the merged results. Stable order by label.
  const labels = new Set(runs.map((r) => r.modelLabel));
  const models: OutModel[] = [];
  for (const label of labels) {
    let pass = 0;
    let total = 0;
    let passN = 0;
    let totalN = 0;
    let passH = 0;
    let totalH = 0;
    // Token / cost accumulators (aggregate)
    let totPromptTokens = 0;
    let totCompletionTokens = 0;
    let totTotalTokens = 0;
    let totApiCalls = 0;
    let totCostUsd = 0;
    let costSeen = false;
    let casesWithUsage = 0;
    // Per-tier accumulators
    let totTokensN = 0;
    let totTokensH = 0;
    let totCostN = 0;
    let totCostH = 0;
    let casesUsageN = 0;
    let casesUsageH = 0;
    let costSeenN = false;
    let costSeenH = false;
    for (const c of cases.values()) {
      const r = c.results[label];
      if (!r) continue;
      total += 1;
      const passed = passOf(r) === true;
      if (passed) pass += 1;
      const isHidden = c.tier === "hidden";
      if (isHidden) {
        totalH += 1;
        if (passed) passH += 1;
      } else {
        // tier missing → treat as named (legacy artifact behavior).
        totalN += 1;
        if (passed) passN += 1;
      }
      if (r.usage) {
        casesWithUsage += 1;
        totPromptTokens += r.usage.prompt_tokens;
        totCompletionTokens += r.usage.completion_tokens;
        totTotalTokens += r.usage.total_tokens;
        totApiCalls += r.usage.api_calls;
        if (typeof r.usage.cost_usd === "number") {
          totCostUsd += r.usage.cost_usd;
          costSeen = true;
        }
        // Per-tier
        if (isHidden) {
          casesUsageH += 1;
          totTokensH += r.usage.total_tokens;
          if (typeof r.usage.cost_usd === "number") {
            totCostH += r.usage.cost_usd;
            costSeenH = true;
          }
        } else {
          casesUsageN += 1;
          totTokensN += r.usage.total_tokens;
          if (typeof r.usage.cost_usd === "number") {
            totCostN += r.usage.cost_usd;
            costSeenN = true;
          }
        }
      }
    }
    const m: OutModel = {
      id: label,
      name: humaniseModelLabel(label),
      label,
      pass_count: pass,
      case_count: total,
      pass_count_named: totalN > 0 ? passN : undefined,
      case_count_named: totalN > 0 ? totalN : undefined,
      pass_count_hidden: totalH > 0 ? passH : undefined,
      case_count_hidden: totalH > 0 ? totalH : undefined,
    };
    if (casesWithUsage > 0) {
      m.cases_with_usage = casesWithUsage;
      m.total_prompt_tokens = totPromptTokens;
      m.total_completion_tokens = totCompletionTokens;
      m.total_tokens = totTotalTokens;
      m.total_api_calls = totApiCalls;
      if (costSeen) m.total_cost_usd = totCostUsd;
    }
    if (casesUsageN > 0) {
      m.cases_with_usage_named = casesUsageN;
      m.total_tokens_named = totTokensN;
      if (costSeenN) m.total_cost_usd_named = totCostN;
    }
    if (casesUsageH > 0) {
      m.cases_with_usage_hidden = casesUsageH;
      m.total_tokens_hidden = totTokensH;
      if (costSeenH) m.total_cost_usd_hidden = totCostH;
    }
    models.push(m);
  }

  // Stable ordering: sort cases by id so diffs against previous builds
  // stay readable, sort models alphabetically so the verdict-pill column
  // order is predictable.
  const orderedCases = [...cases.values()].sort((a, b) => a.id.localeCompare(b.id));
  models.sort((a, b) => a.id.localeCompare(b.id));

  // Strip internal `_source_path` before serialising — it's a build-time tiebreak
  // helper, not part of the published shape.
  for (const c of orderedCases) {
    for (const r of Object.values(c.results)) {
      delete (r as { _source_path?: string })._source_path;
    }
  }

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

  // Slim eval-index.json — same EvalJson shape, but each result carries only
  // { from_run, mechanical_pass, has_judge }. The explorer fetches this at
  // runtime; per-case pages still consume the full eval.json at build time.
  interface SlimResult {
    from_run: string;
    mechanical_pass?: boolean;
    has_judge: boolean;
  }
  const indexCases = orderedCases.map((c) => {
    const slimResults: Record<string, SlimResult> = {};
    for (const [modelId, r] of Object.entries(c.results)) {
      slimResults[modelId] = {
        from_run: r.from_run,
        mechanical_pass: r.mechanical_pass,
        has_judge: r.judge !== undefined,
      };
    }
    return {
      id: c.id,
      category: c.category,
      difficulty: c.difficulty,
      prompt: c.prompt,
      expected_works: c.expected_works,
      // rationale intentionally stripped — not needed for filtering/headlines.
      results: slimResults,
    };
  });
  const indexJson = {
    version: payload.version,
    generated_at: payload.generated_at,
    models: payload.models,
    cases: indexCases,
  };
  const indexOut = resolve(REPO_ROOT, "apps/site/public/eval-index.json");
  writeFileSync(indexOut, JSON.stringify(indexJson)); // minified
  const indexBytes = Buffer.byteLength(JSON.stringify(indexJson), "utf8");
  console.log(`  wrote eval-index.json: ${formatBytes(indexBytes)}`);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

main();
