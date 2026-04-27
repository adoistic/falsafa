/**
 * BYOK demo — type definitions.
 *
 * The 9-state machine and discriminated-union error type are locked by
 * /plan-eng-review run 2 (see docs/designs/byok-vertical-slice.md).
 *
 * Provider-specific shapes (OpenAI tool_calls, Anthropic tool_use,
 * Google functionCall) are normalized into NormalizedEvent before
 * reaching the reducer. Provider-specific code lives only in
 * apps/site/src/islands/byok/providers/<name>.ts.
 */

/** The four LLM providers exposed by the BYOK demo. OpenRouter routes to OpenAI-compatible APIs. */
export type Provider = "openai" | "anthropic" | "google" | "openrouter";

/**
 * Normalized stream events. Whatever the underlying provider emits,
 * the adapter translates into one of these. The reducer never sees
 * provider-specific shapes.
 */
export type NormalizedEvent =
  | { kind: "text-delta"; delta: string }
  | { kind: "tool-call-start"; id: string; name: string; argsPreview: string }
  | { kind: "tool-call-arg-delta"; id: string; delta: string }
  | { kind: "tool-call-end"; id: string; result: string }
  | { kind: "done"; finishReason: FinishReason; hasOutput: boolean }
  | { kind: "error"; error: ByokError };

export type FinishReason = "stop" | "length" | "tool" | "error";

/**
 * Discriminated union covering every error path the BYOK demo can land in.
 * Each kind carries enough payload for its recovery affordance.
 *
 * The reducer's switch is exhaustive on `error.kind` — TypeScript catches
 * missed cases. Provider-specific status code mapping (401 → invalid-key,
 * 429 → rate-limited, etc.) lives in the provider adapter, not in the
 * reducer.
 */
export type ByokError =
  | { kind: "invalid-key"; provider: Provider; status: 401 | 403 }
  | { kind: "rate-limited"; provider: Provider; retryAfterMs?: number }
  | {
      kind: "network-disconnect";
      cause: "fetch-aborted" | "fetch-error";
      underlying?: string;
    }
  | {
      kind: "partial-tool-use-abort";
      reason: "user-stopped" | "token-cap" | "mid-stream-error";
      partialOutput: string;
    }
  | { kind: "no-result-found"; finishReason: string };

/** Status of the BYOK request lifecycle. The 9 states from the eng review. */
export type Status =
  | "setup"
  | "submitting"
  | "streaming"
  | "success"
  | "invalid-key"
  | "rate-limited"
  | "network-disconnect"
  | "partial-tool-use-abort"
  | "no-result-found";

/**
 * One tool-call entry in the streaming output log. Built up incrementally
 * as TOOL_CALL_START → TOOL_CALL_ARG_DELTA* → TOOL_CALL_END events arrive.
 */
export interface ToolCall {
  id: string;
  name: string;
  /** Streaming JSON args buffer. Grows as arg-deltas arrive; final value parsed at end. */
  argsBuffer: string;
  /** Tool result, populated on TOOL_CALL_END. */
  result: string | null;
  /** Wall-clock start time for showing latency in the UI. */
  startedAt: number;
  /** Wall-clock end time, populated on TOOL_CALL_END. */
  endedAt: number | null;
}

/**
 * The complete state of a BYOK session. One of these exists at any time
 * inside the ByokDemo island; the reducer transitions between them.
 *
 * Form fields (apiKey, question, provider, rememberKey) persist across
 * status transitions so the user doesn't lose their input on errors.
 */
export interface BYOKState {
  /** Current lifecycle status. */
  status: Status;
  /** User's API key. Never sent to our server; lives only in browser state + localStorage. */
  apiKey: string;
  /** Whether to persist the key in localStorage on submit. */
  rememberKey: boolean;
  /** The question the user is asking. */
  question: string;
  /** The provider the user has selected. */
  provider: Provider;
  /** Streaming assistant text. Buffered and rendered via rAF coalescing. */
  output: string;
  /** Tool calls in chronological order. */
  toolCalls: ToolCall[];
  /** Final error if status is one of the error states. */
  error: ByokError | null;
  /** AbortController for the active request. Allows the Stop button to cancel. */
  abortController: AbortController | null;
}

/**
 * Events the reducer handles. Some are user actions (KEY_CHANGED, SUBMIT,
 * USER_ABORT); others are derived from provider stream events (FIRST_CHUNK,
 * TEXT_DELTA, etc.).
 */
export type BYOKAction =
  // User actions
  | { type: "KEY_CHANGED"; key: string }
  | { type: "REMEMBER_TOGGLED"; remember: boolean }
  | { type: "QUESTION_CHANGED"; question: string }
  | { type: "PROVIDER_CHANGED"; provider: Provider }
  | { type: "FORGET_KEY" }
  | { type: "SUBMIT"; abortController: AbortController }
  | { type: "USER_ABORT" }
  | { type: "RETRY" }
  | { type: "NEW_QUESTION" }
  // Stream events
  | { type: "FIRST_CHUNK" }
  | { type: "TEXT_DELTA"; delta: string }
  | { type: "TOOL_CALL_START"; id: string; name: string; argsPreview: string }
  | { type: "TOOL_CALL_ARG_DELTA"; id: string; delta: string }
  | { type: "TOOL_CALL_END"; id: string; result: string }
  | { type: "DONE"; finishReason: FinishReason; hasOutput: boolean }
  | { type: "ERROR"; error: ByokError };

/** All "final" statuses where a Retry/New Question button is appropriate. */
export const FINAL_STATUSES: Status[] = [
  "success",
  "invalid-key",
  "rate-limited",
  "network-disconnect",
  "partial-tool-use-abort",
  "no-result-found",
];
