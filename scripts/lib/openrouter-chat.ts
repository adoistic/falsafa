/**
 * OpenRouter chat completion client with JSON-schema structured outputs.
 *
 * Used by the prompt pipeline (draft → critique → decide) to call
 * anthropic/claude-sonnet-4.6 with strict JSON output.
 *
 * Reference: https://openrouter.ai/docs/features/structured-outputs
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface JsonSchema {
  name: string;
  /** OpenRouter and Anthropic accept the standard JSON Schema dialect. */
  schema: Record<string, unknown>;
  /** Whether to enforce strict schema adherence. */
  strict?: boolean;
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** When provided, the model returns valid JSON matching this schema. */
  json_schema?: JsonSchema;
  /** Sampling controls. Defaults: temp 0.7. */
  temperature?: number;
  max_tokens?: number;
  seed?: number;
  referer?: string;
  appTitle?: string;
}

export interface ChatResult<T = unknown> {
  /** Parsed JSON matching the schema (when json_schema was provided). */
  parsed: T;
  /** Raw text content from the assistant message. */
  raw_content: string;
  /** OpenRouter's full response body (for debug + audit). */
  raw_response: unknown;
  /** Token usage for cost accounting. */
  usage: { prompt: number; completion: number; total: number } | null;
}

const DEFAULT_REFERER = "https://github.com/adoistic/falsafa";
const DEFAULT_TITLE = "Falsafa";

export async function chat<T = unknown>(opts: ChatOptions): Promise<ChatResult<T>> {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.max_tokens !== undefined) body["max_tokens"] = opts.max_tokens;
  if (opts.seed !== undefined) body["seed"] = opts.seed;
  if (opts.json_schema) {
    body["response_format"] = {
      type: "json_schema",
      json_schema: {
        name: opts.json_schema.name,
        strict: opts.json_schema.strict ?? true,
        schema: opts.json_schema.schema,
      },
    };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": opts.referer ?? DEFAULT_REFERER,
      "X-Title": opts.appTitle ?? DEFAULT_TITLE,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenRouter chat ${resp.status}: ${errText.slice(0, 600)}`);
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) {
    throw new Error(`OpenRouter chat returned empty content. raw=${JSON.stringify(data).slice(0, 400)}`);
  }

  let parsed: T;
  if (opts.json_schema) {
    try {
      parsed = JSON.parse(content) as T;
    } catch (err) {
      throw new Error(
        `OpenRouter chat returned non-JSON content despite json_schema: ${(err as Error).message}. content=${content.slice(0, 400)}`,
      );
    }
  } else {
    parsed = content as unknown as T;
  }

  const usage = data.usage
    ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens, total: data.usage.total_tokens }
    : null;

  return {
    parsed,
    raw_content: content,
    raw_response: data,
    usage,
  };
}
