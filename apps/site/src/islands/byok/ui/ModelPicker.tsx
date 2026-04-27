/**
 * ModelPicker — model selector that adapts to the chosen provider.
 *
 * - OpenAI / Anthropic / Google: curated default list, with a "Refresh
 *   from your key" affordance that fetches the live model catalog from
 *   the provider's /models endpoint and replaces the list. Auto-fetches
 *   silently when a key is present and the cache has expired.
 * - OpenRouter: hundreds of models. Combobox with family filter +
 *   search input, fetched live from openrouter.ai/api/v1/models. The
 *   OpenRouter list is public — no key required for the catalog.
 *
 * All caches live in localStorage with a 1-hour TTL. The picker reads
 * cache on mount; a stale or missing cache triggers a refetch the first
 * time the user opens the model dropdown (or clicks Refresh).
 */

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { Provider } from "../types";
import {
  curatedModels,
  cachedModels,
  fetchOpenRouterModels,
  fetchOpenAIModels,
  fetchAnthropicModels,
  fetchGoogleModels,
  type ModelOption,
} from "../models";
import { cx } from "./cx";

interface Props {
  provider: Provider;
  apiKey: string;
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

export default function ModelPicker(props: Props): JSX.Element {
  if (props.provider === "openrouter") {
    return <OpenRouterPicker {...props} />;
  }
  return <KeyedSelect {...props} />;
}

// ── Curated select for OpenAI / Anthropic / Google ───────────────────
// Shows the curated list by default, lets the user load the live list
// from their provider once a key is present.

function KeyedSelect({ provider, apiKey, value, onChange, disabled }: Props): JSX.Element {
  const curated = curatedModels(provider);
  const [live, setLive] = useState<ModelOption[] | null>(() => cachedModels(provider));
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // If a key is present and cache is stale, refresh silently in the background.
  useEffect(() => {
    if (!apiKey || apiKey.length < 8 || live) return;
    runFetch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  function runFetch(force: boolean): void {
    if (!apiKey) return;
    setStatus("loading");
    setErrorMsg(null);
    fetcherFor(provider, apiKey, force)
      .then((list) => {
        setLive(list);
        setStatus("idle");
      })
      .catch((err) => {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
  }

  // Live list takes priority. Fall back to curated.
  const options = live ?? curated;
  const selected = options.find((m) => m.id === value);

  // Group by family for the optgroup view.
  const groups = useMemo(() => {
    const byFamily: Record<string, ModelOption[]> = {};
    for (const m of options) {
      const fam = m.family ?? "Other";
      (byFamily[fam] ??= []).push(m);
    }
    return Object.entries(byFamily);
  }, [options]);

  return (
    <div class="byok-model">
      <label class="byok-label" for="byok-model-select">
        Model
      </label>
      <div class="byok-model-row">
        <select
          id="byok-model-select"
          class="byok-input byok-input-select"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
        >
          {groups.map(([family, models]) => (
            <optgroup label={family} key={family}>
              {models.map((opt) => (
                <option value={opt.id}>
                  {opt.name}
                  {opt.contextLength ? ` · ${formatContext(opt.contextLength)} ctx` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          class="byok-button byok-button-ghost byok-model-refresh"
          onClick={() => runFetch(true)}
          disabled={!apiKey || status === "loading" || disabled}
          title={
            !apiKey
              ? "Paste a key first to load the live model list"
              : "Fetch the latest models from your provider"
          }
        >
          {status === "loading" ? "Loading..." : live ? "Refresh" : "Load latest"}
        </button>
      </div>
      <p class="byok-help byok-model-detail">
        {selected ? <>Model id: <code>{selected.id}</code></> : null}
        {live ? (
          <span class="byok-model-source"> · live from {humanizeProvider(provider)}</span>
        ) : (
          <span class="byok-model-source"> · curated default</span>
        )}
        {status === "error" && errorMsg && (
          <span class="byok-model-error"> · couldn't load: {errorMsg}</span>
        )}
      </p>
    </div>
  );
}

function fetcherFor(
  provider: Provider,
  apiKey: string,
  force: boolean,
): Promise<ModelOption[]> {
  switch (provider) {
    case "openai":
      return fetchOpenAIModels({ apiKey, force });
    case "anthropic":
      return fetchAnthropicModels({ apiKey, force });
    case "google":
      return fetchGoogleModels({ apiKey, force });
    case "openrouter":
      return fetchOpenRouterModels({ force });
  }
}

function humanizeProvider(p: Provider): string {
  switch (p) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    case "openrouter":
      return "OpenRouter";
  }
}

// ── OpenRouter combobox ──────────────────────────────────────────────

const FAMILY_ORDER = [
  "All",
  "Claude",
  "GPT",
  "Gemini",
  "Llama",
  "Mistral",
  "DeepSeek",
  "Qwen",
  "Grok",
  "Cohere",
  "Other",
];

function OpenRouterPicker({ value, onChange, disabled }: Props): JSX.Element {
  const [models, setModels] = useState<ModelOption[]>(() => cachedModels("openrouter") ?? []);
  const [status, setStatus] = useState<"idle" | "loading" | "error">(
    cachedModels("openrouter") ? "idle" : "loading",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState<string>("All");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Fetch on mount unless cache hot.
  useEffect(() => {
    if (models.length > 0) return;
    let cancelled = false;
    setStatus("loading");
    fetchOpenRouterModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setStatus("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const families = useMemo(() => {
    const present = new Set(models.map((m) => m.family ?? "Other"));
    return FAMILY_ORDER.filter((f) => f === "All" || present.has(f));
  }, [models]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (family !== "All" && (m.family ?? "Other") !== family) return false;
      if (q && !m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [models, search, family]);

  const selected = models.find((m) => m.id === value);

  return (
    <div class="byok-model" ref={wrapRef}>
      <label class="byok-label" for="byok-model-trigger">
        Model
      </label>
      <button
        id="byok-model-trigger"
        type="button"
        class="byok-input byok-model-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        <span class="byok-model-trigger-name">
          {selected ? selected.name : value || "Pick a model..."}
        </span>
        <span class="byok-model-trigger-meta">
          {selected?.contextLength ? `${formatContext(selected.contextLength)} ctx` : ""}
          {selected?.inputPricePerMtok !== undefined
            ? `  ·  $${formatPrice(selected.inputPricePerMtok)}/Mtok in`
            : ""}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {open && (
        <div class="byok-model-popover" role="dialog" aria-label="OpenRouter model picker">
          <div class="byok-model-popover-controls">
            <input
              ref={inputRef}
              type="search"
              class="byok-input byok-model-search"
              placeholder="Search 300+ models..."
              value={search}
              onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
              aria-label="Filter models"
              autofocus
            />
            <div class="byok-model-families" role="tablist">
              {families.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={family === f}
                  class={cx("byok-model-family", { "is-active": family === f })}
                  onClick={() => setFamily(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div class="byok-model-list" role="listbox" aria-label="Available models">
            {status === "loading" && (
              <p class="byok-model-status">Loading from openrouter.ai...</p>
            )}
            {status === "error" && (
              <p class="byok-model-status byok-model-status-error">
                Couldn't load model list: {errorMsg}.
                <button
                  type="button"
                  class="byok-button byok-button-ghost"
                  onClick={() => {
                    setStatus("loading");
                    fetchOpenRouterModels({ force: true })
                      .then((list) => {
                        setModels(list);
                        setStatus("idle");
                      })
                      .catch((err) => {
                        setStatus("error");
                        setErrorMsg(err instanceof Error ? err.message : String(err));
                      });
                  }}
                >
                  Retry
                </button>
              </p>
            )}
            {status === "idle" && filtered.length === 0 && (
              <p class="byok-model-status">No models match.</p>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={m.id === value}
                class={cx("byok-model-row-button", { "is-selected": m.id === value })}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
              >
                <span class="byok-model-row-name">{m.name}</span>
                <span class="byok-model-row-id">{m.id}</span>
                <span class="byok-model-row-meta">
                  {m.contextLength ? formatContext(m.contextLength) + " ctx" : ""}
                  {m.inputPricePerMtok !== undefined
                    ? `  ·  $${formatPrice(m.inputPricePerMtok)} / $${formatPrice(m.outputPricePerMtok ?? 0)} per Mtok`
                    : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <p class="byok-help">
        OpenRouter exposes Claude, GPT, Gemini, Llama, and dozens more from one key. Catalog cached for 1 hour.
      </p>
    </div>
  );
}

// ── Formatters ───────────────────────────────────────────────────────

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return tokens.toString();
}

function formatPrice(perMtok: number): string {
  if (perMtok < 0.01) return perMtok.toFixed(4);
  if (perMtok < 1) return perMtok.toFixed(2);
  return perMtok.toFixed(2);
}
