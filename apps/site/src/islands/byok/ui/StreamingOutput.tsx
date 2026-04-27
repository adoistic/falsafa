/**
 * StreamingOutput — the live response area.
 *
 * Renders the streaming timeline chronologically: model commentary
 * interleaved with the tool calls it spawned. When the model finishes
 * tool use and starts the synthesized answer, that final text gets
 * promoted to a prominent "Answer" panel rendered as full markdown.
 *
 * The "thinking" log (commentary + tool cards) is toggleable —
 * collapsed by default once a final answer exists, so a casual reader
 * sees the answer first and the audit trail is one click away.
 *
 * Per /plan-eng-review run 2 Issue 4.4, text deltas re-render naively
 * for now; rAF coalescing is a separate Phase 2 Checkpoint 7 item.
 */

import { useState, useMemo, useEffect } from "preact/hooks";
import type { JSX } from "preact";
import type { BYOKState, TimelineEntry, ToolCall } from "../types";
import ToolCallCard from "./ToolCallCard";
import MarkdownView from "./MarkdownView";

interface Props {
  state: BYOKState;
}

export default function StreamingOutput({ state }: Props): JSX.Element | null {
  const [showThinking, setShowThinking] = useState(true);
  const isStreaming = state.status === "streaming" || state.status === "submitting";
  const finalAnswer = useMemo(() => extractFinalAnswer(state.timeline), [state.timeline]);
  const hasFinalAnswer = finalAnswer !== null && finalAnswer.text.length > 0;
  const isComplete =
    state.status === "success" ||
    state.status === "partial-tool-use-abort" ||
    state.status === "no-result-found";

  // Auto-collapse thinking when the model produces a final answer (post-stream),
  // but never in mid-stream — the user wants to see what's happening live.
  useEffect(() => {
    if (isComplete && hasFinalAnswer) setShowThinking(false);
  }, [isComplete, hasFinalAnswer]);

  // Setup state with no activity yet → render nothing.
  if (state.status === "setup") return null;

  // Submitted but no first chunk → spinner only.
  if (state.status === "submitting" && state.timeline.length === 0) {
    return (
      <div class="byok-output byok-output-pending" aria-live="polite">
        <div class="byok-spinner" aria-hidden="true" />
        <p>Asking your provider…</p>
      </div>
    );
  }

  return (
    <section class="byok-output" aria-label="Falsafa response">
      {/* Final answer panel — visible when we have one. While streaming,
          the timeline below contains the most recent text segment, which
          the model is still extending; we don't promote it yet. */}
      {hasFinalAnswer && (
        <div class="byok-answer">
          <MarkdownView text={finalAnswer.text} />
        </div>
      )}

      {/* Toggle for the thinking trail. Hidden if there's nothing to hide. */}
      {state.timeline.length > 0 && (
        <div class="byok-thinking-controls">
          <button
            type="button"
            class="byok-button byok-button-ghost"
            onClick={() => setShowThinking((v) => !v)}
            aria-expanded={showThinking}
            aria-controls="byok-thinking-log"
          >
            {showThinking ? "Hide" : "Show"} thinking
            <span class="byok-thinking-meta">
              {" "}· {countThinkingItems(state.timeline, finalAnswer)}
            </span>
          </button>
        </div>
      )}

      {/* The interleaved log itself. */}
      {showThinking && state.timeline.length > 0 && (
        <div id="byok-thinking-log" class="byok-thinking">
          {renderTimeline(state.timeline, state.toolCalls, finalAnswer, isStreaming)}
        </div>
      )}

      <StatusIndicator status={state.status} hasFinalAnswer={hasFinalAnswer} />
    </section>
  );
}

// ── Timeline rendering ────────────────────────────────────────────────

function renderTimeline(
  timeline: TimelineEntry[],
  toolCalls: ToolCall[],
  finalAnswer: { entryIndex: number; text: string } | null,
  isStreaming: boolean,
): JSX.Element[] {
  const callsById = new Map(toolCalls.map((c) => [c.id, c]));
  const out: JSX.Element[] = [];

  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i]!;
    const isFinal = finalAnswer !== null && i === finalAnswer.entryIndex;

    // The final-answer entry is rendered above (in the .byok-answer panel).
    // In the thinking log we still render it as "Final answer" stub so the
    // chronology is complete — but only when the user has expanded "show
    // thinking" AND the answer is in its own panel. Skip the duplicate to
    // avoid showing the same prose twice. Exception: while still streaming,
    // we want the partial final text visible in-place.
    if (isFinal && !isStreaming) continue;

    if (entry.kind === "text") {
      out.push(
        <div class="byok-timeline-text" key={`t-${i}`}>
          <MarkdownView text={entry.text} inline />
        </div>,
      );
    } else if (entry.kind === "tool-call") {
      const call = callsById.get(entry.id);
      if (call) {
        out.push(<ToolCallCard call={call} key={`tc-${entry.id}`} />);
      }
    }
  }
  return out;
}

/**
 * The "final answer" is the last text entry IF it follows the last tool
 * call. If the model writes commentary then calls a tool then writes more
 * commentary, only the trailing text after the last tool counts.
 *
 * If there are no tool calls at all (the model answered directly), the
 * single text entry is the final answer.
 */
function extractFinalAnswer(
  timeline: TimelineEntry[],
): { entryIndex: number; text: string } | null {
  if (timeline.length === 0) return null;
  // Find index of last tool-call entry (or -1 if none).
  let lastTool = -1;
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]!.kind === "tool-call") {
      lastTool = i;
      break;
    }
  }
  // The final answer candidate is the last entry, IF it's text and it's
  // after the last tool call. Otherwise no final answer yet.
  const last = timeline[timeline.length - 1]!;
  if (last.kind !== "text") return null;
  if (timeline.length - 1 <= lastTool) return null;
  // Promote even short text — the model might still be streaming. Once
  // the stream finishes, very short trailing text isn't really an answer
  // (e.g., just "Done."), but we let the UI show what's there.
  return { entryIndex: timeline.length - 1, text: last.text };
}

function countThinkingItems(
  timeline: TimelineEntry[],
  finalAnswer: { entryIndex: number; text: string } | null,
): string {
  let texts = 0;
  let tools = 0;
  for (let i = 0; i < timeline.length; i++) {
    if (finalAnswer && i === finalAnswer.entryIndex) continue;
    if (timeline[i]!.kind === "text") texts++;
    else tools++;
  }
  const parts: string[] = [];
  if (tools > 0) parts.push(`${tools} tool call${tools === 1 ? "" : "s"}`);
  if (texts > 0) parts.push(`${texts} note${texts === 1 ? "" : "s"}`);
  return parts.join(" + ") || "0 items";
}

// ── Status indicator ──────────────────────────────────────────────────

function StatusIndicator({
  status,
  hasFinalAnswer,
}: {
  status: BYOKState["status"];
  hasFinalAnswer: boolean;
}): JSX.Element | null {
  if (status === "streaming") {
    return (
      <p class="byok-status byok-status-streaming" aria-live="polite">
        <span class="byok-status-dot" aria-hidden="true" />
        Streaming…
      </p>
    );
  }
  if (status === "success") {
    return <p class="byok-status byok-status-done">{hasFinalAnswer ? "Done." : "Finished."}</p>;
  }
  if (status === "partial-tool-use-abort") {
    return <p class="byok-status byok-status-stopped">Stopped. Partial output above.</p>;
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
