/**
 * EvalJson — the static asset the explorer reads at /eval.json.
 *
 * One file, browser-cached. Built by `eval/build-eval-json.ts` from the
 * per-question artifacts under `apps/mcp/eval/runs/`. The shape is the
 * contract between the build script and the explorer; keep them in sync.
 *
 * No SQL, no DuckDB, no server. The whole audit trail loads in one fetch.
 */

export interface EvalModelMeta {
  /** Stable id used as the key in EvalCase.results. Matches the run-dir model name. */
  id: string;
  /** Human-readable model name (e.g. "Claude Sonnet 4.6"). */
  name: string;
  /** Short label for the verdict pill column header (e.g. "sonnet"). */
  label: string;
  /** Headline pass count over total cases. Computed at build time. */
  pass_count?: number;
  /** Total cases this model has results for. May be < total when a run was partial. */
  case_count?: number;
}

export interface EvalToolCall {
  name: string;
  args: unknown;
  result_summary?: string;
}

export interface EvalCitation {
  work_slug: string;
  chapter_number?: number;
  paragraph_id?: string;
}

export interface EvalJudge {
  factual_correct: boolean;
  citation_backed: boolean;
  hallucinated: boolean;
  /** 1 (robotic / brittle) to 5 (paper-grade prose). */
  naturalness_1to5: number;
  reasoning: string;
  /** Which model judged. e.g. "claude-sonnet-4.6". */
  judge_model: string;
}

export interface EvalCaseResult {
  answer: string;
  tool_calls: EvalToolCall[];
  citations: EvalCitation[];
  duration_ms: number;
  /** Build-time mechanical pass: did the agent's answer mention every expected_work? */
  mechanical_pass?: boolean;
  judge?: EvalJudge;
}

export interface EvalCase {
  id: string;
  category: string;
  difficulty: string;
  prompt: string;
  rationale?: string;
  expected_works: string[];
  /** Keyed by EvalModelMeta.id. Missing key = no run for that model on this case. */
  results: Record<string, EvalCaseResult>;
}

export interface EvalJson {
  version: string;
  generated_at: string;
  models: EvalModelMeta[];
  cases: EvalCase[];
}

/**
 * Derived "pass" verdict for a single (case, model) pair.
 *
 * Precedence (most-specific first):
 *   1. Sonnet judge verdict if present (factual_correct AND citation_backed AND not hallucinated).
 *   2. Build-time mechanical pass — did the answer mention every expected_work?
 *   3. null when neither signal is available, rendered as "—" in the UI.
 *
 * Mechanical-pass is the honest fallback while the judge layer is partial.
 * /numbers and /thesis use the same per-run aggregate; this brings the
 * per-case explorer in line with them.
 */
export function passOf(result: EvalCaseResult | undefined): boolean | null {
  if (!result) return null;
  if (result.judge) {
    const j = result.judge;
    return j.factual_correct && j.citation_backed && !j.hallucinated;
  }
  if (typeof result.mechanical_pass === "boolean") return result.mechanical_pass;
  return null;
}
