/**
 * Google (Gemini) provider adapter — stub.
 *
 * Will be filled in after the OpenAI spike validates the pattern. Per
 * /plan-eng-review run 2 Issue 1.4, Gemini's tool-use streaming may not
 * stream args the same way as OpenAI/Anthropic; the adapter may need to
 * buffer tool calls until complete.
 *
 * Status: NOT IMPLEMENTED. Calling this throws.
 */

import type { ProviderAdapterArgs } from "./index";
import type { NormalizedEvent } from "../types";

export async function* streamGoogle(
  _args: ProviderAdapterArgs,
): AsyncGenerator<NormalizedEvent, void, void> {
  throw new Error(
    "Google provider not implemented yet. Tracking in docs/designs/byok-vertical-slice.md Checkpoint 6.",
  );
  // eslint-disable-next-line @typescript-eslint/no-unreachable
  yield { kind: "text-delta", delta: "" };
}
