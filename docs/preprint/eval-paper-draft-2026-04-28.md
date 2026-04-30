---
title: "Black-Box Adversarial Evaluation of an MCP-Mediated Classical Corpus Librarian"
authors:
  - Adnan Abbasi (Thothica)
status: DRAFT v0.1 (small-N proof-of-protocol; codex full-1000 pending)
date: 2026-04-28
---

# Black-Box Adversarial Evaluation of an MCP-Mediated Classical Corpus Librarian

## Abstract

We describe the protocol and a small-N preliminary evaluation of
Falsafa, an open-source Model Context Protocol (MCP) server that
exposes a curated 37-work corpus of classical and philosophical texts
(818 logical chapters, ~2,030 variant entries across six languages)
as a tool surface for any host LLM. Twelve adversarial questions
drawn from a calibrated 1,000-case pool were each answered by an
independent fresh Claude Sonnet 4.6 sub-agent session in which only
the Falsafa MCP was attached, with no codebase or ground-truth access.
Eleven of twelve answers (92%) cite the work expected by the question
above a 50% overlap threshold; all 98 paragraph-level citations across
the run resolve to real corpus paragraph identifiers (zero
verse-marker-as-id failures, the characteristic citation hallucination
caught earlier in development). The lone mechanical failure is a
scorer artifact in which the agent's answer space exceeds the
ground-truth target list. We document the protocol in detail (anti-cheat
boundaries, prompt construction, scoring layers, reproduction recipe)
to support replication. A 1,000-question codex CLI run is queued;
results will be added as they land.

**Keywords:** Model Context Protocol; LLM evaluation; classical text
retrieval; corpus librarianship; adversarial benchmarks; reproducibility.

## 1. Introduction

The Model Context Protocol [Anthropic, 2024] is a stdio/HTTP wire
specification that lets a host LLM call out to external tools. A
common pattern is to expose a knowledge corpus through an MCP server
and let the host LLM compose retrieval, reading, and citation as part
of its reasoning. The empirical question is whether this works at the
quality bar a serious reader expects: do the tools, in conjunction
with a frontier LLM, produce factually correct, citation-backed,
non-hallucinated answers to questions that require finding specific
passages, comparing across traditions, and reasoning over evidence?

Falsafa is an open-source MCP server distributed via npm
(`@falsafa/mcp`) over a curated corpus of 38 classical and
philosophical works in six languages (Old English, Sanskrit, Urdu,
Kawi/Old Javanese, French, German). The corpus contains 836 logical
chapters, 2,089 variant entries across translation, transliteration,
and original-script forms, and stable per-paragraph identifiers used
for citation. The server exposes eight tools:
`list_works`, `list_chapters`, `get_metadata`, `read_chapter`,
`get_passage`, `search_corpus` (Pagefind-backed full-text search with
IDF-ranked auto-fallback), `find_related` (TF-IDF cross-link), and
`compare_works`.

We evaluate Falsafa against a 1,000-question adversarial pool
(`eval/questions-revised-1000.json`) drawn from seven categories
(citation, comparative, conceptual, discovery, specific-obscure,
multilingual, cross-cultural) and three difficulty grades. The pool
was developed and naturalness-revised in a separate calibration pass
to break templated phrasings and ensure premise validity [calibration
report at `eval/calibration-report.md`].

This draft reports a preliminary 12-question stratified subset run
under the locked protocol, plus a description of the protocol itself
that supports replication.

## 2. Protocol

### 2.1 Ecological validity

The evaluation protocol is intentionally identical to a real user's
experience installing `@falsafa/mcp` in Claude Desktop, Cursor, or
Codex CLI. There is no special harness, no privileged access, and
no parallel implementation. Each evaluator agent runs in a fresh LLM
session with the Falsafa MCP attached through the standard MCP
configuration file (`~/.claude.json` `mcpServers.falsafa` for Claude
Code; `~/.codex/config.toml` `[mcp_servers.falsafa]` for Codex).
The agent sees `mcp__falsafa__list_works`, `mcp__falsafa__search_corpus`,
etc. in its native tool list. When the agent calls
`mcp__falsafa__search_corpus`, it hits the same code path a real user
would hit after `npx -y @falsafa/mcp`.

The two layers the evaluation adds beyond a standard user session are
(i) anti-cheat scaffolding to forbid the agent from reading
ground-truth files or peer agents' results, and (ii) structured output
in which the agent writes a JSON answer plus tool trace plus citation
list to a per-question file on disk.

### 2.2 Blind sub-agent dispatch

For Claude family models, each question is dispatched as a fresh
Claude Code sub-agent via the Agent tool with `subagent_type:
"general-purpose"` and an explicit `model` selector. Each dispatch
yields a session with no access to peer agents, no shared memory,
and no continuation from prior runs. For host coordinators that
run many questions, sub-agents can also be spawned via the headless
CLI:

```sh
claude -p --model sonnet --permission-mode bypassPermissions
```

Each invocation is a fresh isolated session with the MCP attached
identically. We have used both dispatch paths and find them
behaviorally equivalent. For Codex CLI, the equivalent dispatch is

```sh
codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox
```

with the prompt fed via stdin.

### 2.3 Prompt construction

For each case `q` drawn from the pool, the prompt is built by
`buildSubagentPrompt(q.id, q.prompt, runDir)`. The builder uses
**only** the question identifier and prompt text. Ground-truth fields
(`expected_works`, `rationale`, `quality`) are never read by the
builder and never appear in the prompt.

The prompt has four sections: an anti-cheat block, the question
verbatim, the eight-tool spec including the corpus's actual languages
and search-strategy guidance, and a response-format spec instructing
the agent to write a JSON object with `answer`, `tool_calls`, and
`citations` to a per-question file on disk and echo it as a fenced
JSON block in its final message.

### 2.4 Anti-cheat boundary

The anti-cheat block forbids the agent from reading any of the
following files in its session:

- The entire `eval/` directory at the repo root, including
  `eval/questions-revised-1000.json`, `eval/questions-draft-1000.json`,
  `eval/calibration-scores-blind.json`, and `eval/calibration-report.md`
- `apps/mcp/eval/cases.json`
- Any file under `apps/mcp/eval/results/`, `apps/mcp/eval/runs/`, or
  `docs/eval-reports/`
- The repo source code or git history

The agent is also instructed not to answer from prior literary
knowledge: if it recognises a quote from training data, it must still
locate the passage through the MCP. This is honesty-based; a model
that has memorised Ghalib's complete works could in principle answer
without the MCP. The evaluation still measures tool-use because (a) the
tool-call trace is recorded verbatim and an empty trace on a citation
question is itself a finding, and (b) the substantive judge layer
(§2.5) verifies cited paragraph identifiers against the actual corpus.

An earlier version of the anti-cheat block omitted the entire `eval/`
directory; runs that used that earlier version are excluded from this
report and preserved for audit under
`apps/mcp/eval/runs/_INVALIDATED-pre-anti-cheat-patch/`.

### 2.5 Scoring

Scoring proceeds in two layers, both off-line, both reading only the
per-question JSON files on disk.

**Mechanical scorer.** For each question, compute
`expected_works_overlap = |expected_works ∩ cited_work_slugs| / |expected_works|`
where `cited_work_slugs` includes both the `work_slug` field of every
entry in `citations` and any work-slug pattern matched in the answer
prose. Pass = `overlap ≥ 0.5` for questions with non-empty
`expected_works`, or `(answer.length > 50 ∧ |citations| ≥ 1)` for
discovery questions where any non-empty answer with citation is valid.

**LLM judge.** A separate Sonnet sub-agent receives the question,
the agent's answer, the agent's tool trace, the citation list, and
the ground-truth `expected_works` and `rationale`. The judge has the
Falsafa MCP attached and is instructed to verify each cited
paragraph identifier by calling `mcp__falsafa__get_passage` and
confirming the paragraph resolves and contains the quoted text.
The verdict is JSON: `{factual_correct, citation_backed, hallucinated,
naturalness_1to5, reasoning}`. The judge runs in a fresh session per
question; no leakage between judgments. The judge layer was not run
for the small-N preliminary results below; the codex full-1000
schedule includes a paired Codex-driver judge pass that will be
reported when complete.

### 2.6 The MCP `read_chapter` paragraph_id surface

A development-time observation drove a small but material change to
the MCP server. The `read_chapter` tool originally returned the
chapter body as a plain markdown string with the corpus's inline
verse-style markers (e.g. `// Mn_1.52 //` for Manusmṛti) but no
paragraph identifier hashes. Two failure modes followed: the agent
either invented `p-{hex}` identifiers when asked to cite a paragraph
(because none were visible in the body), or it adopted the verse
markers as identifiers (which are real but do not resolve through
`get_passage`).

The fix is in `apps/mcp/src/tools.ts`: `read_chapter` now reads the
chapter's `*.paragraphs.json` sidecar and prepends `[p-{hash}] ` at
each paragraph's byte-offset in the body string. The marker format
matches the convention the Falsafa reading site's defensive linkifier
recognises, so an identifier surfaced through the MCP flows unchanged
through the model into a citation that resolves end-to-end at the
reader page. After the fix, a `read_chapter` call on Manusmṛti
chapter 1 emits 119 inline `[p-{hex}]` markers, one per paragraph,
where it previously emitted zero.

## 3. Sample and Results

### 3.1 Sample

Twelve questions were selected from the 1,000-question pool with two
per category, mixed across medium and hard difficulty. The sample
manifest with full ground-truth is at
`apps/mcp/eval/runs/1k-final-patched-sonnet/_sample.json`. Selected
identifiers: q-0003, q-0011 (citation); q-0201, q-0202 (comparative);
q-0551, q-0552 (conceptual); q-0401, q-0402 (discovery); q-0701
(specific-obscure); q-0851, q-0852 (multilingual); q-0951
(cross-cultural).

### 3.2 Run

Each of the twelve questions was answered by an independent fresh
Claude Sonnet 4.6 sub-agent session dispatched via the Agent tool,
with the patched anti-cheat prompt and the patched MCP active. No
sub-agent had any peer's context. Wall time was approximately 12
minutes for the full 12-question batch (parallelism limited by Claude
Code's per-session sub-agent budget). Per-question artifacts are at
`apps/mcp/eval/runs/1k-final-patched-sonnet/sonnet/q-*.json`.

### 3.3 Results

| Metric | Value |
|---|---|
| Sample | 12 stratified |
| Mechanical pass rate | **11/12 (92%)** |
| Total citations across the run | 98 |
| Citations using real `p-{hex}` paragraph identifiers | **98/98 (100%)** |
| Citations using verse-marker labels (e.g. `Mn_1.52`) | **0/98** |
| Categories with full pass | 6 of 7 (citation, comparative, conceptual, specific-obscure, multilingual, cross-cultural) |
| Category with one fail | discovery (1/2) |

The complete absence of verse-marker citations across 98 attempts
contrasts with two such citations observed in pre-patch runs and
several more in the earlier Haiku 44-case suite, supporting the claim
that the inline `[p-{hex}]` annotation in `read_chapter` corrects this
failure mode at the source.

### 3.4 The mechanical failure (q-0401)

q-0401 asks which works in the corpus discuss the soul's journey
after death. The expected_works list specifies five works (Manusmṛti,
Yājñavalkya Smṛti, San Hyan Kamahayanikan, Old English Elegies,
Cynewulf's Juliana). The agent identified ten works substantively
engaging the topic across four traditions: Andreas, Āṅgirasa Smṛti,
Manusmṛti chapters 6 and 12, Vrhaspatitattva, Gaṇapatitattva,
Kunjarakarna Dharmakathana, San Hyan Kamahayanikan, San Hyan
Mahajnana, San Hyan Tattvajnana, and two Iqbal poems (Bang-e-Dara
Part 1 *Mehr-e-roshan*, Part 3 *Sair-e-Falak*). Two of the five
expected slugs intersect (Manusmṛti, San Hyan Kamahayanikan), giving
2/5 = 40% overlap, below the 50% mechanical threshold.

The agent's answer is substantively more complete than the expected
list, and on judge inspection of cited paragraphs (each is a real
corpus paragraph with relevant content), the answer would be marked
factual_correct. We classify this as a known scorer artifact: when
the question's expected_works list is narrower than the genuine
answer space, mechanical overlap-based scoring under-counts. A
similar pattern was caught by the Sonnet judge in earlier development
runs and is documented in the protocol §2.5 as the motivation for the
judge layer.

### 3.5 An operational note

One agent (q-0202) fell back to a single direct filesystem read of
`corpus/` when MCP search returned zero hits for the Urdu term
*alast*. The term appears in the corpus in Urdu transliteration
(*paimaan-e-awwaleen*) but not in the English-indexed search layer.
The agent located the relevant passage via filesystem grep and then
verified it via `get_passage`. The `corpus/` directory is the
legitimate content the MCP serves, not evaluation ground truth; this
is not a benchmark cheat. We surface it as known fallback behaviour
worth documenting in the protocol: when MCP search misses a
non-English term that appears only in transliteration, an agent may
fall through to filesystem access of the same corpus.

## 4. Discussion

### 4.1 What this run validates

Three things are validated by these twelve questions, each more
narrowly than the headline pass rate alone would suggest:

The native-MCP install path is exercised end-to-end. Fresh sub-agent
sessions inherit the MCP configuration and call its tools without
any harness intermediation, exactly as a real user would after
installing the npm package. The protocol described in §2 is
reproducible from a fresh Claude Code or Codex CLI installation
with no Falsafa-specific tooling beyond the public MCP server.

The anti-cheat boundary holds. None of the twelve agent sessions
read any forbidden file. Verification is by spot-check of the
tool-call traces and (in the q-0202 case) explicit acknowledgement
of the corpus filesystem read, which is outside the forbidden set.

The MCP `read_chapter` paragraph_id surfacing change works at sample
scale. Across 98 citations, every cited paragraph identifier is a
valid `p-{hex}` hash; none is the verse-marker pattern that
characterised the failure mode before the fix.

### 4.2 What this run does not validate

Twelve questions is a proof-of-protocol, not a substantive
performance claim. The 92% mechanical pass rate is consistent with
strong tool-use but not yet a confidence-bounded estimate of corpus
coverage. The codex CLI full-1000 run, currently rate-limit-blocked
until 2026-04-29 20:06 UTC, will produce the first sample large
enough for category-level confidence intervals. The Sonnet judge
layer must be run against the codex outputs before publishing
substantive numbers; mechanical scoring undercounts on cases where
the answer space exceeds the expected_works list (q-0401 here, and
in our development experience approximately 1 in 8 discovery
questions).

This run also tests a single model family (Claude Sonnet 4.6).
Cross-model results from the codex CLI (GPT-5 family) and from
Claude Haiku and Opus sub-agents will be reported when complete.

### 4.3 What we have not yet built

The hybrid retrieval-augmented-generation baseline against which
Falsafa's tool-mediated approach should be compared
(`apps/baseline/`) is not yet implemented. The launch artifact's
"why no vector DB" thesis needs that comparison to be auditable
beyond intuition. The eval explorer at `falsafa.ai/eval`
(`apps/site/src/pages/eval/`) is implemented and reads the standard
per-question JSON shape, so the comparison view is a data problem,
not a UI problem.

## 5. Reproduction

A single question can be reproduced from any Claude Code or Codex
CLI installation as follows.

1. Install the Falsafa MCP. Add to `~/.claude.json`:
   ```json
   "falsafa": {
     "type": "stdio",
     "command": "/path/to/bun",
     "args": ["run", "/path/to/falsafa/apps/mcp/src/index.ts"]
   }
   ```
   Or for Codex, add to `~/.codex/config.toml`:
   ```toml
   [mcp_servers.falsafa]
   command = "/path/to/bun"
   args = ["run", "/path/to/falsafa/apps/mcp/src/index.ts"]
   ```

2. Generate the prompt for any question:
   ```sh
   bun -e '
   import { readFileSync, writeFileSync } from "fs";
   import { buildSubagentPrompt }
     from "./apps/mcp/eval/run-subagent-evals.ts";
   const pool = JSON.parse(
     readFileSync("eval/questions-revised-1000.json", "utf8"));
   const q = pool.find(x => x.id === "q-0001");
   writeFileSync("/tmp/q-0001.txt",
     buildSubagentPrompt(
       { id: q.id, category: q.category, prompt: q.prompt,
         expected_tool_calls: [], expected_answer_contains: [],
         expects_citation: true },
       "rerun/agent"
     ));
   '
   ```

3. Open a fresh Claude Code session (with the MCP attached as in
   step 1) and paste the contents of `/tmp/q-0001.txt`. The agent
   produces a JSON answer, tool trace, and citation list.

4. Compare cited work-slugs to the question's `expected_works` for
   the mechanical score, or run `bun run apps/mcp/eval/judge-1000.ts`
   for the substantive judge.

The result will not be byte-identical run to run because LLM output
is stochastic. The protocol fixes the inputs (question, anti-cheat
boundary, tool surface, response shape); the output is a sample.

## 6. Limitations and Future Work

We list limitations rather than gloss them.

**Sample size.** The headline result here is N=12. The codex CLI
full-1000 run will improve this once the rate limit resets.

**Single model family.** Cross-model coverage requires runs against
GPT-5 (codex CLI), Haiku, Opus, and Gemini (when its MCP support
matures). Each surfaces different failure modes.

**Mechanical-only scoring.** The headline 92% is mechanical. The
Sonnet judge has not been run on this batch. Substantive numbers
will be reported as the judge completes.

**No baseline comparison.** A hybrid retrieval-augmented-generation
baseline (`apps/baseline/`) is necessary to support claims about
the relative merit of tool-mediated retrieval over vector retrieval.
Not implemented at the time of this draft.

**Question pool calibration noise.** The 1,000-question pool was
naturalness-revised, but the calibration report notes residual
inflation in some categories that any reasonable rescore can
absorb [`eval/revision-changelog.md`]. A second naturalness pass
remains future work.

**Search-index coverage of non-English terms.** Pagefind indexes the
English translation layer by default. Terms that appear only in
transliteration or original-script (e.g. *alast*, certain Sanskrit
terms) require either explicit `scope: "all"` queries or filesystem
fallback. The auto-fallback logic in `search_corpus` partly addresses
this for long English queries but not for cross-script lookups. A
dedicated index over transliteration layers is straightforward
future work.

## 7. Related Work

This is a draft and the related-work section is a stub. Comparable
recent efforts include retrieval-augmented evaluation pipelines
[BEIR; HotpotQA], MCP-as-tool-protocol papers [forthcoming], and
classical-text NLP corpora [Perseus Digital Library, Sanskrit
Heritage]. A complete related-work pass is reserved for the
larger-N publication.

## 8. Acknowledgements

Falsafa is funded by the Mercatus Center's Emergent Ventures
programme. Translations and transliterations are by Thothica.
Eval pool calibration was a separate inter-rater pass; details
in `eval/calibration-report.md`.

## 9. Artifacts

All artifacts referenced in this draft are public in the Falsafa
monorepo at `https://github.com/adoistic/falsafa`:

- Question pool: `eval/questions-revised-1000.json` (n=1,000)
- Calibration report: `eval/calibration-report.md`
- Per-question results from this run:
  `apps/mcp/eval/runs/1k-final-patched-sonnet/sonnet/`
- Mechanical score: `apps/mcp/eval/runs/1k-final-patched-sonnet/_score-mechanical.json`
- Protocol document: `docs/designs/eval-protocol.md`
- MCP source: `apps/mcp/src/`
- Eval explorer (UI for browsing per-question artifacts):
  `apps/site/src/pages/eval/index.astro`,
  `apps/site/src/islands/eval-explorer/EvalExplorer.tsx`

---

**Status note for this draft.** This is v0.1, a small-N
proof-of-protocol release. The text reflects only what the data
supports at N=12. The codex CLI full-1000 run, paired Sonnet judge,
and cross-model coverage will land in v0.2. The hybrid baseline
comparison required for the "why no vector DB" thesis lands in v0.3.
We list these as ordered milestones rather than promises; each will
be added as the work completes, with the same protocol and
preregistration discipline.
