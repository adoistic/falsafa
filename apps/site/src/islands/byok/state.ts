/**
 * BYOK demo — state machine.
 *
 * Single useReducer that consumes both user actions and normalized stream
 * events from provider adapters. The transitions are locked by the eng
 * review (see docs/designs/byok-vertical-slice.md, Section "State machine").
 *
 * State diagram:
 *
 *   ┌─────┐
 *   │SETUP│ ◀── (initial; key from localStorage if present)
 *   └──┬──┘
 *      │ SUBMIT (key + question + provider all valid)
 *      ▼
 *   ┌──────────┐
 *   │SUBMITTING│ (request fired, no chunks yet)
 *   └────┬─────┘
 *        │
 *        ├─→ STREAMING (FIRST_CHUNK) ──┬─→ SUCCESS (DONE stop, has-output)
 *        │                             ├─→ NO-RESULT-FOUND (DONE stop, empty)
 *        │                             ├─→ PARTIAL-TOOL-USE-ABORT (USER_ABORT / DONE length / mid-stream ERROR)
 *        │                             └─→ NETWORK-DISCONNECT (ERROR network-disconnect)
 *        ├─→ INVALID-KEY (ERROR invalid-key)
 *        ├─→ RATE-LIMITED (ERROR rate-limited)
 *        └─→ NETWORK-DISCONNECT (ERROR network-disconnect)
 *
 *   Any final state → SETUP (RETRY: preserve question + provider, clear streaming;
 *                            NEW_QUESTION: same; FORGET_KEY: clear key too)
 */

import type {
  BYOKAction,
  BYOKState,
  ByokError,
  Provider,
  ToolCall,
} from "./types";

/** Initial state. Caller can override `apiKey` and `modelId` from localStorage. */
export function initialState(seed?: Partial<BYOKState>): BYOKState {
  return {
    status: "setup",
    apiKey: "",
    rememberKey: true,
    question: "",
    provider: "openai",
    modelId: "gpt-5.4-mini",
    output: "",
    toolCalls: [],
    error: null,
    abortController: null,
    ...seed,
  };
}

/** Map an error kind to its terminal status. */
function statusForError(error: ByokError): BYOKState["status"] {
  switch (error.kind) {
    case "invalid-key":
      return "invalid-key";
    case "rate-limited":
      return "rate-limited";
    case "network-disconnect":
      return "network-disconnect";
    case "partial-tool-use-abort":
      return "partial-tool-use-abort";
    case "no-result-found":
      return "no-result-found";
  }
}

/**
 * Reducer. Pure function: (state, action) → state. Side effects (fetching
 * the provider, persisting the key, scheduling rAF) live in the island
 * component, not here.
 */
export function reducer(state: BYOKState, action: BYOKAction): BYOKState {
  switch (action.type) {
    // ── User actions (SETUP-phase) ────────────────────────────────────
    case "KEY_CHANGED":
      // Allowed in SETUP and after final states (so user can edit key on retry).
      return { ...state, apiKey: action.key };

    case "REMEMBER_TOGGLED":
      return { ...state, rememberKey: action.remember };

    case "QUESTION_CHANGED":
      return { ...state, question: action.question };

    case "PROVIDER_CHANGED":
      // Switching provider resets the model — different providers have
      // different model namespaces. The picker passes a sensible default
      // for the new provider.
      return { ...state, provider: action.provider, modelId: action.defaultModelId };

    case "MODEL_CHANGED":
      return { ...state, modelId: action.modelId };

    case "FORGET_KEY":
      return { ...state, apiKey: "" };

    case "SUBMIT": {
      // Guard: must have key + question + provider, must not already be in flight.
      if (state.status === "submitting" || state.status === "streaming") {
        return state;
      }
      if (!state.apiKey.trim() || !state.question.trim()) {
        return state;
      }
      return {
        ...state,
        status: "submitting",
        output: "",
        toolCalls: [],
        error: null,
        abortController: action.abortController,
      };
    }

    // ── User actions (mid-stream) ─────────────────────────────────────
    case "USER_ABORT": {
      if (state.status !== "streaming" && state.status !== "submitting") {
        return state;
      }
      return {
        ...state,
        status: "partial-tool-use-abort",
        error: {
          kind: "partial-tool-use-abort",
          reason: "user-stopped",
          partialOutput: state.output,
        },
        abortController: null,
      };
    }

    // ── User actions (terminal-state recovery) ────────────────────────
    case "RETRY":
    case "NEW_QUESTION":
      // Both clear streaming state and return to setup. Difference is purely
      // semantic (Retry = same question, New Question = clear question), but
      // we leave clearing the question to the UI layer that knows the intent.
      return {
        ...state,
        status: "setup",
        output: "",
        toolCalls: [],
        error: null,
        abortController: null,
      };

    // ── Stream events ─────────────────────────────────────────────────
    case "FIRST_CHUNK":
      if (state.status !== "submitting") return state;
      return { ...state, status: "streaming" };

    case "TEXT_DELTA":
      if (state.status !== "streaming") return state;
      return { ...state, output: state.output + action.delta };

    case "TOOL_CALL_START": {
      if (state.status !== "streaming") return state;
      const newCall: ToolCall = {
        id: action.id,
        name: action.name,
        argsBuffer: action.argsPreview,
        result: null,
        startedAt: Date.now(),
        endedAt: null,
      };
      return { ...state, toolCalls: [...state.toolCalls, newCall] };
    }

    case "TOOL_CALL_ARG_DELTA": {
      if (state.status !== "streaming") return state;
      return {
        ...state,
        toolCalls: state.toolCalls.map((c) =>
          c.id === action.id ? { ...c, argsBuffer: c.argsBuffer + action.delta } : c,
        ),
      };
    }

    case "TOOL_CALL_END": {
      if (state.status !== "streaming") return state;
      return {
        ...state,
        toolCalls: state.toolCalls.map((c) =>
          c.id === action.id ? { ...c, result: action.result, endedAt: Date.now() } : c,
        ),
      };
    }

    case "DONE": {
      // Only meaningful from streaming. From submitting (no chunks ever), provider
      // would have errored instead; defensive bail-out covers test-replay paths.
      if (state.status !== "streaming" && state.status !== "submitting") {
        return state;
      }
      if (action.finishReason === "length") {
        return {
          ...state,
          status: "partial-tool-use-abort",
          error: {
            kind: "partial-tool-use-abort",
            reason: "token-cap",
            partialOutput: state.output,
          },
          abortController: null,
        };
      }
      if (action.finishReason === "error") {
        return {
          ...state,
          status: "partial-tool-use-abort",
          error: {
            kind: "partial-tool-use-abort",
            reason: "mid-stream-error",
            partialOutput: state.output,
          },
          abortController: null,
        };
      }
      // finishReason "stop" or "tool" with output → success; without → no-result-found
      if (action.hasOutput) {
        return { ...state, status: "success", abortController: null };
      }
      return {
        ...state,
        status: "no-result-found",
        error: {
          kind: "no-result-found",
          finishReason: action.finishReason,
        },
        abortController: null,
      };
    }

    case "ERROR":
      return {
        ...state,
        status: statusForError(action.error),
        error: action.error,
        abortController: null,
      };
  }
}

/** Validate a state for submission. Returns null if valid, reason otherwise. */
export function canSubmit(state: BYOKState): null | string {
  if (state.status === "submitting" || state.status === "streaming") {
    return "already in flight";
  }
  if (!state.apiKey.trim()) return "missing API key";
  if (!state.question.trim()) return "missing question";
  return null;
}

/** Reusable list of valid providers. */
export const PROVIDERS: Provider[] = ["openai", "openrouter", "anthropic", "google"];
