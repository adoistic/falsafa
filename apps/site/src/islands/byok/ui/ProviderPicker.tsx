/**
 * ProviderPicker — accessible radio-group for the four BYOK providers.
 *
 * Per /plan-eng-review run 2 Issue 1.5: ARIA radiogroup pattern for the
 * provider picker. Custom-styled chips, not native radio buttons, but
 * the ARIA semantics match.
 */

import type { JSX } from "preact";
import type { Provider } from "../types";
import { cx } from "./cx";

interface Option {
  value: Provider;
  label: string;
  hint: string;
}

const OPTIONS: Option[] = [
  { value: "openai", label: "OpenAI", hint: "GPT-5.x, sk-... key" },
  { value: "openrouter", label: "OpenRouter", hint: "Any model, sk-or-... key" },
  { value: "anthropic", label: "Anthropic", hint: "Claude, sk-ant-... key" },
  { value: "google", label: "Google", hint: "Gemini, AI... key" },
];

interface Props {
  value: Provider;
  onChange: (provider: Provider) => void;
  disabled?: boolean;
}

export default function ProviderPicker({ value, onChange, disabled }: Props): JSX.Element {
  return (
    <fieldset class="byok-providers" disabled={disabled}>
      <legend class="byok-label">Provider</legend>
      <div class="byok-provider-grid" role="radiogroup" aria-label="LLM provider">
        {OPTIONS.map((opt) => {
          const checked = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={checked}
              class={cx("byok-provider", { "is-active": checked })}
              onClick={() => onChange(opt.value)}
              tabIndex={checked ? 0 : -1}
              onKeyDown={(e) => {
                // Roving tab pattern: Arrow keys move selection within group.
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const idx = OPTIONS.findIndex((o) => o.value === value);
                  const next = OPTIONS[(idx + 1) % OPTIONS.length]!;
                  onChange(next.value);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const idx = OPTIONS.findIndex((o) => o.value === value);
                  const prev = OPTIONS[(idx - 1 + OPTIONS.length) % OPTIONS.length]!;
                  onChange(prev.value);
                }
              }}
            >
              <span class="byok-provider-name">{opt.label}</span>
              <span class="byok-provider-hint">{opt.hint}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
