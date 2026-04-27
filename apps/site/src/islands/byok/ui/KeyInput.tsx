/**
 * KeyInput — password input + Forget button for the BYOK API key.
 *
 * Security per /plan-eng-review run 2 Issue 2.3:
 * - input type="password" so session-replay tools auto-redact
 * - Visible "Forget my key" clears state + localStorage on demand
 * - "Remember on this device" checkbox controls whether SUBMIT persists
 */

import type { JSX } from "preact";

interface Props {
  value: string;
  remember: boolean;
  hasStored: boolean;
  onChange: (key: string) => void;
  onRememberToggle: (remember: boolean) => void;
  onForget: () => void;
  disabled?: boolean;
}

export default function KeyInput({
  value,
  remember,
  hasStored,
  onChange,
  onRememberToggle,
  onForget,
  disabled,
}: Props): JSX.Element {
  return (
    <div class="byok-key">
      <label class="byok-label" for="byok-key-input">
        API key
      </label>
      <div class="byok-key-row">
        <input
          id="byok-key-input"
          type="password"
          class="byok-input byok-input-key"
          value={value}
          autocomplete="off"
          spellcheck={false}
          placeholder="sk-..., sk-or-..., sk-ant-..., AI..."
          aria-describedby="byok-key-help"
          disabled={disabled}
          onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
        />
        {hasStored && (
          <button
            type="button"
            class="byok-button byok-button-ghost"
            onClick={onForget}
            disabled={disabled}
          >
            Forget my key
          </button>
        )}
      </div>
      <div class="byok-key-meta">
        <label class="byok-checkbox">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => onRememberToggle((e.currentTarget as HTMLInputElement).checked)}
            disabled={disabled}
          />
          <span>Remember on this device</span>
        </label>
        <p id="byok-key-help" class="byok-help">
          Your key stays in your browser. Falsafa never sees it. Calls go straight to your provider.
        </p>
      </div>
    </div>
  );
}
