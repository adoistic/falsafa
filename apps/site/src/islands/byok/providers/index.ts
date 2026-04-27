/**
 * Provider registry. Each provider's actual adapter is loaded lazily via
 * dynamic import so the bundle ships only the chosen provider's code.
 *
 * Per /plan-eng-review run 2 Issue 4.2: dynamic provider imports keep the
 * /try page under its 60KB JS budget.
 */

import type { NormalizedEvent, Provider } from "../types";

export interface ProviderAdapterArgs {
  /** Which provider this call is for. Threaded through so error messages
   * carry the actual user-facing label (OpenRouter vs OpenAI). */
  provider: Provider;
  apiKey: string;
  question: string;
  abortSignal: AbortSignal;
  /**
   * Resolves a tool call from the model. The implementation is injected by
   * the BYOK island (which decides whether to run tools in-browser or hit
   * a remote MCP server, per design Q1).
   */
  onToolCall: (name: string, args: unknown) => Promise<unknown>;
  /** Optional model id override. Each adapter has a sensible default. */
  modelId?: string;
  /** Optional fetch override — used by tests to replay recorded streams. */
  fetch?: typeof globalThis.fetch;
}

/**
 * The shape every provider adapter exports. Adapters are loaded lazily
 * via the registry below.
 */
export type StreamFn = (args: ProviderAdapterArgs) => AsyncIterable<NormalizedEvent>;

/**
 * Lazy-load a provider adapter. Only the chosen provider's code +
 * dependencies are downloaded.
 */
export async function loadAdapter(provider: Provider): Promise<StreamFn> {
  switch (provider) {
    case "openai":
    case "openrouter": {
      const mod = await import("./openai");
      return mod.streamOpenAI;
    }
    case "anthropic": {
      const mod = await import("./anthropic");
      return mod.streamAnthropic;
    }
    case "google": {
      const mod = await import("./google");
      return mod.streamGoogle;
    }
  }
}
