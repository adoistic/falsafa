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

function describe(error: ByokError): Description {
  switch (error.kind) {
    case "invalid-key":
      return {
        title: "Your API key didn't work.",
        message: `Provider: ${error.provider}. Status ${error.status}. Check the key, or switch providers.`,
        primaryLabel: "Edit and retry",
        primaryAction: "retry",
        severity: "block",
      };
    case "rate-limited":
      return {
        title: "Rate limited.",
        message: error.retryAfterMs
          ? `Provider: ${error.provider}. Try again in about ${Math.ceil(error.retryAfterMs / 1000)}s.`
          : `Provider: ${error.provider}. Wait a moment and try again.`,
        primaryLabel: "Retry",
        primaryAction: "retry",
        severity: "warn",
      };
    case "network-disconnect":
      return {
        title: "Lost connection.",
        message:
          "The stream stopped before finishing. Resume isn't available — start over with the same question if you want.",
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
  }
}
