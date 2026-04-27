# BYOK vertical slice — design

**Phase 2 of the Falsafa launch build.** The /try page is the highest-stakes new code in the launch: it's the live demo HN-scrollers will land on, and it's the template every Phase 3 lane copies. This doc fixes the architecture before we write the 16-20 hours of code.

Locked decisions from earlier reviews live here so a sub-agent (or a future session) can read this single file and understand what to build, what NOT to build, and what's still open.

## Open questions (resolve before coding)

These decisions cascade through the file structure and the work estimate. Answering them now, before any code, is the cheap insurance.

### Q1 — MCP tool-call backend: where does the LLM's tool call resolve?

The BYOK demo flow is: user types question → LLM streams response → LLM emits `tool_call` (e.g., `search_corpus`) → **something resolves that tool call** → result feeds back to LLM → LLM continues. That "something" is the open question.

| Option | What it means | Trade-off |
|---|---|---|
| **A. Browser-bundled tools** | Re-implement all 8 librarian tools in client-side TypeScript. Corpus markdown fetched from `/corpus/...` static URLs on the same origin. The MCP server (apps/mcp) ships unchanged for stdio clients. | ✅ No new infra. ✅ Phase 2 ships standalone. ❌ Demo doesn't actually use the same MCP server marketing claims. ❌ Tool implementations diverge from `apps/mcp/src/tools.ts` over time. |
| **B. Remote MCP at `mcp.falsafa.app`** | Build an HTTP/SSE wrapper around the existing MCP server. BYOK browser → provider → tool call → browser fetches `https://mcp.falsafa.app/tools/search_corpus` → result. | ✅ Same MCP, one source of truth. ✅ Needed for ChatGPT/Gemini connector launches anyway. ❌ Phase 2 depends on remote-MCP infra being deployed first. ❌ CORS + auth surface area. |
| **C. Hybrid: develop local, deploy remote** | Phase 2 builds the BYOK client against a parameterized `MCP_BASE_URL`. In dev: `http://localhost:3001` running `apps/mcp` over HTTP. At launch: `https://mcp.falsafa.app`. Build the HTTP wrapper on `apps/mcp` as a parallel work item. | ✅ Phase 2 and remote-MCP unblock each other, both ship. ✅ Single tool-implementation source. ❌ Two simultaneous work streams. |

**Recommendation: C.** The remote MCP is on the launch critical path regardless (ChatGPT/Gemini connectors require it). Phase 2 develops against `localhost:3001` running `apps/mcp` with a thin HTTP wrapper. By launch, point at the deployed `mcp.falsafa.app`. One config line.

### Q2 — Tool-call rendering during streaming

When the LLM emits `tool_call: search_corpus(query="ghalib couplet 168")`, the browser:
1. Shows a "Calling search_corpus" line in the streaming output
2. Fires the tool call (whichever path Q1 resolves to)
3. Receives result
4. Sends result back to provider
5. Provider continues streaming

**Decision needed: how visible is this loop?** Three levels:

| Option | What user sees |
|---|---|
| **A. Tool calls collapsed by default** | "Used 2 tools (click to expand)" + final answer prominent. Cleaner. |
| **B. Tool calls inline, expanded** | Every tool call visible with name + args + result + timing. Audit-trail credibility. |
| **C. Streaming reveal — tool calls slide in, then collapse to summary line** | Animated reveal during streaming, settled state matches A. Educational + clean final state. |

**Recommendation: B.** The audit-trail framing is core to Falsafa's positioning. Hiding tool calls undermines "every claim has receipts." Cost: more vertical space; mitigation: the tool-call cards have a visual hierarchy that doesn't crowd the assistant's text.

### Q3 — Question chips (suggested questions on /try)

The design called for "question chips" — pre-written suggested questions to help users discover what Falsafa can answer. Eng review noted: "draw from a curated pool across all corpus traditions, randomize per pageload."

**Decision needed: pool size + curation pass.** Need ~100-300 high-quality questions covering: citation, comparison, discovery, edge cases, multilingual queries. This is editorial work (writing good questions) more than engineering.

**Recommendation: defer the curation, ship Phase 2 with 12 hand-written questions covering the 5 eval categories.** Expand the pool in Phase 3 when /audit is built (questions and eval cases overlap; reuse).

## Locked decisions (from earlier reviews)

These are settled. Listed here for the sub-agent / future session to find them in one place.

| Decision | Choice | Source |
|---|---|---|
| Provider abstraction | Vercel AI SDK v6 (`ai@^6` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/google`) | Eng review run 2, Issue 1.1 |
| API key flow | Browser-direct, never touches our server | Eng review run 2, Issue 1.1 |
| Browser-direct safety flags | `dangerouslyAllowBrowser: true` (OpenAI/OpenRouter), `anthropic-dangerous-direct-browser-access: true` header (Anthropic), Google equivalent | Eng review run 2, Issue 1.1 |
| State machine | Hand-rolled `useReducer`. Not XState. | Eng review run 2, Issue 1.1 |
| Islands framework | Preact via `@astrojs/preact` 4.1.3 (already wired in Phase 0) | Eng review run 2, Issue 1.2 |
| Error type | Discriminated union `ByokError` (5 kinds) | Eng review run 2, Issue 2.2 |
| Key storage | localStorage with password-typed input + visible "Forget my key" button | Eng review run 2, Issue 2.3 |
| CSP on /try | `connect-src` allowlist: api.openai.com, api.anthropic.com, generativelanguage.googleapis.com, openrouter.ai. No third-party JS. | Eng review run 2, Issue 2.3 |
| Streaming render | rAF-coalesce token deltas, ~60Hz max DOM updates | Eng review run 2, Issue 4.4 |
| Tool-call a11y | aria-live="polite" announces on tool-call boundaries, not per-token | Eng review run 2, Issue 1.5 |
| Abort behavior | User-stop → keep partial output + "Stopped" chip. Network drop → "Start over" only (no false-promise resume). Token cap → keep partial + explanation. | Eng review run 2, Issue 1.5 |
| JS budget for /try | ≤60KB gzipped | Eng review run 2, Issue 4.1 |
| Provider code-splitting | Dynamic `import()` triggered by provider selection. Unselected providers never download. | Eng review run 2, Issue 4.2 |

## Architecture

### State machine (9 states, 17 transitions)

```
                  ┌─────┐
                  │SETUP│ ◀── (initial; key from localStorage if present)
                  └──┬──┘
                     │ SUBMIT (key + question + provider all valid)
                     ▼
                ┌──────────┐
                │SUBMITTING│ (request fired, no chunks yet)
                └────┬─────┘
                     │
        ┌────────────┼────────────────────────┐
        │            │                        │
        ▼            ▼                        ▼
  ┌──────────┐  ┌────────────┐         ┌─────────────┐
  │INVALID-  │  │RATE-       │         │STREAMING    │ (first chunk arrived)
  │KEY (401) │  │LIMITED(429)│         └────┬────────┘
  └────┬─────┘  └─────┬──────┘              │
       │              │                     ├─→ SUCCESS (finishReason=stop, output non-empty)
       │              │                     ├─→ NO-RESULT-FOUND (stop + empty / "I don't know")
       │              │                     ├─→ PARTIAL-TOOL-USE-ABORT
       │              │                     │     ├ user-stopped (Stop button)
       │              │                     │     ├ token-cap (finishReason=length)
       │              │                     │     └ mid-stream-error
       │              │                     └─→ NETWORK-DISCONNECT (fetch error)
       │              │                                     │
       └──────┬───────┴─────────────────────────────────────┘
              │
              ▼ RETRY / NEW_QUESTION
        ┌──────────┐
        │  SETUP   │ ◀── (preserve question + provider, clear streaming state)
        └──────────┘
```

**Transition table:**

| From | Event | To | Notes |
|---|---|---|---|
| SETUP | KEY_CHANGED | SETUP | Update key, persist if remember=true |
| SETUP | QUESTION_CHANGED | SETUP | Update question |
| SETUP | PROVIDER_CHANGED | SETUP | Update provider, lazy-load adapter module |
| SETUP | FORGET_KEY | SETUP | Clear key from state + localStorage |
| SETUP | SUBMIT | SUBMITTING | Validate, fire provider stream |
| SUBMITTING | FIRST_CHUNK | STREAMING | Start rAF render loop |
| SUBMITTING | ERROR(invalid-key) | INVALID-KEY | — |
| SUBMITTING | ERROR(rate-limited) | RATE-LIMITED | — |
| SUBMITTING | ERROR(network-disconnect) | NETWORK-DISCONNECT | — |
| STREAMING | TEXT_DELTA | STREAMING | Buffer text, rAF-schedule render |
| STREAMING | TOOL_CALL_START | STREAMING | Push to log, fire aria-live |
| STREAMING | TOOL_CALL_END | STREAMING | Update result, fire aria-live |
| STREAMING | DONE(stop, has-output) | SUCCESS | — |
| STREAMING | DONE(stop, empty) | NO-RESULT-FOUND | — |
| STREAMING | DONE(length) | PARTIAL-TOOL-USE-ABORT(token-cap) | Keep partial output |
| STREAMING | USER_ABORT | PARTIAL-TOOL-USE-ABORT(user-stopped) | AbortController.abort() |
| STREAMING | ERROR(network-disconnect) | NETWORK-DISCONNECT | Mid-stream fetch error |
| Any error / final | RETRY | SETUP | Preserve question + provider |
| Any final | NEW_QUESTION | SETUP | Clear streaming state, keep key |

### Provider adapter (normalized event stream)

```typescript
type Provider = "openai" | "anthropic" | "google" | "openrouter";

type NormalizedEvent =
  | { kind: "text-delta"; delta: string }
  | { kind: "tool-call-start"; id: string; name: string; argsPreview: string }
  | { kind: "tool-call-arg-delta"; id: string; delta: string }
  | { kind: "tool-call-end"; id: string; result: string }
  | { kind: "done"; finishReason: "stop" | "length" | "tool" | "error"; hasOutput: boolean }
  | { kind: "error"; error: ByokError };

interface ProviderAdapter {
  startStream(args: {
    apiKey: string;
    question: string;
    abortSignal: AbortSignal;
    onToolCall: (name: string, args: unknown) => Promise<unknown>;  // resolves via Q1's choice
  }): AsyncIterable<NormalizedEvent>;
}
```

The reducer consumes only `NormalizedEvent`. Provider-specific shapes never leak.

### Error type (discriminated union)

```typescript
type ByokError =
  | { kind: "invalid-key"; provider: Provider; status: 401 | 403 }
  | { kind: "rate-limited"; provider: Provider; retryAfterMs?: number }
  | { kind: "network-disconnect"; cause: "fetch-aborted" | "fetch-error"; underlying?: string }
  | { kind: "partial-tool-use-abort"; reason: "user-stopped" | "token-cap" | "mid-stream-error"; partialOutput: string }
  | { kind: "no-result-found"; finishReason: string };
```

### File structure

```
apps/site/src/islands/byok/
├─ ByokDemo.tsx                    # top-level Preact island (state owner)
├─ state.ts                        # useReducer + state machine
├─ types.ts                        # ByokError, BYOKState, BYOKAction, Provider
├─ storage.ts                      # localStorage (loadKey/saveKey/forget)
├─ mcpClient.ts                    # tool-call backend dispatch (Q1's choice)
├─ providers/
│  ├─ index.ts                     # provider registry + lazy loader
│  ├─ openai.ts                    # adapter (covers OpenAI + OpenRouter)
│  ├─ anthropic.ts
│  └─ google.ts
├─ ui/
│  ├─ KeyInput.tsx                 # password input + Forget button
│  ├─ ProviderPicker.tsx           # ARIA radiogroup
│  ├─ QuestionInput.tsx            # textarea + question chips
│  ├─ StreamingOutput.tsx          # tool-call log + assistant text + state-driven indicators
│  └─ ErrorBanner.tsx              # discriminated-union-driven error UI
├─ hooks/
│  ├─ useStreaming.ts              # rAF coalescing
│  └─ useAriaLive.ts               # tool-call-boundary announcements
└─ __tests__/
   ├─ state.test.ts                # reducer transitions (every state × event)
   ├─ providers.openai.test.ts     # fixture-replay
   ├─ providers.anthropic.test.ts
   ├─ providers.google.test.ts
   └─ storage.test.ts
```

```
apps/site/tests/e2e/
├─ byok.happy-path.spec.ts         # one per provider
├─ byok.invalid-key.spec.ts
├─ byok.rate-limited.spec.ts
├─ byok.network-disconnect.spec.ts
├─ byok.partial-tool-use-abort.spec.ts
├─ byok.no-result-found.spec.ts
└─ byok.axe.spec.ts                # axe-core scan, all states

apps/site/tests/msw/
├─ handlers.ts                     # mock provider streaming responses
└─ fixtures/
   ├─ openai-streaming.json
   ├─ anthropic-streaming.json
   └─ google-streaming.json
```

### UI component tree

```
ByokDemo (state owner)
├─ KeyInput (props: value, hasStored, onChange, onForget)
├─ ProviderPicker (props: value, onChange, options)
├─ QuestionInput (props: value, onChange, onSubmit, disabled)
│  └─ QuestionChips (props: chips, onPick)
├─ StreamingOutput (props: state)
│  ├─ ToolCallLog (props: calls, expanded)
│  ├─ AssistantText (props: text)              # rAF-coalesced via useStreaming
│  └─ StatusIndicator (props: status)          # spinner / stopped / success / empty
└─ ErrorBanner (props: error: ByokError | null, onRetry, onNewQuestion)
```

### Data flow per request

```
user clicks Submit
  └─→ reducer dispatch SUBMIT
       └─→ provider adapter started
            ├─→ fetch (browser-direct to provider, AbortSignal piped through)
            └─→ streaming loop:
                 ├─→ provider chunk arrives
                 ├─→ adapter normalizes → NormalizedEvent
                 ├─→ reducer dispatch (FIRST_CHUNK / TEXT_DELTA / TOOL_CALL_START / etc.)
                 ├─→ on TOOL_CALL_START: mcpClient.invoke(name, args)
                 │    ├─→ (Q1: A) browser-bundled tool runs locally
                 │    └─→ (Q1: B) fetch https://mcp.falsafa.app/tools/<name>
                 ├─→ tool result returned to provider via SDK's tool-result mechanism
                 └─→ on TEXT_DELTA: useStreaming buffers, rAF schedules render
       └─→ on DONE: reducer transitions to SUCCESS / NO-RESULT-FOUND / PARTIAL
       └─→ on ERROR: reducer transitions to corresponding error state
```

## Test boundaries

| Layer | What's tested | Tool | Estimated cases |
|---|---|---|---|
| Reducer | Every state × event transition | bun test | ~25 |
| Provider adapter | Fixture-recorded provider stream → expected NormalizedEvent sequence | bun test | ~9 (3 per provider) |
| Storage | save/load/forget + edge cases (localStorage unavailable) | bun test | ~5 |
| Streaming hook | Given N TEXT_DELTA events in <16ms, exactly one render fires | bun test + happy-dom | ~3 |
| UI components | Render given state, ARIA correctness, error banner copy | bun test + @testing-library/preact | ~10 |
| E2E happy path | Paste key → submit → see tool calls + streamed output → success | Playwright + MSW | 3 (one per provider) |
| E2E error states | Each of 5 error states reproducible via MSW response | Playwright + MSW | 5 |
| A11y scan | axe-core on /try in setup / submitting / streaming / success / each error state | @axe-core/playwright | 1 spec, ~7 page-states |

**Total: ~60 unit + 8 E2E + 1 a11y spec.** Aligns with eng review run 2 estimate.

## Implementation sequence

Eight checkpoints. Each is a logical commit.

| # | Checkpoint | Work | Hours CC |
|---|------------|------|----------|
| 1 | Type definitions | `types.ts` (Provider, NormalizedEvent, ByokError, BYOKState, BYOKAction) | ~1 |
| 2 | Reducer + tests | `state.ts` + `__tests__/state.test.ts`, full transition coverage | ~2 |
| 3 | First provider adapter (OpenAI, the spike) | `providers/openai.ts` + fixture-replay tests. Validates the whole pattern. | ~3 |
| 4 | Storage + mcpClient stub | `storage.ts` + `mcpClient.ts` (Q1's choice wired) | ~1 |
| 5 | UI components + Preact wiring | `ui/*` + `ByokDemo.tsx` + render gate on /try | ~3-4 |
| 6 | Anthropic + Google adapters | `providers/anthropic.ts` + `providers/google.ts` + fixture tests | ~2 |
| 7 | rAF streaming hook + aria-live hook | `hooks/useStreaming.ts` + `hooks/useAriaLive.ts` | ~1-2 |
| 8 | E2E + axe-core + CSP + budget guard | Playwright suites + MSW fixtures + meta CSP + Lighthouse-budget CI step | ~3-4 |

Total: ~16-21 hrs CC. Estimate range matches eng review.

**Critical: ship in checkpoint order.** After checkpoint 3 (the OpenAI spike), if Vercel AI SDK or browser-direct surface unexpected friction, we discover it on ONE provider, not three. Stop, fix the pattern, then continue.

## Risks (honest list)

1. **Anthropic streaming + tool-use protocol differences** (confidence 7/10) — `tool_use` content block shape differs from OpenAI's `tool_calls`. Vercel AI SDK normalizes most of this; partial-JSON arg streaming might be incomplete. Mitigation: spike OpenAI first (well-documented), confirm pattern, then port to Anthropic.

2. **Gemini streaming tool-use is younger** (confidence 6/10) — Google's `functionCall` API may not stream args the same way as OpenAI/Anthropic. Worst case: Gemini is request/response for tool calls (no streaming inside the call). Adapter would buffer tool calls until complete. Acceptable behavior; doesn't break the state machine.

3. **CSP `'unsafe-inline'` for Astro hydration scripts** (confidence 8/10) — Astro emits inline scripts for hydration. CSP would need to allow them. Options: nonce-based CSP (requires server-side rendering, breaks static build) OR `'unsafe-inline'` + hash-based fallback. Lower-quality CSP than ideal. Mitigation: ship `'unsafe-inline'` for v1, evaluate switching to header-level CSP via Vercel response headers in a follow-up.

4. **MCP tool dispatch (Q1) determines whether Phase 2 ships standalone or depends on remote-MCP work** — flagged at top.

## NOT in scope for Phase 2

- Multiple concurrent BYOK sessions / chat history persistence — single-shot Q&A only
- Streaming across page navigations / backgrounded tabs — abort on navigation, no resume
- Cost estimation pre-submit — no token-counting in v1
- Provider rotation / fallback (try OpenAI, fall back to Anthropic) — explicit user choice only
- Pre-recorded demo Mode A — defer to Phase 3 once live mode is solid
- Question chip curation pool >12 — Phase 3 work, sourced from /audit cases
- Remote MCP HTTP wrapper deployment — separate work item, see Q1
