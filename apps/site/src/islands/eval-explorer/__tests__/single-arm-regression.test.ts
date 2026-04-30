/**
 * IRON RULE regression test from /plan-eng-review 2026-04-30.
 *
 * The eval A/B UI redesign modifies an existing path: today the
 * EvalExplorer renders for a single model. After this PR, it renders
 * differently when two A/B arms are present — but it MUST render
 * identically to today when only one arm is present.
 *
 * This test fixes that contract by locking down the structural
 * invariants of today's EvalExplorer.tsx source.
 *
 *   - One verdict pill per case row, not two.
 *   - Pass/fail/unjudged radiogroup in the FilterBar (today's chips).
 *   - No comparison-chip group (the new one).
 *   - No "delta strip" or two-column scoreboard.
 *
 * --- Why source-level assertions, not DOM render ---
 *
 * The plan's preferred path was @testing-library/preact + happy-dom
 * to render the Preact island under bun:test and assert against the
 * live DOM. After one round of investigation that path doesn't
 * survive on this codebase:
 *
 *   - happy-dom v20 dropped its self-installing GlobalRegistrator;
 *     @happy-dom/global-registrator must be added separately and
 *     preloaded via bunfig.toml. Doing so breaks unrelated byok
 *     ai-sdk tests because happy-dom's ReadableStream replacement
 *     fails the AI SDK's `readable should be ReadableStream` check.
 *     Net: a project-wide preload is too disruptive for one test.
 *   - render(<Hello/>) works for components defined inline in the
 *     test file (with an explicit /** @jsxImportSource preact *\/
 *     pragma). But render(<EvalExplorer/>) — importing the real
 *     island file, which has no pragma and is compiled with the
 *     project tsconfig's `jsx: "preserve"` setting — fails inside
 *     Preact's diff with "Attempting to define property on object
 *     that is not extensible". The vnode shapes coming out of
 *     EvalExplorer.tsx don't match what testing-library/preact's
 *     act() expects under bun:test.
 *   - Mitigations tried: bunfig.toml [jsx, jsxImportSource] to
 *     force-Preact globally, raw preact render(), preact-render-
 *     to-string. The render-side issue is structural to how Bun
 *     compiles EvalExplorer.tsx vs the test file and would need
 *     either a pragma in EvalExplorer.tsx (the plan forbids
 *     refactoring it) or a project-wide tsconfig change (out of
 *     scope for a regression test).
 *
 * Per the plan's fallback path: the IRON RULE is satisfied by the
 * weaker structural form because it still locks down today's code
 * before the redesign lands. Source-level regex checks are stronger
 * than the plan's "default-export is a function" minimum because
 * they verify the *specific* invariants the IRON RULE protects:
 * one verdict pill per row, three pass/fail/unjudged chips, no
 * scoreboard / delta strip / comparison chips.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import EvalExplorer from "../EvalExplorer";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, "../EvalExplorer.tsx"), "utf8");

/**
 * Extract the body of the function that renders the SINGLE-ARM header.
 *
 * The IRON RULE only governs single-arm output. As Chunk 3 lands, A/B-mode
 * components (AbScoreboard, ArmColumn) legitimately introduce class names
 * like `eval-scoreboard*` into the file — but ONLY for two-arm rendering.
 * The absence assertions below must therefore be scoped to the function
 * that produces today's single-arm header.
 *
 *   - Post-Chunk-3: that function is named `SingleArmHeader`.
 *   - Pre-Chunk-3:  the equivalent function is `Header`.
 *
 * Try the new name first, fall back to the legacy name. Match runs from
 * `function <Name>` up to the first line containing only `}` (column 0
 * close brace + trailing newline), which is how the codebase formats
 * top-level function declarations.
 */
function extractSingleArmRenderBody(source: string): string {
  const m = source.match(/function SingleArmHeader[\s\S]*?\n\}\n/);
  if (m) return m[0];
  const legacy = source.match(/function Header[\s\S]*?\n\}\n/);
  return legacy ? legacy[0] : "";
}
const SINGLE_ARM_BODY = extractSingleArmRenderBody(SOURCE);

describe("EvalExplorer — single-arm regression (IRON RULE, structural)", () => {
  test("default-export is a function", () => {
    // Smoke: the module loads + exports the component. If a future
    // refactor breaks the default export contract, this fails first.
    expect(typeof EvalExplorer).toBe("function");
  });

  test("CaseRow renders ONE verdict pill, not two (no A/B [✓ W] / [✗ B] markers)", () => {
    // One <span class="eval-case-verdict-pill"> per row in today's
    // CaseRow. The A/B redesign would add a second pill (or a
    // comparison strip with [✓ W] / [✗ B] markers). Pin both.
    const pillMatches = SOURCE.match(/eval-case-verdict-pill/g) ?? [];
    expect(pillMatches.length).toBe(1);
    expect(SOURCE).not.toContain("[✗ B]");
    expect(SOURCE).not.toContain("[✓ W]");
  });

  test("FilterBar verdict chips are pass/fail/unjudged (radiogroup), NOT comparison chips", () => {
    // Today's FilterBar maps over the literal tuple
    // ["all", "pass", "fail", "unjudged"] inside a role="radiogroup".
    // The A/B redesign would replace that with comparison chips like
    // "Flips → pass" / "Both pass" / "Pending wiki". Pin the tuple.
    expect(SOURCE).toMatch(
      /role="radiogroup"\s+aria-label="Verdict"[\s\S]{0,200}\["all",\s*"pass",\s*"fail",\s*"unjudged"\]/
    );
    expect(SOURCE).not.toContain("Flips → pass");
    expect(SOURCE).not.toContain("Both pass");
    expect(SOURCE).not.toContain("Pending wiki");
  });

  test("Header has NO two-column scoreboard, NO delta strip", () => {
    // Today's single-arm header is a flat <header class="eval-header">
    // with per-model stat blocks. The A/B redesign introduces a
    // two-column scoreboard (.eval-scoreboard) and a delta strip
    // (.eval-delta-strip) — but those belong to the A/B-mode path
    // (AbScoreboard / ArmColumn), NOT to the single-arm header.
    // Scope the absence assertions to the single-arm render body so the
    // IRON RULE pins single-arm invariants without forbidding the
    // existence of A/B components elsewhere in the file.
    expect(SINGLE_ARM_BODY.length).toBeGreaterThan(0);
    expect(SINGLE_ARM_BODY).not.toContain("eval-scoreboard");
    expect(SINGLE_ARM_BODY).not.toContain("eval-delta-strip");
    expect(SINGLE_ARM_BODY).not.toContain("eval-ab-pill");
    expect(SINGLE_ARM_BODY).not.toContain("eval-case-row--ab");
  });
});
