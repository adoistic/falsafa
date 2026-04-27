/**
 * LLM-as-judge for the Falsafa MCP eval suite.
 *
 * The harness evaluates 3 axes per case:
 *   (a) correct tool calls   — mechanical, scored in run-evals.ts
 *   (b) factually correct    — semantic, this module
 *   (c) citation-backed      — semantic, this module
 *
 * We send a single OpenRouter call per case asking the judge model for a
 * strict JSON verdict on (b) and (c). The judge has the prompt, the LLM's
 * final answer, the tool-call summary, and the case's ground-truth notes.
 */

export interface JudgeInput {
  prompt: string;
  expected_answer_contains: string[];
  expects_citation: boolean;
  must_not_hallucinate: string[];
  notes: string;
  final_answer: string;
  tool_call_summary: string;
}

export interface JudgeVerdict {
  factual_correct: boolean;
  citation_backed: boolean;
  reasoning: string;
}

export interface JudgeOptions {
  model: string;
  apiKey: string;
}

const JUDGE_SYSTEM = `You are a strict eval judge for an MCP server that exposes a literary corpus.
Your job is to score one answer on two binary axes and return STRICT JSON.

Axis B (factual_correct): true if the answer references the expected facts
and does NOT contradict the corpus. Loose semantic match is OK — exact
substrings are not required. Penalize fabrication: if the answer claims a
work, author, or quote that the case marks as forbidden (must_not_hallucinate),
factual_correct MUST be false. If the answer is empty or only describes what
it would do (without doing it), factual_correct MUST be false.

Axis C (citation_backed): only meaningful when expects_citation is true. true
if the answer cites at least one specific work + chapter (paragraph_id is
nice-to-have, not required). When expects_citation is false, this axis is
not used by the harness — but still return a value.

Output format: STRICT JSON, no preamble, no code fence:
{"factual_correct": <bool>, "citation_backed": <bool>, "reasoning": "<one sentence>"}`;

interface OpenRouterChatResponse {
  choices: Array<{
    message: { content: string | null };
    finish_reason: string;
  }>;
}

export async function judgeCase(
  input: JudgeInput,
  opts: JudgeOptions,
): Promise<JudgeVerdict> {
  const userMsg = [
    `PROMPT:`,
    input.prompt,
    ``,
    `CASE NOTES (ground-truth context):`,
    input.notes || "(none)",
    ``,
    `EXPECTED ANSWER CONTAINS (any-of, semantic):`,
    JSON.stringify(input.expected_answer_contains),
    ``,
    `MUST NOT HALLUCINATE:`,
    JSON.stringify(input.must_not_hallucinate),
    ``,
    `EXPECTS_CITATION: ${input.expects_citation}`,
    ``,
    `LLM TOOL-CALL SUMMARY:`,
    input.tool_call_summary || "(no tool calls)",
    ``,
    `LLM FINAL ANSWER:`,
    input.final_answer || "(empty)",
  ].join("\n");

  const body = {
    model: opts.model,
    temperature: 0.0,
    max_tokens: 800,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: userMsg },
    ],
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      "HTTP-Referer": "https://github.com/adoistic/falsafa",
      "X-Title": "Falsafa MCP Eval Judge",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    return {
      factual_correct: false,
      citation_backed: false,
      reasoning: `judge HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  const data = (await res.json()) as OpenRouterChatResponse;
  const content = data.choices[0]?.message.content ?? "";

  // Be tolerant of judges that wrap output in code fences despite response_format.
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    const parsed = JSON.parse(cleaned) as Partial<JudgeVerdict>;
    return {
      factual_correct: Boolean(parsed.factual_correct),
      citation_backed: Boolean(parsed.citation_backed),
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return {
      factual_correct: false,
      citation_backed: false,
      reasoning: `judge returned non-JSON: ${content.slice(0, 200)}`,
    };
  }
}
