/**
 * Model catalogs for the BYOK demo's per-provider picker.
 *
 * - OpenAI / Anthropic / Google: hardcoded curated lists. Frontier-tier
 *   model namespaces are stable enough that a quarterly hand-edit is
 *   the right cadence; auto-fetching the OpenAI /v1/models list would
 *   surface every fine-tune and embed model the user can't actually
 *   chat with.
 * - OpenRouter: fetched live from /api/v1/models. Their list is
 *   public (no key required), updates as new models land, and includes
 *   pricing + context-length metadata that the UI can show. Cached in
 *   localStorage with a TTL so we don't refetch on every page load.
 */

import type { Provider } from "./types";

export interface ModelOption {
  id: string;
  name: string;
  contextLength?: number;
  /** Dollar cost per 1M input tokens. Undefined if unknown. */
  inputPricePerMtok?: number;
  /** Dollar cost per 1M output tokens. Undefined if unknown. */
  outputPricePerMtok?: number;
  /** Optional grouping key for UI categorization (e.g., "Claude", "GPT"). */
  family?: string;
}

// ── Curated lists (frontier + fast-and-cheap tier each) ────────────────

const OPENAI_MODELS: ModelOption[] = [
  { id: "gpt-5.4", name: "GPT-5.4", contextLength: 1000000, family: "GPT-5" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 mini", contextLength: 1000000, family: "GPT-5" },
  { id: "gpt-5.4-nano", name: "GPT-5.4 nano", contextLength: 1000000, family: "GPT-5" },
  { id: "gpt-5.4-pro", name: "GPT-5.4 Pro", contextLength: 1000000, family: "GPT-5" },
  { id: "gpt-5.2", name: "GPT-5.2", contextLength: 400000, family: "GPT-5" },
  { id: "gpt-5", name: "GPT-5", contextLength: 200000, family: "GPT-5" },
  { id: "gpt-4.1", name: "GPT-4.1", contextLength: 1000000, family: "GPT-4" },
  { id: "gpt-4o", name: "GPT-4o", contextLength: 128000, family: "GPT-4" },
];

const ANTHROPIC_MODELS: ModelOption[] = [
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    contextLength: 1000000,
    family: "Claude 4",
  },
  {
    id: "claude-sonnet-4-7",
    name: "Claude Sonnet 4.7",
    contextLength: 1000000,
    family: "Claude 4",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    contextLength: 200000,
    family: "Claude 4",
  },
  {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    contextLength: 200000,
    family: "Claude 4",
  },
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    contextLength: 1000000,
    family: "Claude 4",
  },
];

const GOOGLE_MODELS: ModelOption[] = [
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    contextLength: 2000000,
    family: "Gemini 2",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    contextLength: 1000000,
    family: "Gemini 2",
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    contextLength: 1000000,
    family: "Gemini 2",
  },
];

/** First entry of each list is the default for that provider. */
export const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  openai: OPENAI_MODELS[0]!.id,
  openrouter: "anthropic/claude-sonnet-4.5", // popular OpenRouter default
  anthropic: ANTHROPIC_MODELS[1]!.id, // Sonnet — best speed/quality balance
  google: GOOGLE_MODELS[1]!.id, // 2.5 Flash — fast and cheap default
};

export function curatedModels(provider: Provider): ModelOption[] {
  switch (provider) {
    case "openai":
      return OPENAI_MODELS;
    case "anthropic":
      return ANTHROPIC_MODELS;
    case "google":
      return GOOGLE_MODELS;
    case "openrouter":
      return []; // populated dynamically; see fetchOpenRouterModels
  }
}

// ── Dynamic fetch (per-provider) ───────────────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour for all providers
const CACHE_KEY: Record<Provider, string> = {
  openai: "falsafa-openai-models",
  anthropic: "falsafa-anthropic-models",
  google: "falsafa-google-models",
  openrouter: "falsafa-openrouter-models",
};

const OPENROUTER_CACHE_KEY = CACHE_KEY.openrouter;
const OPENROUTER_CACHE_TTL_MS = CACHE_TTL_MS;

interface OpenRouterApiModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

interface CacheEntry {
  ts: number;
  data: ModelOption[];
}

/**
 * Fetch + parse the OpenRouter model list. Cached for 1 hour in
 * localStorage so we don't refetch on every page load.
 *
 * The OpenRouter /api/v1/models endpoint is public — no API key
 * required for the catalog itself. The user's key only matters when
 * they actually call a model.
 */
export async function fetchOpenRouterModels(opts: {
  /** Force refresh, bypassing the cache. */
  force?: boolean;
  /** Custom fetch (for tests). */
  fetch?: typeof globalThis.fetch;
} = {}): Promise<ModelOption[]> {
  if (!opts.force) {
    const cached = readCache();
    if (cached) return cached;
  }

  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const res = await fetchImpl("https://openrouter.ai/api/v1/models");
  if (!res.ok) {
    throw new Error(`OpenRouter list fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as { data: OpenRouterApiModel[] };
  const parsed: ModelOption[] = body.data.map((m) => ({
    id: m.id,
    name: m.name,
    contextLength: m.context_length,
    inputPricePerMtok: m.pricing?.prompt ? Number(m.pricing.prompt) * 1_000_000 : undefined,
    outputPricePerMtok: m.pricing?.completion
      ? Number(m.pricing.completion) * 1_000_000
      : undefined,
    family: classifyOpenRouterFamily(m.id),
  }));

  writeCache(parsed);
  return parsed;
}

/** Bucket OpenRouter ids into recognizable families for UI grouping. */
function classifyOpenRouterFamily(id: string): string {
  const lower = id.toLowerCase();
  if (lower.startsWith("anthropic/") || lower.includes("claude")) return "Claude";
  if (lower.startsWith("openai/") || lower.includes("gpt-") || lower.includes("o1") || lower.includes("o3"))
    return "GPT";
  if (lower.startsWith("google/") || lower.includes("gemini")) return "Gemini";
  if (lower.includes("llama") || lower.startsWith("meta-llama/")) return "Llama";
  if (lower.includes("mistral") || lower.includes("mixtral")) return "Mistral";
  if (lower.includes("deepseek")) return "DeepSeek";
  if (lower.includes("qwen")) return "Qwen";
  if (lower.includes("grok")) return "Grok";
  if (lower.includes("command")) return "Cohere";
  return "Other";
}

function readCache(): ModelOption[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(OPENROUTER_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.ts > OPENROUTER_CACHE_TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function writeCache(data: ModelOption[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const entry: CacheEntry = { ts: Date.now(), data };
    localStorage.setItem(OPENROUTER_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* fall through silently */
  }
}

// ── Generic per-provider cache helpers ─────────────────────────────────

function readProviderCache(provider: Provider): ModelOption[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CACHE_KEY[provider]);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function writeProviderCache(provider: Provider, data: ModelOption[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const entry: CacheEntry = { ts: Date.now(), data };
    localStorage.setItem(CACHE_KEY[provider], JSON.stringify(entry));
  } catch {
    /* fall through silently */
  }
}

/** Public: read cached models without forcing a fetch. Returns null if no fresh cache. */
export function cachedModels(provider: Provider): ModelOption[] | null {
  return readProviderCache(provider);
}

// ── OpenAI dynamic fetch ───────────────────────────────────────────────

interface OpenAIModelsResponse {
  data: Array<{ id: string; object: string; created?: number; owned_by?: string }>;
}

/**
 * Fetch the OpenAI model catalog using the user's API key. Filters to
 * chat-capable models (excludes embeddings, images, audio, transcription).
 */
export async function fetchOpenAIModels(opts: {
  apiKey: string;
  baseURL?: string; // override for OpenRouter when sk-or- is detected
  force?: boolean;
  fetch?: typeof globalThis.fetch;
}): Promise<ModelOption[]> {
  if (!opts.force) {
    const cached = readProviderCache("openai");
    if (cached) return cached;
  }
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const baseURL = opts.baseURL ?? "https://api.openai.com/v1";
  const res = await fetchImpl(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`OpenAI list fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as OpenAIModelsResponse;

  const parsed: ModelOption[] = body.data
    .filter((m) => isOpenAIChatModel(m.id))
    .map((m) => ({
      id: m.id,
      name: humanizeOpenAIId(m.id),
      family: classifyOpenAIFamily(m.id),
    }))
    .sort((a, b) => b.id.localeCompare(a.id)); // newest first by id

  writeProviderCache("openai", parsed);
  return parsed;
}

function isOpenAIChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  // Exclude non-chat model families.
  if (
    lower.includes("embedding") ||
    lower.includes("whisper") ||
    lower.includes("tts") ||
    lower.includes("dall-e") ||
    lower.includes("davinci") ||
    lower.includes("babbage") ||
    lower.includes("ada") ||
    lower.includes("curie") ||
    lower.includes("moderation") ||
    lower.includes("instruct") ||
    lower.includes("realtime") ||
    lower.includes("audio")
  ) {
    return false;
  }
  // Include chat-capable families.
  return (
    lower.startsWith("gpt-") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.startsWith("chatgpt-")
  );
}

function humanizeOpenAIId(id: string): string {
  // gpt-5.4-mini → "GPT-5.4 mini"
  return id
    .replace(/^gpt-/, "GPT-")
    .replace(/-mini\b/, " mini")
    .replace(/-nano\b/, " nano")
    .replace(/-pro\b/, " Pro");
}

function classifyOpenAIFamily(id: string): string {
  if (id.startsWith("gpt-5")) return "GPT-5";
  if (id.startsWith("gpt-4")) return "GPT-4";
  if (id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4")) return "o-series";
  return "Other";
}

// ── Anthropic dynamic fetch ────────────────────────────────────────────

interface AnthropicModelsResponse {
  data: Array<{ type: string; id: string; display_name: string; created_at?: string }>;
}

/**
 * Fetch the Anthropic model catalog using the user's API key. Anthropic
 * exposes /v1/models since late 2024 — requires the
 * `anthropic-dangerous-direct-browser-access: true` header for browser
 * calls plus `x-api-key`.
 */
export async function fetchAnthropicModels(opts: {
  apiKey: string;
  force?: boolean;
  fetch?: typeof globalThis.fetch;
}): Promise<ModelOption[]> {
  if (!opts.force) {
    const cached = readProviderCache("anthropic");
    if (cached) return cached;
  }
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const res = await fetchImpl("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  if (!res.ok) {
    throw new Error(`Anthropic list fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as AnthropicModelsResponse;

  const parsed: ModelOption[] = body.data
    .filter((m) => m.type === "model")
    .map((m) => ({
      id: m.id,
      name: m.display_name,
      family: classifyAnthropicFamily(m.id),
    }))
    .sort((a, b) => b.id.localeCompare(a.id));

  writeProviderCache("anthropic", parsed);
  return parsed;
}

function classifyAnthropicFamily(id: string): string {
  const lower = id.toLowerCase();
  if (lower.includes("opus")) return "Opus";
  if (lower.includes("sonnet")) return "Sonnet";
  if (lower.includes("haiku")) return "Haiku";
  return "Claude";
}

// ── Google dynamic fetch ───────────────────────────────────────────────

interface GoogleModelsResponse {
  models: Array<{
    name: string; // "models/gemini-2.5-pro"
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
}

/**
 * Fetch the Google Generative AI model catalog. The endpoint takes the
 * key as a `?key=` query param (Google's convention). Filters to
 * generateContent-capable models (excludes embedding-only).
 */
export async function fetchGoogleModels(opts: {
  apiKey: string;
  force?: boolean;
  fetch?: typeof globalThis.fetch;
}): Promise<ModelOption[]> {
  if (!opts.force) {
    const cached = readProviderCache("google");
    if (cached) return cached;
  }
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Google list fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as GoogleModelsResponse;

  const parsed: ModelOption[] = body.models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => {
      // "models/gemini-2.5-pro" → "gemini-2.5-pro"
      const id = m.name.replace(/^models\//, "");
      return {
        id,
        name: m.displayName ?? id,
        contextLength: m.inputTokenLimit,
        family: classifyGoogleFamily(id),
      };
    })
    .sort((a, b) => b.id.localeCompare(a.id));

  writeProviderCache("google", parsed);
  return parsed;
}

function classifyGoogleFamily(id: string): string {
  if (id.includes("gemini-2.5") || id.includes("gemini-2-5")) return "Gemini 2.5";
  if (id.includes("gemini-2") || id.includes("gemini-2-")) return "Gemini 2";
  if (id.includes("gemini-1.5") || id.includes("gemini-1-5")) return "Gemini 1.5";
  return "Gemini";
}
