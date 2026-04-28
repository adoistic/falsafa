#!/usr/bin/env bun
/**
 * Generate prompt files for a batch of `claude -p` headless dispatches.
 *
 * Reads `eval/questions-revised-1000.json`, dedupes against any q-IDs already
 * tested in post-patch run dirs, samples N from the remainder, and writes
 * one prompt file per question. Each prompt embeds the patched anti-cheat
 * block + the canonical tool-spec + a Step-A "Write tool" + Step-B "fenced
 * JSON in stdout" response format.
 *
 * Usage:
 *   bun run apps/mcp/eval/gen-batch-prompts.ts <BATCH_NAME> <COUNT>
 * Example:
 *   bun run apps/mcp/eval/gen-batch-prompts.ts batch3 250
 *
 * Writes:
 *   /tmp/<BATCH_NAME>/q-XXXX.txt           # one per sampled question
 *   /tmp/<BATCH_NAME>-todo-qids.txt       # dispatch worklist
 *   apps/mcp/eval/runs/<BATCH_NAME>/sonnet/{,_failures}/
 *
 * After this you fire the dispatcher with:
 *   PROMPT_DIR=/tmp/<BATCH_NAME> RUN_DIR=apps/mcp/eval/runs/<BATCH_NAME>/sonnet \
 *   xargs -P 5 -I{} bash apps/mcp/eval/dispatch-headless.sh {} \
 *     < /tmp/<BATCH_NAME>-todo-qids.txt
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = "/Users/siraj/falsafa";

interface Question {
  id: string;
  category: string;
  difficulty: string;
  prompt: string;
  rationale?: string;
  expected_works?: string[];
}

function buildPrompt(q: Question, runId: string): string {
  const runDir = `apps/mcp/eval/runs/${runId}/sonnet`;
  return `# Falsafa MCP Eval — Case: ${q.id} (BLIND)

## ⚠️ ANTI-CHEAT (read first — this is a blind eval)

This is a blind evaluation of the falsafa MCP server. **DO NOT** read or open
any of the following files — they contain ground-truth answers and reading them
would invalidate the eval:

- Anything under \`eval/\` at the repo root, especially \`eval/questions-revised-1000.json\`, \`eval/questions-draft-1000.json\`, \`eval/calibration-scores-blind.json\`, \`eval/calibration-report.md\`
- \`apps/mcp/eval/cases.json\`
- Anything under \`apps/mcp/eval/results/\`
- Anything under \`apps/mcp/eval/runs/\` (other agents' results, sample manifests, judge verdicts)
- Anything under \`docs/eval-reports/\`

You also must not answer from your prior literary knowledge. If you "recognize"
a quote from training data, you still have to find it via the MCP — the point
of this eval is to test whether the MCP gives you what you need to answer cold.

If you can't find the answer using the MCP tools, the correct response is to
report that plainly. **Do not fabricate** works, authors, quotes, or chapter
numbers that the MCP didn't surface.

## The question

${q.prompt}

## How you have access to the corpus

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
- The corpus has Old English, Sanskrit, Urdu, French, German, Kawi. NO Tamil, Greek, Arabic, Chinese.

## Working directory

Run all bash commands from \`/Users/siraj/falsafa\`. The MCP CLI expects you to be there.

## What to do

1. Read the question above.
2. Use the MCP tools (via \`bun run apps/mcp/eval/mcp-cli.ts <tool> <args>\` Bash commands)
   to navigate the corpus and find the answer.
3. When done, write your structured response to disk AND echo it in your final message
   (see "Response format" below).

## Response format (REQUIRED)

After your investigation, do BOTH of the following:

**Step A:** Write your result to the file \`${runDir}/${q.id}.json\`
using the **Write tool**. The file content must be valid JSON with this shape:

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

**IMPORTANT:** The harness PREFERS the file you wrote in Step A over the stdout block. The Write
tool handles JSON escaping for free; manually emitting JSON in stdout often breaks on quotes
inside the answer. If you must include literal \` " \` characters inside your answer string,
escape them as \` \\" \`. But the file you wrote via the Write tool is the source of truth.

Stay focused. The eval cares about the JSON answer. Don't ramble.`;
}

function alreadyTested(): Set<string> {
  const tested = new Set<string>();
  const runsRoot = join(REPO, "apps/mcp/eval/runs");
  if (!existsSync(runsRoot)) return tested;
  for (const d of readdirSync(runsRoot)) {
    if (d.startsWith("_INVALIDATED")) continue;
    if (d.includes("NOT-BLIND")) continue;
    if (d.startsWith("1k-codex-smoke")) continue; // codex smoke runs are pre-patch
    const run = join(runsRoot, d);
    // Look one level deep for sonnet/q-*.json
    try {
      for (const sub of readdirSync(run)) {
        const subPath = join(run, sub);
        try {
          for (const f of readdirSync(subPath)) {
            const m = f.match(/^(q-\d{4})\.json$/);
            if (m) tested.add(m[1]!);
          }
        } catch {
          /* not a dir */
        }
      }
      // Also check direct
      for (const f of readdirSync(run)) {
        const m = f.match(/^(q-\d{4})\.json$/);
        if (m) tested.add(m[1]!);
      }
    } catch {
      /* skip */
    }
  }
  return tested;
}

function main() {
  const batch = process.argv[2];
  const count = Number(process.argv[3]);
  if (!batch || !count || count < 1) {
    console.error("Usage: gen-batch-prompts.ts <batch-name> <count>");
    process.exit(1);
  }

  const questions = JSON.parse(
    readFileSync(join(REPO, "eval/questions-revised-1000.json"), "utf-8"),
  ) as Question[] | { questions: Question[] } | { cases: Question[] };
  const all: Question[] = Array.isArray(questions)
    ? questions
    : ((questions as any).questions ?? (questions as any).cases ?? []);

  const tested = alreadyTested();
  const remaining = all.filter((q) => !tested.has(q.id));
  console.log(`Total questions: ${all.length}`);
  console.log(`Already tested (post-patch): ${tested.size}`);
  console.log(`Remaining: ${remaining.length}`);

  // Stratified-by-category sample so the batch isn't biased.
  const byCat = new Map<string, Question[]>();
  for (const q of remaining) {
    if (!byCat.has(q.category)) byCat.set(q.category, []);
    byCat.get(q.category)!.push(q);
  }
  const categories = [...byCat.keys()].sort();
  const sample: Question[] = [];
  // Round-robin pick from each category until we hit count.
  let idx = 0;
  while (sample.length < Math.min(count, remaining.length)) {
    const cat = categories[idx % categories.length]!;
    const pool = byCat.get(cat)!;
    if (pool.length > 0) {
      // Deterministic pick: shift from front. (Not random — but the source list
      // already has a meaningful order, and reproducibility matters more than
      // randomness for paper-grade.)
      sample.push(pool.shift()!);
    }
    idx++;
    // Bail if all categories exhausted.
    if (categories.every((c) => byCat.get(c)!.length === 0)) break;
  }

  const promptDir = `/tmp/${batch}`;
  const runDir = join(REPO, `apps/mcp/eval/runs/${batch}/sonnet`);
  const failDir = join(runDir, "_failures");
  mkdirSync(promptDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  mkdirSync(failDir, { recursive: true });

  const ids: string[] = [];
  for (const q of sample) {
    const promptText = buildPrompt(q, batch);
    writeFileSync(join(promptDir, `${q.id}.txt`), promptText, "utf-8");
    ids.push(q.id);
  }
  writeFileSync(`/tmp/${batch}-todo-qids.txt`, ids.join("\n") + "\n", "utf-8");

  console.log(`\nWrote ${ids.length} prompt files to ${promptDir}/`);
  console.log(`Worklist: /tmp/${batch}-todo-qids.txt`);
  console.log(`Run dir:  apps/mcp/eval/runs/${batch}/sonnet/`);
  console.log(`\nDispatch with:`);
  console.log(`  cd /Users/siraj/falsafa`);
  console.log(`  PROMPT_DIR=/tmp/${batch} RUN_DIR=apps/mcp/eval/runs/${batch}/sonnet \\`);
  console.log(`    xargs -P 5 -I{} bash apps/mcp/eval/dispatch-headless.sh {} \\`);
  console.log(`    < /tmp/${batch}-todo-qids.txt`);
}

main();
