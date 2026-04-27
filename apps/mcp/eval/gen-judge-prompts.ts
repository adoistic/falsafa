#!/usr/bin/env bun
/**
 * Generate one judge prompt per case. Each prompt is fully self-contained and
 * inlineable into an Agent tool call (no "read this file and follow it" — the
 * answer file path is provided so the judge can Read it directly).
 *
 * The judge is told:
 *   - the original case (prompt, expected_answer_contains, must_not_hallucinate, notes)
 *   - the path to the candidate answer file
 *   - access to mcp-cli to verify quotes/citations against the actual corpus
 *   - a 4-axis rubric (0-3 each, max 12)
 *
 * Run:
 *   bun run apps/mcp/eval/gen-judge-prompts.ts <run-id>
 *   # writes /tmp/judge-${run-id}-${case-id}.txt for every case
 */
import fs from "fs";
import path from "path";

const runId = process.argv[2];
if (!runId) { console.error("Usage: gen-judge-prompts.ts <run-id>"); process.exit(2); }

const REPO = "/Users/siraj/falsafa";
const RUN_DIR = `apps/mcp/eval/runs/${runId}`;
const JUDGE_DIR = `apps/mcp/eval/runs/${runId}/_judge`;

const data = JSON.parse(fs.readFileSync(path.join(REPO, "apps/mcp/eval/cases.json"), "utf8"));
const cases = data.cases as Array<{
  id: string;
  category: string;
  prompt: string;
  expected_answer_contains: string[];
  must_not_hallucinate?: string[];
  expects_citation: boolean;
  notes?: string;
}>;

fs.mkdirSync(path.join(REPO, JUDGE_DIR), { recursive: true });

for (const c of cases) {
  const promptPath = `/tmp/judge-${runId}-${c.id}.txt`;
  const text = `# Falsafa MCP Eval — JUDGE pass on case: ${c.id}

You are an independent JUDGE evaluating whether a candidate answer (produced by a different
LLM acting as an MCP librarian) is **substantively correct**, not just shape-correct.

## The case

- id: ${c.id}
- category: ${c.category}
- expects_citation: ${c.expects_citation}
- expected_answer_contains: ${JSON.stringify(c.expected_answer_contains)}
- must_not_hallucinate: ${JSON.stringify(c.must_not_hallucinate ?? [])}
- notes: ${c.notes ?? "(none)"}

### User's question
${c.prompt}

## The candidate answer
**Read this file** (use the Read tool) to see the candidate answer + tool_calls trace + citations:

\`${RUN_DIR}/${c.id}.json\`

## How to verify

You have a CLI to the falsafa MCP. Run from working dir \`${REPO}\`:

\`\`\`bash
bun run apps/mcp/eval/mcp-cli.ts read_chapter '{"work_slug":"...","chapter_number":N,"variant":"translation"}'
bun run apps/mcp/eval/mcp-cli.ts get_passage '{"work_slug":"...","chapter_number":N,"paragraph_ids":["p-xxxxxx"]}'
bun run apps/mcp/eval/mcp-cli.ts list_works '{"author":"..."}'
bun run apps/mcp/eval/mcp-cli.ts search_corpus '{"query":"..."}'
\`\`\`

**For needle-quote / citation cases**: pull the cited paragraph(s) and verify the quote is verbatim, or
report that the cited paragraph contains a different text.
**For factual / filter / multi-step cases**: re-run the relevant list_works / get_metadata calls and
check the numbers / lists in the answer match.
**For negative / hallucination-guard cases**: confirm the answer correctly says "not in corpus" without
inventing works. Re-check via list_works '{"language":"..."}' / list_works '{"author":"..."}'.
**For comparative / cross-tradition cases**: spot-check 1–2 cited paragraphs to confirm the answer
isn't fabricating quotes; the answer's interpretive synthesis is fine as long as it's grounded in real text.

You may NOT cheat by reading these (they contain the rubric expected by the original eval, not ground truth):
- apps/mcp/eval/runs/${runId}/_score-summary.json
- docs/eval-reports/

You MAY read cases.json (you've already been given the relevant fields above), the candidate answer
file, and any corpus chapter via the MCP CLI.

## Rubric (score each axis 0–3)

1. **factual_correctness (0–3)** — does the answer correctly identify the work, chapter, paragraph, count,
   list of works, etc., as verifiable in the corpus?
   - 3 = fully correct
   - 2 = mostly correct, minor flaw (one wrong paragraph id, off-by-one count, etc.)
   - 1 = partially right (right work, wrong chapter, OR right concept, wrong source)
   - 0 = wrong / unsupported by corpus

2. **citation_grounding (0–3)** — for cases requiring citation: do the cited work_slug + chapter_number +
   paragraph_id actually contain what the answer claims?
   - 3 = all citations resolve to paragraphs that contain the claim
   - 2 = most resolve, one is slightly off
   - 1 = citation present but doesn't substantiate the claim
   - 0 = fabricated citation OR expects_citation=true but none provided
   - For cases with expects_citation=false, default to 3 unless answer cites something wrong.

3. **hallucination_avoidance (0–3)** — does the answer avoid inventing works, authors, or quotes that
   the corpus doesn't have?
   - 3 = no fabrication
   - 2 = mentions \`must_not_hallucinate\` items only as denials ("Plato is NOT in the corpus")
   - 1 = mentions \`must_not_hallucinate\` items ambiguously
   - 0 = clearly fabricates / asserts a non-existent work

4. **reasoning_quality (0–3)** — for non-trivial cases (multi-step, comparative): is the chain of
   tool calls + interpretation sensible? For simple lookups, default to 3 unless the answer is incoherent.

Total = sum of axes (max 12). Pass = total ≥ 8 AND no axis = 0.

## Output (REQUIRED — do BOTH)

**A.** Use the Write tool to save your verdict to \`${JUDGE_DIR}/${c.id}.json\`:

\`\`\`json
{
  "case_id": "${c.id}",
  "category": "${c.category}",
  "factual_correctness": 0,
  "citation_grounding": 0,
  "hallucination_avoidance": 0,
  "reasoning_quality": 0,
  "total": 0,
  "max": 12,
  "pass": false,
  "verdict": "PASS|FAIL|BORDERLINE",
  "rationale": "1–3 sentence explanation of what you verified and what (if anything) was wrong",
  "verifications_performed": [
    "Read candidate answer file",
    "Pulled paragraph p-xxx from work-slug-xxx and confirmed quote is verbatim",
    "etc."
  ]
}
\`\`\`

**B.** Echo the same JSON in a fenced \`\`\`json block in your final message.

Stay terse and rigorous. The point is to catch shape-correct-but-substantively-wrong answers.
`;
  fs.writeFileSync(promptPath, text);
  console.log(`wrote ${promptPath}`);
}

console.log(`\nGenerated ${cases.length} judge prompts.`);
