/**
 * ErrorBanner — discriminated-union-driven error UI.
 *
 * Each ByokError kind maps to its own banner with a tailored message and
 * recovery affordance. Per /plan-eng-review run 2 Issue 1.5: network drop
 * offers "Start over" only (no false-promise resume); user-stop preserves
 * partial output above; token cap explains.
 */

import type { JSX } from "preact";
import type { ByokError } from "../types";
import { cx } from "./cx";

interface Props {
  error: ByokError;
  onRetry: () => void;
  onNewQuestion: () => void;
}

export default function ErrorBanner({ error, onRetry, onNewQuestion }: Props): JSX.Element {
  const { title, message, primaryLabel, primaryAction, severity } = describe(error);
  const handlePrimary = primaryAction === "retry" ? onRetry : onNewQuestion;

  return (
    <div class={cx("byok-error", `byok-error-${severity}`)} role="alert">
      <div class="byok-error-text">
        <p class="byok-error-title">{title}</p>
        <p class="byok-error-message">{message}</p>
      </div>
      <div class="byok-error-actions">
        <button type="button" class="byok-button byok-button-primary" onClick={handlePrimary}>
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}

interface Description {
  title: string;
  message: string;
  primaryLabel: string;
  primaryAction: "retry" | "new-question";
  severity: "warn" | "block";
}

function humanizeProvider(p: string): string {
  switch (p) {
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    default:
      return p;
  }
}

function describe(error: ByokError): Description {
  switch (error.kind) {
    case "invalid-key": {
      const p = humanizeProvider(error.provider);
      const detail = error.message ? ` ${p} said: "${error.message}".` : "";
      return {
        title: "Your API key didn't work.",
        message: `Status ${error.status} from ${p}.${detail} Check the key, or switch providers.`,
        primaryLabel: "Edit and retry",
        primaryAction: "retry",
        severity: "block",
      };
    }
    case "rate-limited": {
      const p = humanizeProvider(error.provider);
      const wait = error.retryAfterMs
        ? `Try again in about ${Math.ceil(error.retryAfterMs / 1000)}s.`
        : "Wait a moment and try again.";
      const detail = error.message ? ` ${p} said: "${error.message}".` : "";
      return {
        title: "Rate limited.",
        message: `${p} is throttling you.${detail} ${wait}`,
        primaryLabel: "Retry",
        primaryAction: "retry",
        severity: "warn",
      };
    }
    case "network-disconnect":
      return {
        title: "Lost connection.",
        message: error.underlying
          ? `The stream stopped: "${error.underlying}". Resume isn't available — start over with the same question if you want.`
          : "The stream stopped before finishing. Resume isn't available — start over with the same question if you want.",
        primaryLabel: "Start over",
        primaryAction: "retry",
        severity: "warn",
      };
    case "partial-tool-use-abort":
      return {
        title:
          error.reason === "user-stopped"
            ? "Stopped."
            : error.reason === "token-cap"
              ? "Model hit its output limit."
              : "Stream interrupted.",
        message:
          error.reason === "user-stopped"
            ? "Partial output is preserved above."
            : error.reason === "token-cap"
              ? "This is what the model produced before running out of tokens. The remainder is missing."
              : "Something cut the stream short. Partial output is above.",
        primaryLabel: "New question",
        primaryAction: "new-question",
        severity: "warn",
      };
    case "no-result-found":
      return {
        title: "No result.",
        message: `The model returned without text (finish reason: ${error.finishReason}). The corpus may not cover this question, or the model declined to answer.`,
        primaryLabel: "Try a different question",
        primaryAction: "new-question",
        severity: "warn",
      };
    case "provider-not-browser-supported":
      return {
        title: `${humanizeProvider(error.provider)} doesn't allow direct browser calls.`,
        message:
          "Their API blocks CORS for chat completions. Switch to OpenRouter — your sk-or-... key works for every OpenAI model plus Claude, Gemini, Llama, and 300+ more.",
        primaryLabel: "Edit and retry",
        primaryAction: "retry",
        severity: "block",
      };
    case "other": {
      const p = humanizeProvider(error.provider);
      const status = error.status ? ` (HTTP ${error.status})` : "";
      return {
        title: `${p} error${status}.`,
        message: error.message,
        primaryLabel: "Edit and retry",
        primaryAction: "retry",
        severity: "warn",
      };
    }
  }
}
