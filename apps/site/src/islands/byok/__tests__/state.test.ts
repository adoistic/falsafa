/**
 * Reducer transition tests. Every state × action pair the eng review's
 * transition table covers, plus the obvious negatives (action arrives in
 * wrong state, no-op).
 *
 * Run: bun test apps/site/src/islands/byok/__tests__/state.test.ts
 */

import { describe, test, expect } from "bun:test";
import { initialState, reducer, canSubmit, PROVIDERS } from "../state";
import type { BYOKAction, BYOKState, ByokError } from "../types";

// ── Helpers ────────────────────────────────────────────────────────────

const ABORT_CONTROLLER_FACTORY = () => new AbortController();

/** Build a state with the given status, filling in safe defaults. */
function stateAt(status: BYOKState["status"], overrides: Partial<BYOKState> = {}): BYOKState {
  const base = initialState({
    apiKey: "sk-test",
    question: "What does Ghalib say about love?",
    provider: "openai",
    output: "",
    toolCalls: [],
    error: null,
    abortController: null,
  });
  return { ...base, status, ...overrides };
}

// ── SETUP-phase user actions ──────────────────────────────────────────

describe("reducer: setup-phase user actions", () => {
  test("KEY_CHANGED updates apiKey", () => {
    const s = reducer(initialState(), { type: "KEY_CHANGED", key: "sk-foo" });
    expect(s.apiKey).toBe("sk-foo");
    expect(s.status).toBe("setup");
  });

  test("REMEMBER_TOGGLED flips the persistence flag", () => {
    const s0 = initialState();
    expect(s0.rememberKey).toBe(true);
    const s1 = reducer(s0, { type: "REMEMBER_TOGGLED", remember: false });
    expect(s1.rememberKey).toBe(false);
  });

  test("QUESTION_CHANGED updates question text", () => {
    const s = reducer(initialState(), {
      type: "QUESTION_CHANGED",
      question: "What does Iqbal say about Khudi?",
    });
    expect(s.question).toBe("What does Iqbal say about Khudi?");
  });

  test("PROVIDER_CHANGED updates provider and resets model to the new default", () => {
    const s = reducer(initialState(), {
      type: "PROVIDER_CHANGED",
      provider: "anthropic",
      defaultModelId: "claude-sonnet-4.5",
    });
    expect(s.provider).toBe("anthropic");
    expect(s.modelId).toBe("claude-sonnet-4.5");
  });

  test("MODEL_CHANGED updates the model id", () => {
    const s = reducer(initialState(), { type: "MODEL_CHANGED", modelId: "gpt-5.4" });
    expect(s.modelId).toBe("gpt-5.4");
  });

  test("FORGET_KEY clears apiKey", () => {
    const s = reducer(stateAt("setup"), { type: "FORGET_KEY" });
    expect(s.apiKey).toBe("");
  });

  test("KEY_CHANGED works in any state (allows post-error edits)", () => {
    const fromError = stateAt("invalid-key", {
      error: { kind: "invalid-key", provider: "openai", status: 401 },
    });
    const s = reducer(fromError, { type: "KEY_CHANGED", key: "sk-new" });
    expect(s.apiKey).toBe("sk-new");
    expect(s.status).toBe("invalid-key"); // status unchanged
  });
});

// ── SUBMIT validation ──────────────────────────────────────────────────

describe("reducer: SUBMIT", () => {
  test("transitions to submitting when valid", () => {
    const s = reducer(stateAt("setup"), {
      type: "SUBMIT",
      abortController: ABORT_CONTROLLER_FACTORY(),
    });
    expect(s.status).toBe("submitting");
    expect(s.output).toBe("");
    expect(s.toolCalls).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.abortController).toBeInstanceOf(AbortController);
  });

  test("blocks SUBMIT when apiKey is empty", () => {
    const s = reducer(stateAt("setup", { apiKey: "" }), {
      type: "SUBMIT",
      abortController: ABORT_CONTROLLER_FACTORY(),
    });
    expect(s.status).toBe("setup");
  });

  test("blocks SUBMIT when question is empty", () => {
    const s = reducer(stateAt("setup", { question: "  " }), {
      type: "SUBMIT",
      abortController: ABORT_CONTROLLER_FACTORY(),
    });
    expect(s.status).toBe("setup");
  });

  test("blocks SUBMIT mid-flight (already submitting)", () => {
    const s = reducer(stateAt("submitting"), {
      type: "SUBMIT",
      abortController: ABORT_CONTROLLER_FACTORY(),
    });
    expect(s.status).toBe("submitting");
  });

  test("blocks SUBMIT mid-flight (already streaming)", () => {
    const s = reducer(stateAt("streaming"), {
      type: "SUBMIT",
      abortController: ABORT_CONTROLLER_FACTORY(),
    });
    expect(s.status).toBe("streaming");
  });

  test("clears prior output and tool calls on SUBMIT (retry after success)", () => {
    const prior = stateAt("success", {
      output: "old answer",
      toolCalls: [
        {
          id: "1",
          name: "search_corpus",
          argsBuffer: "{}",
          result: "old",
          startedAt: 0,
          endedAt: 1,
        },
      ],
    });
    const s = reducer(prior, {
      type: "SUBMIT",
      abortController: ABORT_CONTROLLER_FACTORY(),
    });
    expect(s.status).toBe("submitting");
    expect(s.output).toBe("");
    expect(s.toolCalls).toEqual([]);
  });
});

// ── Stream events ──────────────────────────────────────────────────────

describe("reducer: stream events", () => {
  test("FIRST_CHUNK transitions submitting → streaming", () => {
    const s = reducer(stateAt("submitting"), { type: "FIRST_CHUNK" });
    expect(s.status).toBe("streaming");
  });

  test("FIRST_CHUNK is no-op outside submitting", () => {
    const s = reducer(stateAt("setup"), { type: "FIRST_CHUNK" });
    expect(s.status).toBe("setup");
  });

  test("TEXT_DELTA accumulates output during streaming", () => {
    let s = stateAt("streaming");
    s = reducer(s, { type: "TEXT_DELTA", delta: "Hello " });
    s = reducer(s, { type: "TEXT_DELTA", delta: "world" });
    expect(s.output).toBe("Hello world");
  });

  test("TEXT_DELTA is no-op outside streaming", () => {
    const s = reducer(stateAt("submitting"), { type: "TEXT_DELTA", delta: "x" });
    expect(s.output).toBe("");
  });

  test("TOOL_CALL_START appends a new call", () => {
    const s = reducer(stateAt("streaming"), {
      type: "TOOL_CALL_START",
      id: "tc-1",
      name: "search_corpus",
      argsPreview: '{"query":"',
    });
    expect(s.toolCalls).toHaveLength(1);
    expect(s.toolCalls[0]?.name).toBe("search_corpus");
    expect(s.toolCalls[0]?.argsBuffer).toBe('{"query":"');
    expect(s.toolCalls[0]?.result).toBeNull();
  });

  test("TOOL_CALL_ARG_DELTA appends to the right call's args buffer", () => {
    let s = stateAt("streaming");
    s = reducer(s, {
      type: "TOOL_CALL_START",
      id: "tc-1",
      name: "search_corpus",
      argsPreview: '{"q":"',
    });
    s = reducer(s, { type: "TOOL_CALL_ARG_DELTA", id: "tc-1", delta: 'ghalib"' });
    s = reducer(s, { type: "TOOL_CALL_ARG_DELTA", id: "tc-1", delta: "}" });
    expect(s.toolCalls[0]?.argsBuffer).toBe('{"q":"ghalib"}');
  });

  test("TOOL_CALL_END populates result + endedAt on the right call", () => {
    let s = stateAt("streaming");
    s = reducer(s, {
      type: "TOOL_CALL_START",
      id: "tc-a",
      name: "search_corpus",
      argsPreview: "{}",
    });
    s = reducer(s, {
      type: "TOOL_CALL_START",
      id: "tc-b",
      name: "find_related",
      argsPreview: "{}",
    });
    s = reducer(s, { type: "TOOL_CALL_END", id: "tc-a", result: "found 3 chapters" });
    expect(s.toolCalls[0]?.result).toBe("found 3 chapters");
    expect(s.toolCalls[0]?.endedAt).toBeGreaterThan(0);
    expect(s.toolCalls[1]?.result).toBeNull(); // tc-b unaffected
  });
});

// ── DONE variants ──────────────────────────────────────────────────────

describe("reducer: DONE", () => {
  test("DONE(stop, has-output) → success", () => {
    const s = reducer(stateAt("streaming", { output: "answer" }), {
      type: "DONE",
      finishReason: "stop",
      hasOutput: true,
    });
    expect(s.status).toBe("success");
    expect(s.error).toBeNull();
  });

  test("DONE(stop, empty) → no-result-found", () => {
    const s = reducer(stateAt("streaming"), {
      type: "DONE",
      finishReason: "stop",
      hasOutput: false,
    });
    expect(s.status).toBe("no-result-found");
    expect(s.error?.kind).toBe("no-result-found");
  });

  test("DONE(length) → partial-tool-use-abort with reason=token-cap", () => {
    const s = reducer(stateAt("streaming", { output: "partial..." }), {
      type: "DONE",
      finishReason: "length",
      hasOutput: true,
    });
    expect(s.status).toBe("partial-tool-use-abort");
    if (s.error?.kind === "partial-tool-use-abort") {
      expect(s.error.reason).toBe("token-cap");
      expect(s.error.partialOutput).toBe("partial...");
    } else {
      throw new Error("expected partial-tool-use-abort error");
    }
  });

  test("DONE(error) → partial-tool-use-abort with reason=mid-stream-error", () => {
    const s = reducer(stateAt("streaming", { output: "what we got" }), {
      type: "DONE",
      finishReason: "error",
      hasOutput: true,
    });
    expect(s.status).toBe("partial-tool-use-abort");
    if (s.error?.kind === "partial-tool-use-abort") {
      expect(s.error.reason).toBe("mid-stream-error");
      expect(s.error.partialOutput).toBe("what we got");
    }
  });

  test("DONE(tool, has-output) → success (final tool call resolved)", () => {
    const s = reducer(stateAt("streaming", { output: "after tools" }), {
      type: "DONE",
      finishReason: "tool",
      hasOutput: true,
    });
    expect(s.status).toBe("success");
  });
});

// ── Error transitions ──────────────────────────────────────────────────

describe("reducer: ERROR", () => {
  test("invalid-key error → invalid-key state", () => {
    const err: ByokError = { kind: "invalid-key", provider: "openai", status: 401 };
    const s = reducer(stateAt("submitting"), { type: "ERROR", error: err });
    expect(s.status).toBe("invalid-key");
    expect(s.error).toEqual(err);
  });

  test("rate-limited error → rate-limited state", () => {
    const err: ByokError = { kind: "rate-limited", provider: "anthropic", retryAfterMs: 5000 };
    const s = reducer(stateAt("submitting"), { type: "ERROR", error: err });
    expect(s.status).toBe("rate-limited");
    if (s.error?.kind === "rate-limited") {
      expect(s.error.retryAfterMs).toBe(5000);
    }
  });

  test("network-disconnect mid-stream → network-disconnect", () => {
    const err: ByokError = {
      kind: "network-disconnect",
      cause: "fetch-error",
      underlying: "ENOTFOUND",
    };
    const s = reducer(stateAt("streaming", { output: "started typing..." }), {
      type: "ERROR",
      error: err,
    });
    expect(s.status).toBe("network-disconnect");
    expect(s.error).toEqual(err);
  });

  test("ERROR clears the abort controller", () => {
    const ac = ABORT_CONTROLLER_FACTORY();
    const s = reducer(stateAt("submitting", { abortController: ac }), {
      type: "ERROR",
      error: { kind: "invalid-key", provider: "openai", status: 401 },
    });
    expect(s.abortController).toBeNull();
  });
});

// ── User abort ─────────────────────────────────────────────────────────

describe("reducer: USER_ABORT", () => {
  test("from streaming → partial-tool-use-abort with user-stopped reason + partial output preserved", () => {
    const s = reducer(stateAt("streaming", { output: "Ghalib's couplet 168 explores..." }), {
      type: "USER_ABORT",
    });
    expect(s.status).toBe("partial-tool-use-abort");
    if (s.error?.kind === "partial-tool-use-abort") {
      expect(s.error.reason).toBe("user-stopped");
      expect(s.error.partialOutput).toBe("Ghalib's couplet 168 explores...");
    }
  });

  test("from submitting → partial-tool-use-abort (no chunks yet, partialOutput is empty)", () => {
    const s = reducer(stateAt("submitting"), { type: "USER_ABORT" });
    expect(s.status).toBe("partial-tool-use-abort");
    if (s.error?.kind === "partial-tool-use-abort") {
      expect(s.error.partialOutput).toBe("");
    }
  });

  test("from setup is a no-op (nothing to abort)", () => {
    const s = reducer(stateAt("setup"), { type: "USER_ABORT" });
    expect(s.status).toBe("setup");
  });
});

// ── Recovery ───────────────────────────────────────────────────────────

describe("reducer: RETRY / NEW_QUESTION", () => {
  const finalStatuses: BYOKState["status"][] = [
    "success",
    "invalid-key",
    "rate-limited",
    "network-disconnect",
    "partial-tool-use-abort",
    "no-result-found",
  ];

  for (const status of finalStatuses) {
    test(`RETRY from ${status} returns to setup, preserves question + provider + key`, () => {
      const before = stateAt(status, {
        output: "stale",
        toolCalls: [
          { id: "x", name: "search", argsBuffer: "{}", result: "y", startedAt: 0, endedAt: 1 },
        ],
        error: { kind: "invalid-key", provider: "openai", status: 401 },
      });
      const s = reducer(before, { type: "RETRY" });
      expect(s.status).toBe("setup");
      expect(s.output).toBe("");
      expect(s.toolCalls).toEqual([]);
      expect(s.error).toBeNull();
      expect(s.apiKey).toBe(before.apiKey);
      expect(s.question).toBe(before.question);
      expect(s.provider).toBe(before.provider);
    });
  }

  test("NEW_QUESTION from success clears streaming state", () => {
    const before = stateAt("success", { output: "old answer" });
    const s = reducer(before, { type: "NEW_QUESTION" });
    expect(s.status).toBe("setup");
    expect(s.output).toBe("");
  });
});

// ── canSubmit guard helper ─────────────────────────────────────────────

describe("canSubmit", () => {
  test("returns null when valid", () => {
    expect(canSubmit(stateAt("setup"))).toBeNull();
  });

  test("flags missing key", () => {
    expect(canSubmit(stateAt("setup", { apiKey: "" }))).toBe("missing API key");
  });

  test("flags missing question", () => {
    expect(canSubmit(stateAt("setup", { question: " " }))).toBe("missing question");
  });

  test("flags in-flight", () => {
    expect(canSubmit(stateAt("submitting"))).toBe("already in flight");
    expect(canSubmit(stateAt("streaming"))).toBe("already in flight");
  });
});

// ── PROVIDERS sanity ──────────────────────────────────────────────────

describe("PROVIDERS list", () => {
  test("contains the four locked providers", () => {
    expect(PROVIDERS).toEqual(["openai", "openrouter", "anthropic", "google"]);
  });
});

// ── Full happy-path integration ────────────────────────────────────────

describe("integration: a complete happy-path session", () => {
  test("setup → submit → streaming with tool call → success", () => {
    let s = initialState();

    // User fills in
    s = reducer(s, { type: "KEY_CHANGED", key: "sk-real-key" });
    s = reducer(s, { type: "QUESTION_CHANGED", question: "What does Ghalib say about love?" });
    s = reducer(s, {
      type: "PROVIDER_CHANGED",
      provider: "anthropic",
      defaultModelId: "claude-sonnet-4.5",
    });

    // Submits
    s = reducer(s, { type: "SUBMIT", abortController: ABORT_CONTROLLER_FACTORY() });
    expect(s.status).toBe("submitting");

    // Provider streams
    s = reducer(s, { type: "FIRST_CHUNK" });
    expect(s.status).toBe("streaming");

    s = reducer(s, { type: "TEXT_DELTA", delta: "Looking up Ghalib's ghazals... " });
    s = reducer(s, {
      type: "TOOL_CALL_START",
      id: "call-1",
      name: "search_corpus",
      argsPreview: '{"query":"Ghalib love"}',
    });
    s = reducer(s, {
      type: "TOOL_CALL_END",
      id: "call-1",
      result: "Found 12 matching paragraphs in Diwan-e-Ghalib.",
    });
    s = reducer(s, { type: "TEXT_DELTA", delta: "Ghalib treats love as..." });
    s = reducer(s, { type: "DONE", finishReason: "stop", hasOutput: true });

    expect(s.status).toBe("success");
    expect(s.output).toContain("Looking up Ghalib's ghazals");
    expect(s.output).toContain("Ghalib treats love as");
    expect(s.toolCalls).toHaveLength(1);
    expect(s.toolCalls[0]?.result).toContain("12 matching paragraphs");
  });

  test("error mid-stream preserves partial output for the user to see", () => {
    let s = initialState({ apiKey: "sk", question: "q" });
    s = reducer(s, { type: "SUBMIT", abortController: ABORT_CONTROLLER_FACTORY() });
    s = reducer(s, { type: "FIRST_CHUNK" });
    s = reducer(s, { type: "TEXT_DELTA", delta: "I started to answer but " });
    s = reducer(s, {
      type: "ERROR",
      error: { kind: "network-disconnect", cause: "fetch-error" },
    });
    expect(s.status).toBe("network-disconnect");
    expect(s.output).toBe("I started to answer but "); // preserved, not cleared
  });
});
