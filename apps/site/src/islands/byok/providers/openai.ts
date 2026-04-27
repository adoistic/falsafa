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
import type { ByokError, FinishReason, NormalizedEvent } from "../types";
import { buildFalsafaTools, FALSAFA_SYSTEM_PROMPT } from "./tools";

const DEFAULT_MODEL = "gpt-5.4-mini";

/**
 * Stream a BYOK session against OpenAI (or OpenRouter when baseURL is set).
 *
 * Yields NormalizedEvent values that the BYOK reducer consumes. Provider-
 * specific shapes never escape this function.
 */
export async function* streamOpenAI(
  args: ProviderAdapterArgs,
): AsyncGenerator<NormalizedEvent, void, void> {
  const baseURL = inferBaseURL(args);

  const provider = createOpenAI({
    apiKey: args.apiKey,
    baseURL,
    fetch: args.fetch, // tests inject a mock fetch
  });

  const tools = buildFalsafaTools(args.onToolCall);

  let hasOutput = false;

  try {
    const result = streamText({
      model: provider.chat(args.modelId ?? DEFAULT_MODEL),
      system: FALSAFA_SYSTEM_PROMPT,
      prompt: args.question,
      tools,
      abortSignal: args.abortSignal,
      // Allow up to ~10 tool-use rounds before stopping. Falsafa workflows
      // typically use 2-5 tools per answer; 10 is generous insurance.
      stopWhen: ({ steps }) => steps.length >= 10,
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
          yield { kind: "error", error: mapToByokError(part.error, "openai") };
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
    yield { kind: "error", error: mapToByokError(err, "openai") };
  }
}

/**
 * OpenRouter routes through `https://openrouter.ai/api/v1` with an
 * OpenAI-compatible API. Detection: if the user's key starts with
 * `sk-or-`, route to OpenRouter. (Heuristic; UI also lets user pick
 * provider explicitly.)
 */
function inferBaseURL(args: ProviderAdapterArgs): string | undefined {
  // If the caller explicitly intends openrouter, the BYOK island sets
  // provider="openrouter" before loading; we can't see that here, so we
  // rely on the key prefix as a fallback signal.
  if (args.apiKey.startsWith("sk-or-")) {
    return "https://openrouter.ai/api/v1";
  }
  return undefined; // default openai
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
export function mapToByokError(err: unknown, provider: "openai"): ByokError {
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
  if (status === 401 || status === 403) {
    return { kind: "invalid-key", provider, status };
  }
  if (status === 429) {
    return { kind: "rate-limited", provider, retryAfterMs: extractRetryAfter(err) };
  }

  // Network/fetch errors.
  if (err instanceof TypeError && err.message.includes("fetch")) {
    return {
      kind: "network-disconnect",
      cause: "fetch-error",
      underlying: err.message,
    };
  }

  // Generic fall-through.
  return {
    kind: "network-disconnect",
    cause: "fetch-error",
    underlying: formatUnknown(err),
  };
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
