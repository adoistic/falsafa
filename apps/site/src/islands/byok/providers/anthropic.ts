/**
 * Anthropic provider adapter — stub.
 *
 * Will be filled in after the OpenAI spike (this file) validates the
 * pattern. Per /plan-eng-review run 2 Issue 1.1, Anthropic in
 * browser-direct mode requires the `anthropic-dangerous-direct-browser-access`
 * header.
 *
 * Status: NOT IMPLEMENTED. Calling this throws.
 */

import type { ProviderAdapterArgs } from "./index";
import type { NormalizedEvent } from "../types";

export async function* streamAnthropic(
  _args: ProviderAdapterArgs,
): AsyncGenerator<NormalizedEvent, void, void> {
  throw new Error(
    "Anthropic provider not implemented yet. Tracking in docs/designs/byok-vertical-slice.md Checkpoint 6.",
  );
  // unreachable, but keeps the generator's type happy
  // eslint-disable-next-line @typescript-eslint/no-unreachable
  yield { kind: "text-delta", delta: "" };
}
