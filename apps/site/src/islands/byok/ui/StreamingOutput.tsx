/**
 * StreamingOutput — the live response area.
 *
 * Renders tool calls inline + assistant text below + a status indicator
 * matching the current state. Per /plan-eng-review run 2 Issue 4.4, the
 * actual rAF coalescing of text deltas happens upstream (in ByokDemo or
 * the useStreaming hook in Checkpoint 7). This component just renders.
 *
 * aria-live announcements per the eng review: tool-call boundaries fire,
 * not per-token. Tool-call status text uses aria-live="polite" so screen
 * readers hear "Calling search_corpus" when the call starts.
 */

import type { JSX } from "preact";
import type { BYOKState } from "../types";
import ToolCallCard from "./ToolCallCard";

interface Props {
  state: BYOKState;
}

export default function StreamingOutput({ state }: Props): JSX.Element | null {
  // Don't render until something has happened.
  if (
    state.status === "setup" ||
    state.status === "submitting" && state.toolCalls.length === 0 && !state.output
  ) {
    return state.status === "submitting" ? (
      <div class="byok-output byok-output-pending" aria-live="polite">
        <div class="byok-spinner" aria-hidden="true" />
        <p>Asking your provider…</p>
      </div>
    ) : null;
  }

  return (
    <section class="byok-output" aria-label="Falsafa response">
      {state.toolCalls.length > 0 && (
        <div class="byok-toolcalls">
          {state.toolCalls.map((call) => (
            <ToolCallCard key={call.id} call={call} />
          ))}
        </div>
      )}

      {state.output && (
        <div class="byok-output-text" aria-live="polite">
          {state.output}
        </div>
      )}

      <StatusIndicator status={state.status} />
    </section>
  );
}

function StatusIndicator({ status }: { status: BYOKState["status"] }): JSX.Element | null {
  if (status === "streaming") {
    return (
      <p class="byok-status byok-status-streaming" aria-live="polite">
        <span class="byok-status-dot" aria-hidden="true" />
        Streaming…
      </p>
    );
  }
  if (status === "success") {
    return (
      <p class="byok-status byok-status-done">
        Done.
      </p>
    );
  }
  if (status === "partial-tool-use-abort") {
    return (
      <p class="byok-status byok-status-stopped">
        Stopped. Partial output above.
      </p>
    );
  }
  if (status === "no-result-found") {
    return (
      <p class="byok-status byok-status-empty">
        The model returned no result. The corpus may not cover this question.
      </p>
    );
  }
  return null;
}
