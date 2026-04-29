/**
 * StreamingOutput — the live response area.
 *
 * Renders the streaming timeline chronologically: model commentary
 * interleaved with the tool calls it spawned. The thinking trail comes
 * FIRST (top), because that's what's logically happening — the model
 * thinks, calls tools, sees results, thinks more — and only THEN
 * synthesises an answer. We promote the trailing text to a prominent
 * "Final answer" panel rendered as full markdown, placed beneath the
 * thinking trail.
 *
 * The thinking trail is a native <details> element so it gets keyboard
 * disclosure semantics and screen-reader announcement for free. It's
 * open during streaming so the user sees what's happening live; it
 * auto-collapses once a final answer exists, and we smooth-scroll to
 * the answer on the streaming → complete transition so the eye lands
 * where it should.
 *
 * Per /plan-eng-review run 2 Issue 4.4, text deltas re-render naively
 * for now; rAF coalescing is a separate Phase 2 Checkpoint 7 item.
 */

import { useState, useMemo, useEffect, useRef } from "preact/hooks";
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

  // Scroll-to-answer on the streaming → complete transition. We track the
  // prior status in a ref so we only scroll once per transition, not on
  // every re-render. This makes the eye land on the synthesised answer
  // exactly when it's ready, not before (mid-stream) or after (idle).
  const answerRef = useRef<HTMLDivElement | null>(null);
  const prevStatusRef = useRef<BYOKState["status"]>(state.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const justFinishedStreaming =
      (prev === "streaming" || prev === "submitting") && isComplete;
    if (justFinishedStreaming && hasFinalAnswer && answerRef.current) {
      // window.scrollTo path — scrollIntoView({behavior:"smooth"}) silently
      // no-ops in Chromium under common page-CSS conditions; computing the
      // target Y manually and using window.scrollTo is the reliable workaround.
      const targetY = answerRef.current.getBoundingClientRect().top + window.scrollY - 32;
      window.scrollTo({ top: targetY, behavior: "smooth" });
    }
    prevStatusRef.current = state.status;
  }, [state.status, isComplete, hasFinalAnswer]);

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
      {/* Thinking trail FIRST — chronologically what happens. Native
          <details> gives keyboard + screen-reader semantics for free.
          Open during streaming so the user sees it happen live;
          auto-collapses once a final answer exists. */}
      {state.timeline.length > 0 && (
        <details
          class="byok-thinking-details"
          open={showThinking}
          onToggle={(e: Event) => {
            const el = e.currentTarget as HTMLDetailsElement;
            setShowThinking(el.open);
          }}
        >
          <summary class="byok-thinking-summary">
            <span class="byok-thinking-summary-label">Thinking</span>
            <span class="byok-thinking-meta">
              {" "}· {countThinkingItems(state.timeline, finalAnswer)}
            </span>
          </summary>
          <div id="byok-thinking-log" class="byok-thinking">
            {renderTimeline(state.timeline, state.toolCalls, finalAnswer, isStreaming)}
          </div>
        </details>
      )}

      {/* Final answer panel — placed beneath the thinking trail. While
          streaming, the timeline above contains the most recent text
          segment, which the model is still extending; we don't promote
          it yet. */}
      {hasFinalAnswer && (
        <div class="byok-answer" ref={answerRef}>
          <p class="byok-answer-label">Final answer</p>
          <MarkdownView text={finalAnswer.text} />
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

    // The final-answer entry is rendered below (in the .byok-answer panel).
    // Skip it in the thinking log to avoid showing the same prose twice.
    // Exception: while still streaming, we want the partial final text
    // visible in-place so the user sees it grow.
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
