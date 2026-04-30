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

export type Arm = "baseline" | "wiki";

/** Extract the A/B arm tag from a model id, or null if untagged. */
export function armOfModelId(modelId: string): Arm | null {
  if (modelId.endsWith("__baseline")) return "baseline";
  if (modelId.endsWith("__wiki")) return "wiki";
  return null;
}
