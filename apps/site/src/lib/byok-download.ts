/**
 * Build a downloadable JSON payload from a completed BYOK run.
 *
 * Shape mirrors EvalCaseResult so a downloaded file is structurally
 * comparable to recorded eval cases. The provider/model/prompt that
 * EvalCaseResult doesn't carry (those live on EvalCase) wrap the
 * result in a ByokDownloadPayload envelope.
 */
import type { EvalCitation, EvalToolCall, ByokDownloadPayload } from "./eval-types";
import type { ToolCall } from "../islands/byok/types";

export function mapToolCallsToEval(toolCalls: ReadonlyArray<ToolCall>): EvalToolCall[] {
  return toolCalls.map((tc) => {
    let args: unknown;
    try {
      args = JSON.parse(tc.argsBuffer);
    } catch {
      // Live stream may end with a malformed buffer (rare). Keep raw
      // string for forensic value rather than throwing.
      args = tc.argsBuffer;
    }
    return {
      name: tc.name,
      args,
      result_summary: tc.result ?? undefined,
    };
  });
}

interface BuildInput {
  prompt: string;
  provider: ByokDownloadPayload["provider"];
  model: string;
  answer: string;
  toolCalls: ReadonlyArray<ToolCall>;
  citations: ReadonlyArray<EvalCitation>;
  durationMs: number;
}

export function buildByokDownloadPayload(input: BuildInput): ByokDownloadPayload {
  return {
    schema_version: "falsafa-byok/v1",
    generated_at: new Date().toISOString(),
    prompt: input.prompt,
    provider: input.provider,
    model: input.model,
    result: {
      answer: input.answer,
      tool_calls: mapToolCallsToEval(input.toolCalls),
      citations: [...input.citations],
      duration_ms: input.durationMs,
      from_run: "live-byok",
    },
  };
}
