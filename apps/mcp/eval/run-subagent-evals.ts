#!/usr/bin/env bun
/**
 * Sub-agent eval driver — alternative to run-evals.ts that uses Claude
 * Code's Agent tool (sub-agents) instead of OpenRouter API.
 *
 * Why a different driver: this file BUILDS the prompt + JSON ground-truth
 * package that the host (Claude Code main session) hands to a blind
 * sub-agent. The actual sub-agent dispatch happens from the host. This
 * file is pure prompt-construction + result-scoring logic.
 *
 * Usage from host:
 *   1. Read all cases via readCases()
 *   2. For each case, call buildSubagentPrompt(case) and pass to the
 *      Agent tool with subagent_type: "general-purpose" and an explicit
 *      model override (sonnet | haiku | opus).
 *   3. Capture the sub-agent's JSON response.
 *   4. Score via scoreCase(case, subagentResponse).
 *   5. Write a report.
 *
 * The sub-agent has NO knowledge of expected answers, ground truth, or
 * judge criteria — only the case prompt + the MCP CLI tool spec. This
 * makes it a true blind eval.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────
// Case loading
// ─────────────────────────────────────────────────────────────────────────

export interface EvalCase {
  id: string;
  category: string;
  prompt: string;
  expected_tool_calls: string[];
  expected_answer_contains: string[];
  must_not_hallucinate?: string[];
  expects_citation: boolean;
  notes?: string;
}

export function readCases(): EvalCase[] {
  const path = join(HERE, "cases.json");
  const raw = JSON.parse(readFileSync(path, "utf-8")) as { cases: EvalCase[] };
  return raw.cases;
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-agent prompt construction (blind — no ground truth leaks)
// ─────────────────────────────────────────────────────────────────────────

const TOOL_SPEC = `
You have access to the **Falsafa MCP** through a small CLI wrapper. Each tool
is a subcommand of \`bun run apps/mcp/eval/mcp-cli.ts <tool> <args-json>\`,
producing JSON to stdout.

Available tools:
- list_works [filter-json]            List works. Filters: era, author, language, genre, difficulty.
- list_chapters {"work_slug":"..."}   List chapters of a work.
- get_metadata {"work_slug":"..."}    Full metadata + variant counts.
- read_chapter {"work_slug":"...","chapter_number":N,"variant":"translation|original|transliteration"}
                                       Read a chapter. Default variant = English.
- get_passage {"work_slug":"...","chapter_number":N,"paragraph_range":{"start":0,"end":3}}
                                       Read specific paragraphs.
- search_corpus {"query":"..."}       Search English bodies. **Use distinctive 2-3 word phrases**.
                                       Long queries auto-fallback to the rarest tokens —
                                       check the \`auto_fallback\` field in the response.
- find_related {"work_slug":"...","chapter_number":N}
                                       Related chapters (TF-IDF + structural).
- compare_works {"work_slug_a":"...","work_slug_b":"...","topic":"..."}
                                       Pointers for comparison across two works.

How to call:
\`\`\`bash
bun run apps/mcp/eval/mcp-cli.ts list_works '{"author":"cynewulf"}'
bun run apps/mcp/eval/mcp-cli.ts search_corpus '{"query":"twelve true thanes"}'
bun run apps/mcp/eval/mcp-cli.ts read_chapter '{"work_slug":"cynewulf-andreas-07b573","chapter_number":1}'
\`\`\`

**Search strategy** (read carefully — this is where smaller models fail):
- Pagefind treats multi-word queries as AND — every word must appear in the same chapter.
- For needle-in-haystack quote retrieval, search for a **distinctive 2-3 word phrase** from
  inside the quote (proper nouns, rare nouns, unusual collocations) — NOT the whole sentence.
- If a query returns 0 results, try a different short phrase from the same quote, or check the
  \`auto_fallback\` field — the server retries long queries with the rarest tokens.
- Each result has \`matched_tokens\` (count of fallback tokens that hit) and \`snippet\`.
  Compare these across results to pick the right work.
- The corpus contains ~750 English chapters across 38 works. If a quote is in the corpus, it
  IS findable with the right query.

**Anti-hallucination**: the corpus contains specific works in specific languages. If a query
returns no matches, REPORT THAT PLAINLY — do NOT invent works that aren't there. Languages in
corpus: Old English, Sanskrit, Urdu, French, German, Kawi (Old Javanese). NO Tamil, Greek,
Arabic, Chinese, etc.
`.trim();

export function buildSubagentPrompt(c: EvalCase, runId: string): string {
  return `# Falsafa MCP Eval — Case: ${c.id} (BLIND)

## ⚠️ ANTI-CHEAT (read first — this is a blind eval)

This is a blind evaluation of the falsafa MCP server. **DO NOT** read or open
any of the following files — they contain ground-truth answers and reading them
would invalidate the eval:

- \`apps/mcp/eval/cases.json\`
- Anything under \`apps/mcp/eval/results/\`
- Anything under \`apps/mcp/eval/runs/\`
- Anything under \`docs/eval-reports/\`

You also must not answer from your prior literary knowledge. If you "recognize"
a quote from training data, you still have to find it via the MCP — the point
of this eval is to test whether the MCP gives you what you need to answer cold.

If you can't find the answer using the MCP tools, the correct response is to
report that plainly. **Do not fabricate** works, authors, quotes, or chapter
numbers that the MCP didn't surface.

## The question

${c.prompt}

## How you have access to the corpus

${TOOL_SPEC}

## Working directory

Run all bash commands from the working directory \`/Users/siraj/falsafa\`. The MCP CLI
expects you to be there.

## What to do

1. Read the question above.
2. Use the MCP tools (via \`bun run apps/mcp/eval/mcp-cli.ts <tool> <args>\` Bash commands)
   to navigate the corpus and find the answer.
3. When done, write your structured response to disk AND echo it in your final message
   (see "Response format" below).

## Response format (REQUIRED)

After your investigation, do BOTH of the following:

**Step A:** Write your result to the file \`apps/mcp/eval/runs/${runId}/${c.id}.json\`
using the Write tool. The file content must be valid JSON with this shape:

\`\`\`json
{
  "answer": "...your final answer to the question, in plain English. Cite work slugs and chapter numbers where the question requires them. If the answer is 'not in corpus', say so plainly without inventing.",
  "tool_calls": [
    {"name": "search_corpus", "args": {"query": "twelve true thanes"}, "result_summary": "Found Andreas ch.1"},
    {"name": "read_chapter", "args": {"work_slug": "cynewulf-andreas-07b573", "chapter_number": 1}, "result_summary": "Confirmed opening lines match"}
  ],
  "citations": [
    {"work_slug": "cynewulf-andreas-07b573", "chapter_number": 1, "paragraph_id": "p-868413"}
  ]
}
\`\`\`

**Step B:** Output the same JSON as a fenced \`\`\`json block in your final message.

The \`tool_calls\` field is your trace — list each MCP CLI call you ran in order with a
short result_summary. The \`citations\` field is empty if your answer doesn't cite specific text.
The \`answer\` is what an end-user would see.

Stay focused. The eval cares about the JSON answer. Don't ramble.`;
}

// ─────────────────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────────────────

export interface SubagentResponse {
  answer: string;
  tool_calls: Array<{ name: string; args: unknown; result_summary?: string }>;
  citations?: Array<{ work_slug: string; chapter_number?: number; paragraph_id?: string }>;
}

export function parseSubagentJson(raw: string): SubagentResponse | null {
  // Try fenced ```json blocks first, then bare JSON.
  const fenced = raw.match(/```json\s*\n([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed?.answer === "string" && Array.isArray(parsed?.tool_calls)) {
      return parsed as SubagentResponse;
    }
  } catch {
    // Try to find any JSON-looking object
    const objMatch = raw.match(/\{[\s\S]*"answer"[\s\S]*"tool_calls"[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]) as SubagentResponse;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Mechanical scoring (axis a) + heuristic scoring helpers
// ─────────────────────────────────────────────────────────────────────────

export function scoreToolAxis(c: EvalCase, r: SubagentResponse): 0 | 1 {
  if (c.expected_tool_calls.length === 0) return 1;
  const called = new Set(r.tool_calls.map((t) => t.name));
  for (const expected of c.expected_tool_calls) {
    if (called.has(expected)) return 1;
  }
  return 0;
}

export function detectHallucination(c: EvalCase, r: SubagentResponse): boolean {
  if (!c.must_not_hallucinate) return false;
  const lower = r.answer.toLowerCase();
  return c.must_not_hallucinate.some((s) => lower.includes(s.toLowerCase()));
}

export function expectedTermsPresent(c: EvalCase, r: SubagentResponse): { present: number; total: number } {
  const lower = r.answer.toLowerCase();
  const present = c.expected_answer_contains.filter((s) => lower.includes(s.toLowerCase())).length;
  return { present, total: c.expected_answer_contains.length };
}

// ─────────────────────────────────────────────────────────────────────────
// Judge prompt (also blind — judge sees ONLY case + sub-agent answer)
// ─────────────────────────────────────────────────────────────────────────

export function buildJudgePrompt(c: EvalCase, r: SubagentResponse): string {
  return `# Eval Judge — Falsafa MCP

You are scoring a sub-agent's answer to a corpus-discovery question. The sub-agent had access
to the falsafa MCP and is supposed to use it to answer.

## The question asked

${c.prompt}

## Ground-truth notes (your reference — the sub-agent did NOT see these)

- Expected the answer to mention any of: ${JSON.stringify(c.expected_answer_contains)}
- The answer must NOT include hallucinated content: ${JSON.stringify(c.must_not_hallucinate ?? [])}
- Citation expected: ${c.expects_citation ? "yes" : "no"}
${c.notes ? `- Case notes: ${c.notes}` : ""}

## Sub-agent's answer

> ${r.answer.replace(/\n/g, "\n> ")}

## Tools the sub-agent called

${r.tool_calls.map((t, i) => `${i + 1}. ${t.name}(${JSON.stringify(t.args)})${t.result_summary ? ` → ${t.result_summary}` : ""}`).join("\n")}

## Your job

Output a JSON verdict (one fenced \`\`\`json block, nothing else):

\`\`\`json
{
  "factual_correct": true|false,
  "citation_backed": true|false,
  "hallucinated": true|false,
  "reasoning": "1-2 sentences on why."
}
\`\`\`

- **factual_correct**: does the answer correctly identify the work / verse / fact the case is
  asking about? At least one of the expected_answer_contains strings should be referenced (or a
  semantic equivalent — case-insensitive substring is sufficient). For negative cases (where
  the answer should be "no, not in corpus"), factual_correct = true if the sub-agent reported
  empty/no without inventing.
- **citation_backed**: if expects_citation = true, did the sub-agent cite at least one
  work_slug + chapter? If expects_citation = false, this is automatically true.
- **hallucinated**: if any of the must_not_hallucinate strings appear in the answer, true.

Output ONLY the JSON. No preamble, no postamble.`;
}

export function parseJudgeJson(raw: string): { factual_correct: boolean; citation_backed: boolean; hallucinated: boolean; reasoning: string } | null {
  const fenced = raw.match(/```json\s*\n([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : raw;
  try {
    const v = JSON.parse(candidate);
    if (typeof v?.factual_correct === "boolean") return v;
  } catch {
    /* ignore */
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Final scoring + report
// ─────────────────────────────────────────────────────────────────────────

export interface ScoredCase {
  id: string;
  category: string;
  prompt: string;
  model: string;
  judge_model: string;
  subagent_response: SubagentResponse | null;
  raw_subagent_text?: string;
  judge_verdict: { factual_correct: boolean; citation_backed: boolean; hallucinated: boolean; reasoning: string } | null;
  score_a_tools: 0 | 1;
  score_b_factual: 0 | 1;
  score_c_citation: 0 | 1;
  score_total: 0 | 1 | 2 | 3;
  passed: boolean;
  hallucination_detected: boolean;
  error?: string;
}

export function scoreCase(
  c: EvalCase,
  subagentText: string,
  judgeText: string | null,
  evalModel: string,
  judgeModel: string,
): ScoredCase {
  const r = parseSubagentJson(subagentText);
  if (!r) {
    return {
      id: c.id,
      category: c.category,
      prompt: c.prompt,
      model: evalModel,
      judge_model: judgeModel,
      subagent_response: null,
      raw_subagent_text: subagentText.slice(0, 2000),
      judge_verdict: null,
      score_a_tools: 0,
      score_b_factual: 0,
      score_c_citation: 0,
      score_total: 0,
      passed: false,
      hallucination_detected: false,
      error: "could not parse sub-agent JSON response",
    };
  }
  const score_a = scoreToolAxis(c, r);
  const hallu = detectHallucination(c, r);
  const verdict = judgeText ? parseJudgeJson(judgeText) : null;
  const score_b = verdict?.factual_correct && !hallu ? 1 : 0;
  const score_c = c.expects_citation ? (verdict?.citation_backed ? 1 : 0) : 1;
  const total = (score_a + score_b + score_c) as 0 | 1 | 2 | 3;
  return {
    id: c.id,
    category: c.category,
    prompt: c.prompt,
    model: evalModel,
    judge_model: judgeModel,
    subagent_response: r,
    judge_verdict: verdict,
    score_a_tools: score_a,
    score_b_factual: score_b as 0 | 1,
    score_c_citation: score_c as 0 | 1,
    score_total: total,
    passed: total >= 2,
    hallucination_detected: hallu,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Report writer
// ─────────────────────────────────────────────────────────────────────────

export function writeReport(results: ScoredCase[], evalModel: string, judgeModel: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(HERE, "results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fname = `${stamp}-subagent-${evalModel.replace(/[\/:]/g, "_")}.json`;
  const path = join(dir, fname);
  writeFileSync(
    path,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        eval_model: evalModel,
        judge_model: judgeModel,
        case_count: results.length,
        passes: results.filter((r) => r.passed).length,
        total_score: results.reduce((acc, r) => acc + r.score_total, 0),
        max_score: results.length * 3,
        results,
      },
      null,
      2,
    ),
  );
  return path;
}

// ─────────────────────────────────────────────────────────────────────────
// CLI: dump prompts for the host to dispatch
// ─────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] === "prompt" && argv[1]) {
    const cases = readCases();
    const c = cases.find((x) => x.id === argv[1]);
    if (!c) {
      console.error(`No case: ${argv[1]}`);
      process.exit(2);
    }
    console.log(buildSubagentPrompt(c));
  } else if (argv[0] === "list") {
    for (const c of readCases()) console.log(`${c.id}\t${c.category}`);
  } else {
    console.error("Usage:");
    console.error("  bun run apps/mcp/eval/run-subagent-evals.ts list");
    console.error("  bun run apps/mcp/eval/run-subagent-evals.ts prompt <case-id>");
    console.error("");
    console.error("This module is also imported by the host (Claude Code main session) to");
    console.error("build prompts and score sub-agent responses. The actual sub-agent dispatch");
    console.error("happens via Claude Code's Agent tool, not here.");
    process.exit(2);
  }
}
