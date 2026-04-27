/**
 * ToolCallCard — one tool-call entry in the streaming output log.
 *
 * Per design Q2 (locked): tool calls render inline expanded by default
 * — every call visible with name + args + result + timing. This is the
 * audit-trail framing: "every claim has receipts."
 */

import type { JSX } from "preact";
import type { ToolCall } from "../types";
import { cx } from "./cx";

interface Props {
  call: ToolCall;
}

export default function ToolCallCard({ call }: Props): JSX.Element {
  const inProgress = call.result === null;
  const elapsedMs = call.endedAt && call.startedAt ? call.endedAt - call.startedAt : null;

  return (
    <div class={cx("byok-toolcall", { "is-pending": inProgress })}>
      <div class="byok-toolcall-head">
        <code class="byok-toolcall-name">{call.name}</code>
        {inProgress ? (
          <span class="byok-toolcall-status" aria-live="polite">
            Calling...
          </span>
        ) : (
          <span class="byok-toolcall-status">
            {elapsedMs !== null ? `${(elapsedMs / 1000).toFixed(2)}s` : "done"}
          </span>
        )}
      </div>
      <details class="byok-toolcall-body" open={!inProgress}>
        <summary>arguments + result</summary>
        <div class="byok-toolcall-section">
          <p class="byok-toolcall-section-label">arguments</p>
          <pre class="byok-toolcall-pre">{prettyArgs(call.argsBuffer)}</pre>
        </div>
        {!inProgress && (
          <div class="byok-toolcall-section">
            <p class="byok-toolcall-section-label">result</p>
            <pre class="byok-toolcall-pre">{call.result ?? ""}</pre>
          </div>
        )}
      </details>
    </div>
  );
}

/** Try to parse the args buffer as JSON; fall back to raw text if mid-stream. */
function prettyArgs(buf: string): string {
  if (!buf) return "{}";
  try {
    return JSON.stringify(JSON.parse(buf), null, 2);
  } catch {
    return buf;
  }
}
