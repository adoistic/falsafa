/**
 * OpenAI / OpenRouter provider adapter.
 *
 * The "spike" adapter — gets the pattern right for one provider before
 * Anthropic and Google copy the pattern. Uses Vercel AI SDK v6 in
 * browser-direct mode (the user's API key sits in `apiKey`, never reaches
 * our server).
 *
 * OpenRouter is the same shape: `baseURL: 'https://openrouter.ai/api/v1'`
 * + the user's OpenRouter key. OpenAI-compatible API, so the SDK works
 * unchanged.
 *
 * The adapter's only public function is `streamOpenAI` (also used as the
 * shape every other provider's adapter must match — see providers/index.ts).
 */

import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { ProviderAdapterArgs } from "./index";
import type { ByokError, FinishReason, NormalizedEvent, Provider } from "../types";
import { buildFalsafaTools, FALSAFA_SYSTEM_PROMPT } from "./tools";

const DEFAULT_MODEL = "gpt-5.4-mini";

/**
 * Stream a BYOK session against OpenAI (or OpenRouter when baseURL is set).
 *
 * Yields NormalizedEvent values that the BYOK reducer consumes. Provider-
 * specific shapes never escape this function.
 *
 * NOTE: OpenAI's API does NOT allow POST /v1/chat/completions from a
 * browser (CORS-blocked). OpenAI direct will fail with a synthetic
 * "provider-not-browser-supported" error before the SDK even tries to
 * fetch. The recommended path for GPT models is OpenRouter, which
 * proxies the same providers with proper CORS.
 */
export async function* streamOpenAI(
  args: ProviderAdapterArgs,
): AsyncGenerator<NormalizedEvent, void, void> {
  const userProvider = args.provider; // "openai" | "openrouter" — threaded through for error labeling

  // Pre-flight: OpenAI direct doesn't work from a browser. Surface a clear
  // error instead of letting the user see "Failed to fetch" with no clue.
  if (userProvider === "openai") {
    yield {
      kind: "error",
      error: {
        kind: "provider-not-browser-supported",
        provider: "openai",
        suggestedAlternative: "openrouter",
      },
    };
    return;
  }

  const baseURL = inferBaseURL(args);

  const provider = createOpenAI({
    apiKey: args.apiKey,
    baseURL,
    fetch: args.fetch, // tests inject a mock fetch
    // OpenRouter best practice: identify the calling app via HTTP-Referer
    // and X-Title. Optional but recommended; without these some OpenRouter
    // routes default to lower-priority queues. No PII — just the brand.
    ...(args.provider === "openrouter"
      ? {
          headers: {
            "HTTP-Referer": "https://falsafa.ai",
            "X-Title": "Falsafa",
          },
        }
      : {}),
  });

  const tools = buildFalsafaTools(args.onToolCall);
  const modelId = args.modelId ?? DEFAULT_MODEL;

  let hasOutput = false;

  try {
    const result = streamText({
      model: provider.chat(modelId),
      system: FALSAFA_SYSTEM_PROMPT,
      prompt: args.question,
      tools,
      abortSignal: args.abortSignal,
      // OpenRouter prefixes model IDs (e.g. "openai/gpt-5-mini"), but the
      // AI SDK's reasoning-model detection uses bare-prefix startsWith
      // checks ("o1", "o3", "o4-mini", "gpt-5"). The prefix breaks the
      // check, so reasoning models get treated as chat models — the SDK
      // then sends `system` role + temperature/top_p, which OpenAI rejects
      // with "Unsupported parameter for this model".
      //
      // Detect reasoning models from the prefixed id and force the right
      // mode via providerOptions. This is the difference between "Claude
      // works on OpenRouter, GPT-5 doesn't" and "everything works".
      ...(detectOpenAIReasoningFromAnyId(modelId)
        ? {
            providerOptions: {
              openai: {
                forceReasoning: true,
                systemMessageMode: "developer",
              },
            },
          }
        : {}),
      // Cap at 50 LLM round-trips (each "step" = one model invocation
      // followed by zero-or-more tool executions). Comparative
      // synthesis questions in the live demo routinely need 15-20
      // round-trips: discover the corpus, search for terms across
      // traditions, read the most-promising chapters, then cite at
      // paragraph level. 50 leaves headroom for the deepest audits
      // (e.g., "trace this metaphor across every author in the corpus
      // and rank by usage") without the model ever bumping the cap on
      // a normal question. The Stop-generating button is the real
      // escape hatch.
      stopWhen: ({ steps }) => steps.length >= 50,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          if (part.text.length > 0) {
            hasOutput = true;
            yield { kind: "text-delta", delta: part.text };
          }
          break;

        case "tool-input-start":
          yield {
            kind: "tool-call-start",
            id: part.id,
            name: part.toolName,
            argsPreview: "",
          };
          break;

        case "tool-input-delta":
          yield { kind: "tool-call-arg-delta", id: part.id, delta: part.delta };
          break;

        case "tool-result":
          yield {
            kind: "tool-call-end",
            id: part.toolCallId,
            result: stringifyToolResult(part.output),
          };
          break;

        case "tool-error":
          yield {
            kind: "tool-call-end",
            id: part.toolCallId,
            result: `[tool error] ${formatUnknown(part.error)}`,
          };
          break;

        case "finish":
          yield {
            kind: "done",
            finishReason: mapFinishReason(part.finishReason),
            hasOutput,
          };
          return;

        case "error":
          // Dev-only: log the raw provider error to the browser console.
          // The ErrorBanner gets the polished summary via mapToByokError;
          // the console gets everything (status, headers, response body).
          if (typeof console !== "undefined") {
            console.error("[falsafa byok] stream error:", part.error);
          }
          yield { kind: "error", error: mapToByokError(part.error, userProvider) };
          return;

        case "abort":
          // The reducer transitions on USER_ABORT before the abort chunk
          // arrives. Nothing to emit here; just stop iterating.
          return;

        default:
          // text-start, text-end, reasoning-*, tool-input-end, tool-call,
          // start-step, finish-step, start, source, file, etc.
          // Not relevant to the normalized stream.
          break;
      }
    }
  } catch (err) {
    // Dev-only diagnostic: dump the raw error so the browser console shows
    // the upstream provider's actual rejection (parameter name, model id,
    // reason). The user-facing ErrorBanner only gets a polished summary;
    // this is the unfiltered debug trail.
    if (typeof console !== "undefined") {
      console.error("[falsafa byok] streamOpenAI threw:", err);
    }
    yield { kind: "error", error: mapToByokError(err, userProvider) };
  }
}

/**
 * OpenRouter routes through `https://openrouter.ai/api/v1` with an
 * OpenAI-compatible API. We branch on the explicit provider field
 * (set by the BYOK island) rather than guessing from key prefix.
 */
function inferBaseURL(args: ProviderAdapterArgs): string | undefined {
  if (args.provider === "openrouter") return "https://openrouter.ai/api/v1";
  return undefined; // default openai (which we now reject above anyway)
}

/**
 * Detect whether a model id maps to an OpenAI reasoning model, matching
 * the AI SDK's internal logic but also handling OpenRouter's `openai/`
 * prefix.
 *
 * Why we duplicate this: @ai-sdk/openai's getOpenAILanguageModelCapabilities
 * uses `modelId.startsWith("o1")` style checks, which fail for
 * "openai/o1-mini". The result is that reasoning models routed via
 * OpenRouter get treated as regular chat models — the SDK then sends
 * `temperature`, `top_p`, and `system` role messages that OpenAI rejects
 * with "Unsupported parameter for this model".
 *
 * The bare-prefix list is kept in sync with the AI SDK's source; if
 * OpenAI ships new reasoning-model families, add them here too.
 */
function detectOpenAIReasoningFromAnyId(modelId: string): boolean {
  const bare = modelId.replace(/^openai\//, "");
  // Mirror the AI SDK's check exactly — same prefixes, same exclusions.
  return (
    bare.startsWith("o1") ||
    bare.startsWith("o3") ||
    bare.startsWith("o4-mini") ||
    (bare.startsWith("gpt-5") && !bare.startsWith("gpt-5-chat"))
  );
}

function mapFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool-calls":
    case "tool":
      return "tool";
    case "error":
    case "content-filter":
    case "other":
    default:
      return reason === "stop" ? "stop" : "error";
  }
}

/**
 * Convert any error (provider error, fetch error, AbortError) into a
 * ByokError. The reducer's switch is exhaustive on these.
 */
export function mapToByokError(err: unknown, provider: Provider): ByokError {
  // Aborted by user → caller handles this via the USER_ABORT action; if it
  // bubbles as an error we treat it as partial-tool-use-abort.
  if (err instanceof DOMException && err.name === "AbortError") {
    return {
      kind: "partial-tool-use-abort",
      reason: "user-stopped",
      partialOutput: "",
    };
  }

  // AI SDK wraps HTTP errors with `statusCode` on the cause.
  const status = extractStatus(err);
  const apiMessage = extractApiMessage(err);

  if (status === 401 || status === 403) {
    return { kind: "invalid-key", provider, status, message: apiMessage };
  }
  if (status === 429) {
    return {
      kind: "rate-limited",
      provider,
      retryAfterMs: extractRetryAfter(err),
      message: apiMessage,
    };
  }
  // Other HTTP statuses (400, 404, 500, etc.) surface their actual message.
  if (typeof status === "number") {
    return {
      kind: "other",
      provider,
      status,
      message: apiMessage ?? `${provider} returned HTTP ${status}`,
    };
  }

  // Network/fetch errors.
  if (err instanceof TypeError && err.message.includes("fetch")) {
    return {
      kind: "network-disconnect",
      provider,
      cause: "fetch-error",
      underlying: err.message,
    };
  }

  // Generic fall-through — preserve whatever message we have.
  return {
    kind: "network-disconnect",
    provider,
    cause: "fetch-error",
    underlying: formatUnknown(err),
  };
}

/**
 * Pull a human-readable message out of an AI SDK error structure. Tries hard
 * to surface the actual upstream provider error rather than a wrapper one
 * (e.g., OpenRouter's "Provider returned error" wraps the real Anthropic
 * error in `error.metadata.raw`).
 */
function extractApiMessage(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;

  // Look at responseBody first — that's where OpenRouter et al put the
  // structured upstream error. Walk the object to find the deepest
  // human-readable string.
  const responseBody = e["responseBody"];
  if (typeof responseBody === "string") {
    try {
      const parsed = JSON.parse(responseBody) as Record<string, unknown>;
      const deep = findDeepestMessage(parsed);
      if (deep) return deep;
    } catch {
      /* not JSON */
    }
    return responseBody.slice(0, 400);
  }

  // Fall back to top-level message.
  if (typeof e["message"] === "string") return e["message"] as string;

  // Walk cause chain.
  const cause = e["cause"];
  if (cause && typeof cause === "object") {
    const cm = (cause as Record<string, unknown>)["message"];
    if (typeof cm === "string") return cm;
  }
  return undefined;
}

/**
 * Recursive walk to find the most informative message string. Prefers
 * `metadata.raw` (OpenRouter's upstream-provider passthrough) > `error.message` >
 * `message` > any string field that looks descriptive.
 */
function findDeepestMessage(obj: unknown, depth = 0): string | undefined {
  if (depth > 4 || obj === null || obj === undefined) return undefined;
  if (typeof obj === "string") return obj.length > 0 ? obj : undefined;
  if (typeof obj !== "object") return undefined;

  const o = obj as Record<string, unknown>;

  // OpenRouter wraps the upstream error here:
  //   { error: { code: 400, message: "Provider returned error",
  //              metadata: { raw: "<upstream JSON or text>", provider_name: "Anthropic" } } }
  // Surface metadata.raw first, with the wrapper message and provider name as context.
  const error = o["error"];
  if (error && typeof error === "object") {
    const eo = error as Record<string, unknown>;
    const meta = eo["metadata"];
    if (meta && typeof meta === "object") {
      const m = meta as Record<string, unknown>;
      const raw = m["raw"];
      const providerName = typeof m["provider_name"] === "string" ? m["provider_name"] : undefined;
      let upstreamMsg: string | undefined;
      if (typeof raw === "string") {
        try {
          const parsedRaw = JSON.parse(raw);
          upstreamMsg = findDeepestMessage(parsedRaw, depth + 1) ?? raw.slice(0, 300);
        } catch {
          upstreamMsg = raw.slice(0, 300);
        }
      }
      if (upstreamMsg) {
        return providerName ? `[${providerName}] ${upstreamMsg}` : upstreamMsg;
      }
    }
    // Fall through: error.message
    if (typeof eo["message"] === "string") return eo["message"] as string;
  }

  if (typeof o["message"] === "string") return o["message"] as string;

  // Last resort: scan strings.
  for (const v of Object.values(o)) {
    const found = findDeepestMessage(v, depth + 1);
    if (found && found.length > 5) return found;
  }
  return undefined;
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;
  if (typeof e["statusCode"] === "number") return e["statusCode"];
  if (typeof e["status"] === "number") return e["status"];
  const cause = e["cause"];
  if (cause && typeof cause === "object" && "statusCode" in cause) {
    const c = (cause as Record<string, unknown>)["statusCode"];
    if (typeof c === "number") return c;
  }
  return undefined;
}

function extractRetryAfter(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;
  const headers = e["responseHeaders"] ?? e["headers"];
  if (headers && typeof headers === "object" && "retry-after" in headers) {
    const v = (headers as Record<string, unknown>)["retry-after"];
    const seconds = typeof v === "string" ? parseInt(v, 10) : undefined;
    if (seconds && seconds > 0) return seconds * 1000;
  }
  return undefined;
}

function formatUnknown(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function stringifyToolResult(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}
