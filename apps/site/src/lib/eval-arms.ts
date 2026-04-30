/**
 * Pure helpers for the eval explorer's A/B-comparison UI.
 *
 * The build pipeline (eval/build-eval-json.ts) tags model ids with
 * `__baseline` / `__wiki` suffixes when a runDir signals an A/B arm.
 * These helpers extract the tag and answer two questions consumers
 * care about: "which arm is this?" and "do we have both arms?".
 *
 * No DOM, no React, no fetching — pure logic, fully unit-testable.
 */

import type { EvalCase } from "./eval-types";
import { passOf } from "./eval-types";

export type Arm = "baseline" | "wiki";

/** Extract the A/B arm tag from a model id, or null if untagged. */
export function armOfModelId(modelId: string): Arm | null {
  if (modelId.endsWith("__baseline")) return "baseline";
  if (modelId.endsWith("__wiki")) return "wiki";
  return null;
}

/**
 * True when `data.models` contains both arms — drives 2-arm UI mode
 * everywhere (header layout, case-row pill count, case detail tabs).
 *
 * Single canonical predicate: every component checks this; no other
 * detection logic exists in the UI. See spec D3.
 */
export function isAbMode(models: { id: string }[]): boolean {
  let hasBaseline = false;
  let hasWiki = false;
  for (const m of models) {
    const arm = armOfModelId(m.id);
    if (arm === "baseline") hasBaseline = true;
    else if (arm === "wiki") hasWiki = true;
    if (hasBaseline && hasWiki) return true;
  }
  return false;
}

/**
 * Per-arm verdict pair for a single case. `null` means "this arm has
 * no result for this case" (i.e. pending — e.g. wiki run is partial).
 *
 * Used by:
 *   - CaseRow rendering (which pill to show per arm)
 *   - filterByCompare (truth-table membership)
 *   - chip-count derivation (live counts on each filter chip)
 *
 * Caller passes the resolved baseline/wiki model ids (typically derived
 * via models.find(m => armOfModelId(m.id) === "baseline") at the top
 * of the explorer); `undefined` means that arm isn't in the models list.
 */
export function armVerdicts(
  c: EvalCase,
  baselineId: string | undefined,
  wikiId: string | undefined,
): { baseline: boolean | null; wiki: boolean | null } {
  return {
    baseline: baselineId ? passOf(c.results[baselineId]) : null,
    wiki: wikiId ? passOf(c.results[wikiId]) : null,
  };
}

/**
 * The 6 selectable modes for the comparison filter chip group.
 * `all` is the default (no filter applied).
 */
export type CompareMode =
  | "all"
  | "flips-pass"
  | "flips-fail"
  | "both-pass"
  | "both-fail"
  | "pending-wiki";

/**
 * Truth table from the spec (Section 2). Returns true iff the case's
 * (baseline, wiki) verdicts are in the set selected by `mode`.
 *
 * `null` semantics: "pending" — that arm has no result for this case.
 * Pending cases NEVER satisfy flips/both modes, only `all` and `pending-wiki`.
 */
export function filterByCompare(
  v: { baseline: boolean | null; wiki: boolean | null },
  mode: CompareMode,
): boolean {
  switch (mode) {
    case "all":
      return true;
    case "flips-pass":
      return v.baseline === false && v.wiki === true;
    case "flips-fail":
      return v.baseline === true && v.wiki === false;
    case "both-pass":
      return v.baseline === true && v.wiki === true;
    case "both-fail":
      return v.baseline === false && v.wiki === false;
    case "pending-wiki":
      return v.wiki === null;
  }
}
