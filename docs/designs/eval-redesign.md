---
status: ACTIVE
date: 2026-04-29
---

# Eval / Audit redesign

A three-part redesign covering the eval/audit explorer, the per-case detail
surface, and the `/try/` BYOK page. Ships together because the three pages
share components and a single user narrative ("read about a recorded run, run
it yourself, install it for daily use").

## Why

Three concrete problems on `main` today:

1. **The eval explorer presents four "models" that are all the same model.**
   Every entry on the `MODEL` filter is `Claude Sonnet 4.6 · <run dir>` — the
   model is degenerate, only the run dir varies. Misleading: it implies
   cross-model comparison when there is none.
2. **The per-case payload is large and there is no detail page.** The
   explorer renders an inline expansion with the full answer, tool-call
   trace, citations, and judge verdict. Long answers crowd the index. There
   is no shareable URL per case, no SEO surface, no place for the
   reproducibility messaging the launch needs.
3. **`/try/` buries the install path.** The BYOK demo is the centerpiece;
   the install instructions are a single-line footer linking to the README.
   Most readers want to install the MCP into their daily LLM, not type their
   API key into a browser form. The two paths should have equal weight.

This design fixes all three. The eval explorer collapses to one model, every
case gets its own pre-rendered URL, and `/try/` leads with two equal-weight
cards (install / live demo).

## Goals

- Honest model labeling on the eval explorer (one model, four runs as
  metadata).
- A pre-rendered per-case page at `/eval/q-NNNN/` with the question, the
  recorded answer, the tool-call trace, citations, and a one-click "run this
  yourself" CTA.
- A `/try/` page that gives install and BYOK equal real estate, with the
  install card naming both shipped and forthcoming surfaces.
- Shared components for non-determinism + report-this messaging across
  `/try/` and the per-case page.
- A live BYOK run is downloadable as JSON in the same shape as a recorded
  eval result, so external runs can be diffed against ours directly.

## Non-goals

- No new model run kicked off. The 268-case Sonnet pool is what we have;
  this redesign rearranges its presentation.
- No remote MCP backend. Custom GPT / Gemini Gem / Claude Skill marketplace
  appear in the install card as "Coming soon" only. Their backend lives
  behind the `/office-hours` → `/plan-eng-review` gate documented in
  `TODOS.md`.
- No change to the corpus, the MCP server's tool surface, or
  `eval/questions-revised-1000.json`.
- No change to the inline expansion mechanism on `/eval/`. It is removed
  entirely; row click becomes navigation.

## Decisions (locked during brainstorming)

| # | Decision |
|---|---|
| 1 | Merge all `*:sonnet` run entries into a single `sonnet` model. Run dir is preserved as `result.from_run` metadata. |
| 2 | Per-case detail page lives at `/eval/q-NNNN/`. Built with `getStaticPaths` over every case in `eval.json` (~268 pages). |
| 3 | Row click on `/eval/` navigates to the case page. The current inline expansion is removed. |
| 4 | "Run it yourself" on the case page = primary CTA to `/try/?prompt=...` + a collapsible `<details>` block with the exact `mcp-cli.ts` invocations the model made (replayable from a clone). |
| 5 | `/try/` top is two equal-weight cards: install (left) + BYOK live (right). A "Clone & develop" `<details>` block sits below both. |
| 6 | Install card lists Claude Desktop / Claude Code / Cursor / Codex as available now and Custom GPT / Gemini Gem / Claude Skill marketplace as "Coming soon". |
| 7 | Non-determinism caveat + report-this footer appear on both `/try/` and the per-case page, as shared Astro components. |
| 8 | After a successful BYOK run, expose a `[Download run as JSON]` button. The download is `EvalCaseResult`-shaped so external runs are directly comparable to recorded ones. |

## Section 1 — Data layer change

### Build-script change

[eval/build-eval-json.ts](../../eval/build-eval-json.ts) (line ~280-318)
currently emits one `EvalModelMeta` per `<runDir>:<sub>` pair, producing
four entries with `id`s like `1k-orchestrated-200:sonnet`. After this change:

- All `*:sonnet` entries collapse into one entry: `{ id: "sonnet",
  name: "Claude Sonnet 4.6", label: "sonnet", pass_count, case_count }` where
  the counts aggregate across all runs (sum of per-run `pass_count`, sum
  of per-run `case_count`).
- Each case's `results` map re-keys from `<runDir>:sonnet` to `sonnet`.
- A new field `from_run: string` (the original run dir, e.g.
  `"1k-orchestrated-200"`) lives on each `EvalCaseResult` for traceability.
- The `humaniseModelName(sub, runDir)` helper at line ~320 currently
  returns `"Claude Sonnet 4.6 · <runDir>"`. Change it to return just
  `"Claude Sonnet 4.6"` for the merged entry — the run-dir suffix moves
  to `result.from_run`, where it belongs.

The cross-run merge is unambiguous because every case appears in exactly
one run today (verified: `268` cases × `1` run-membership each). If a
hypothetical future case appears in multiple runs, the build script picks
the most-recently-generated run by `mtime` of the source `q-NNNN.json`,
logged at build time.

### Type change

[apps/site/src/islands/eval-explorer/types.ts](../../apps/site/src/islands/eval-explorer/types.ts):
add `from_run: string` to `EvalCaseResult`. No other type changes.

### UI fallout (covered in Section 2 / 3)

- Header on `/eval/` collapses from four mini-rows (one per run) to one
  Sonnet row with aggregate pass-count. A small caption beneath the
  percentage reads `mechanical-pass · judge layer pending` to be honest
  about what the number measures (see "Judge layer status" below).
- The `Run` filter chip group on `/eval/` is removed entirely. With one
  model, there is nothing to filter on.
- The case page surfaces `from_run` in the run-metadata footer.

### Judge layer status

Today **0 of 268** cases in `eval.json` carry a `result.judge` field
(verified). All headline pass-rates come from `passOf()`'s mechanical-pass
fallback (does the answer mention every `expected_work`?). The new
per-case page renders the judge block only when present (Section 2 §5),
so it is a no-op at launch and lights up cleanly the moment a judge run
lands. The header caption and the per-case verdict pill source from the
same `passOf()` to stay in sync.

## Section 2 — Per-case detail page

### URL + routing

- New page: `apps/site/src/pages/eval/[id].astro`.
- `getStaticPaths` enumerates every case in `eval.json`, yielding paths
  like `/eval/q-0002/`, `/eval/q-0993/`, etc.
- Pure HTML — no Preact island. The page is fully pre-rendered.
- The page is included in Pagefind's search index (`data-pagefind-body`
  on the article element) so case content is searchable.

### Page layout (top → bottom)

1. **Breadcrumb + verdict pill.** `← Eval / q-0002` and a verdict pill (`✓
   Pass`, `× Fail`, or `— Mixed` when a judge ran but factual_correct
   diverges from citation_backed). Pill colour matches the dot used in
   `/eval/`'s row list.

2. **Question.** The case `prompt` rendered as the page `<h1>` in display
   serif. Below it: the auditor's `rationale` as a small italic note ("Why
   this question is in the suite: …"), and `expected_works[]` as a chip
   row. Each chip links to `/works/<slug>/`.

3. **Tool-call trace.** One card per `tool_calls[]` entry. Each card shows
   the tool name (`search_corpus`, `read_chapter`, etc.), the args as a
   monospace JSON block, and the `result_summary` as prose. Same visual
   treatment as the live trace on `/try/`. Card markup lives in the new
   `<ToolCallTrace.astro>` component (see Section 4); CSS is shared with
   the BYOK island.

4. **Answer.** `result.answer` rendered as Markdown via the existing
   `marked` pipeline (the same one `ChapterBody` uses). Inline
   `p-XXXXXX` paragraph references in the answer text are auto-linked at
   build time by a helper that walks `result.citations[]` (which already
   carries `{ work_slug, chapter_number, paragraph_id }` per citation —
   verified in the current `eval.json`):
   - For each citation, resolve `(work_slug, chapter_number)` →
     `chapter_slug` via `listChapters(work_slug)` from
     [apps/site/src/lib/corpus.ts](../../apps/site/src/lib/corpus.ts).
   - Build the URL `/works/<work_slug>/<chapter_slug>/translation/#<paragraph_id>`.
     Variant is hard-coded to `translation` (the canonical English
     reading), matching the existing default in `[chapter]/[variant].astro`.
   - Replace each `p-XXXXXX` token in the answer text with an `<a>`
     pointing at the resolved URL.
   - When a `p-XXXXXX` token in the answer text has no matching entry
     in `result.citations[]`, render it as plain text (no anchor) and
     log a build-time warning. This handles paraphrased / hallucinated
     ids without producing dead links.
   - Multi-work answers (e.g. `q-0045` cites two distinct works in one
     answer) are handled per-citation, not per-answer — the helper does
     not depend on `expected_works[0]`.

   The helper lives at `apps/site/src/lib/eval-paragraph-link.ts` so it
   can be unit-tested in isolation against fixture chapters without
   booting Astro.

5. **Judge verdict.** Rendered only when `result.judge` is present. Three
   small pill badges (factual_correct, citation_backed, ¬hallucinated),
   the naturalness rating as a 1–5 dot row, and the judge's `reasoning`
   text as a `<blockquote>`. The `judge_model` lands in a small caption
   line beneath.

6. **Run it yourself.** A `<RunItYourself.astro>` component (see Section
   4):
   - Primary CTA: `[Run on /try with this prompt →]` linking to
     `/try/?prompt=<encodeURIComponent(prompt)>`. Visited link still
     reads "Run on /try" — no surprising state.
   - Below it, a `<details>` block "Or run from the command line"
     containing one shell line per recorded tool call:
     `bun run apps/mcp/eval/mcp-cli.ts <tool> '<args-json>'`.
     Each line has a copy button.

7. **Why your answer might differ.** A `<NonDeterminismCaveat.astro>`
   component (see Section 4). ~3 sentences:
   > AI answers vary in wording — your model's phrasing won't be
   > byte-identical to the recorded one. But Falsafa routes through
   > deterministic tool calls (no vector DB, no learned retrieval), so the
   > *paragraph_ids* the model lands on should match what's recorded
   > here. If you see different paragraph_ids cited, that's a real signal
   > worth investigating — please report it.

8. **Report this case.** A `<ReportThis.astro>` component (see Section
   4) with two buttons:
   - **Open issue on GitHub.** Links to
     `https://github.com/adoistic/falsafa/issues/new?title=Falsafa+eval+case+q-NNNN&body=<prefilled-body>`.
     The body includes the case URL, current verdict, the recorded
     answer (truncated to 1000 chars + `…`), and a "What did you
     observe instead?" prompt.
   - **Email Adnan.** `mailto:adnan@thothica.com?subject=Falsafa+eval+q-NNNN&body=<short-prefilled>`.

9. **Run metadata** *(footer-small)*. One line: `From run
   1k-orchestrated-200 · q-0002.json`, with the run name linking to
   `https://github.com/adoistic/falsafa/tree/main/apps/mcp/eval/runs/<run-dir>/sonnet/q-NNNN.json`.

### Eval index (`/eval/`) page changes

- Header collapses from four mini-rows to one. Markup: `<div class="eval-header-stat">` with the Sonnet aggregate (`87%`/`234/268`, illustrative) plus the existing `268 cases` block. A small caption beneath the percentage reads `mechanical-pass · judge layer pending`.
- The `Run` filter chip group is removed.
- Each case row in the result list becomes an `<a href="/eval/q-NNNN/">` instead of a button that expands inline. The inline expansion + verdict-pill row component is deleted entirely.
- A small ↗ glyph at the right of each row hints at the navigation.
- **Virtualization is dropped.** The current implementation uses `useVirtualizer` from `@tanstack/virtual-core` (`import` near the top of `EvalExplorer.tsx`, call site in the case-list section) — it was needed when each row could expand to render an entire answer + trace. With rows now flat anchors, 268 simple `<a>`s render fine without virtualization. Removing the virtualizer adapter simplifies the island and lets us drop the `@tanstack/virtual-core` import. If the case count ever crosses ~5,000, re-add virtualization in a follow-up.

## Section 3 — `/try/` redesign

### Top-level layout

[apps/site/src/pages/try/index.astro](../../apps/site/src/pages/try/index.astro)
is restructured into a two-column hero followed by a single-column tail.

```
┌────────────────────────────────────┬────────────────────────────────────┐
│  <InstallCard />                   │  <ByokDemo />                      │
│  Install in your daily LLM         │  Try it now (BYOK)                 │
│  [Claude Desktop] [Code] [Cursor]  │  [provider grid]                   │
│  [Codex]                           │  [model dropdown]                  │
│                                    │  [textarea] [Run]                  │
│  config block + copy button        │                                    │
│                                    │  → answer + trace                  │
│  Coming soon · Custom GPT ·        │  → [Download run as JSON]          │
│  Gemini Gem · Claude Skill         │                                    │
└────────────────────────────────────┴────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│  <details> Clone & develop                                              │
│  git clone … / cd falsafa && bun install / cd apps/site && bun run dev  │
└─────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│  <NonDeterminismCaveat />                                               │
│  <ReportThis />                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

At < 768px, the two cards stack (install on top, BYOK below) — same
breakpoint as the current homepage hero.

### Install card details

- Tabs: `Claude Desktop`, `Claude Code`, `Cursor`, `Codex`. Implemented
  as a tab strip (small inline JS for tab switching, or `<details>` per
  tab if we want zero-JS). Default to `Claude Desktop` on first paint.
- Each tab body renders the relevant install snippet:
  - Claude Desktop: the `claude_desktop_config.json` JSON block.
  - Claude Code: `claude mcp add falsafa npx -y @falsafa/mcp`.
  - Cursor: `npx -y @falsafa/mcp` + path-to-Cursor-config note.
  - Codex: `npx -y @falsafa/mcp` plus the same.
- Each snippet has a one-click copy button (existing pattern from the
  BYOK card).
- Below the tabs, a pill row: `Coming soon · Custom GPT · Gemini Gem ·
  Claude Skill marketplace`. Pills are inert (no link, no JS), styled
  muted to read as not-yet-shipped.

### BYOK card additions

[apps/site/src/islands/byok/ByokDemo.tsx](../../apps/site/src/islands/byok/ByokDemo.tsx):

- On mount, read `?prompt=` from `window.location.search`. If present,
  prefill the textarea with `decodeURIComponent(value)` and scroll the
  textarea into view. Do not auto-submit.
- After a run completes (`tool_calls[]` finalized + `answer` rendered),
  surface a `[Download run as JSON]` button next to the answer. Clicking
  it serializes the in-memory run state into the **explicit envelope
  below** (an `EvalCase`-like object plus a `result` field, so the
  download is structurally diffable to anything in the recorded
  `eval.json`):

  ```ts
  // apps/site/src/lib/eval-types.ts (new)
  export interface ByokDownloadPayload {
    schema_version: "falsafa-byok/v1";
    generated_at: string;            // ISO timestamp
    prompt: string;                  // user's question
    provider: "openrouter" | "anthropic" | "google" | "openai";
    model: string;                   // provider-side model id
    result: EvalCaseResult & {
      from_run: "live-byok";         // discriminates from recorded runs
    };
  }
  ```

  Filename: `falsafa-byok-<YYYYMMDD-HHMMSS>.json`. The download builder
  imports this type, runtime-asserts the shape in dev (`process.env.NODE_ENV`
  guarded), and is unit-testable independently of the BYOK island.

- **BYOK ToolCall → EvalToolCall mapping.** The BYOK island's in-memory
  `ToolCall` ([apps/site/src/islands/byok/types.ts:91](../../apps/site/src/islands/byok/types.ts))
  carries streaming-specific fields (`id`, `argsBuffer` as string,
  `startedAt`/`endedAt`, `result` as raw string). `EvalToolCall` carries
  `{ name, args: unknown, result_summary?: string }`. The download
  builder maps each `ToolCall` → `EvalToolCall` as:
  `{ name, args: JSON.parse(argsBuffer), result_summary: result ?? undefined }`.
  Wall-clock latency aggregates into the envelope's `result.duration_ms`
  (`endedAt - startedAt` summed across calls).
- **`from_run: "live-byok"` is filtered on load.** If a user re-uploads a
  BYOK download into any future bulk-import flow, the explorer's data
  loader filters out results where `from_run === "live-byok"` so live
  runs can never inflate aggregate pass-counts.

### Clone & develop block

A `<details>` block with three commands:

```
git clone https://github.com/adoistic/falsafa
cd falsafa && bun install
cd apps/site && bun run dev          # reading site
cd apps/mcp  && bun run dev          # MCP server (stdio)
```

One-line note: "See [README](https://github.com/adoistic/falsafa#readme)
for the full eval / convert / image-gen scripts."

## Section 4 — Components, refactors, files touched

### Shared types module (new)

`apps/site/src/lib/eval-types.ts` becomes the single home for types that
cross the Preact-island ↔ Astro-component boundary:

- `EvalToolCall`, `EvalCitation`, `EvalCaseResult`, `EvalCase`,
  `EvalJudge`, `EvalModelMeta`, `EvalJson`, and the new
  `ByokDownloadPayload`.
- The existing `passOf()` helper.

`apps/site/src/islands/eval-explorer/types.ts` becomes a re-export of
this module to preserve the existing import surface inside the island.
The new Astro components import from `lib/eval-types.ts` directly. This
removes the implicit cross-import from Astro into the islands directory.

### New Astro components (server-rendered, no JS unless noted)

| File | Purpose | Props |
|---|---|---|
| `apps/site/src/components/NonDeterminismCaveat.astro` | Shared 3-sentence caveat block. | none |
| `apps/site/src/components/ReportThis.astro` | GitHub issue + email buttons. | `caseId?: string`, `caseUrl?: string`, `recordedAnswer?: string` |
| `apps/site/src/components/InstallCard.astro` | The left-card on `/try/`. Tab strip with one snippet per surface + "Coming soon" pill row. | none |
| `apps/site/src/components/ToolCallTrace.astro` | Pre-recorded tool-call cards. | `calls: EvalToolCall[]` (imported from `lib/eval-types.ts`) |
| `apps/site/src/components/RunItYourself.astro` | Primary CTA + collapsible CLI block. | `prompt: string`, `toolCalls: EvalToolCall[]` |

### New Astro page

`apps/site/src/pages/eval/[id].astro` — the per-case detail page. Pure
Astro, `getStaticPaths` over every case in `eval.json`. Pulls `EvalCase`
data from the existing `/public/eval.json` (read at build time via the
existing `eval/build-eval-json.ts` output) — no new build script.

### Modified files

| File | Change |
|---|---|
| `eval/build-eval-json.ts` | Collapse `*:sonnet` → `sonnet` model entry; stamp `result.from_run`. |
| `apps/site/src/islands/eval-explorer/types.ts` | Add `from_run: string` to `EvalCaseResult`. |
| `apps/site/src/islands/eval-explorer/EvalExplorer.tsx` | Drop `Run` filter; drop inline expansion; row click navigates to `/eval/<id>/`; collapse header to one model row. |
| `apps/site/src/islands/byok/ByokDemo.tsx` | Read `?prompt=` URL param on mount; render `[Download run as JSON]` after a run completes. |
| `apps/site/src/pages/try/index.astro` | Restructure into two-card hero + clone block + caveat + report. |

### Extracted CSS

A new file `apps/site/src/styles/tool-trace.css` holds the shared classes
for tool-call cards. Both the BYOK island (live, streaming) and the new
`<ToolCallTrace.astro>` (pre-recorded) consume it. Avoids visual drift
between the live and recorded versions of the same UI.

### Dependencies

No new runtime dependencies. The Markdown renderer (`marked`), Pagefind,
and Preact are all already on the page.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Build time grows with 268 new pre-rendered pages. | Each page is ~2-5 KB. Astro builds the existing site in ~10s; +268 pages adds ~2-3s. Acceptable. |
| `?prompt=` URL on `/try/` could be used to inject content. | Standard Preact text-rendering is safe (no `dangerouslySetInnerHTML`). The textarea value is treated as plain text only. |
| Future Opus / hybrid-RAG run lands and breaks the "one model" assumption. | The data structure already supports multiple top-level models; the eval explorer header is keyed on the array. Re-introducing a model filter is a one-component addition. |
| Markdown answer renderer might not handle the recorded answer's edge cases (e.g. unbalanced backticks). | Reuse the same `marked` pipeline that already renders chapter bodies — battle-tested on the same corpus. |
| `[Download run as JSON]` payload drifts from `EvalCaseResult` shape. | Single source of truth: import the type, build a const-asserted object, runtime-assert in dev. |

## Out of scope (deferred)

- Multi-language UI for the case page. English only at launch.
- Diff view: "Your run" vs "Recorded run" side-by-side, given a downloaded
  JSON. Pleasant follow-on, not v1.
- Eval pool browse (the 1000-question pool, of which 268 are recorded).
  The case-page link from `/eval/` only covers recorded cases.
- Custom GPT / Gemini Gem / Claude Skill marketplace integration —
  surfaces appear as "Coming soon" only. Backend gated on `/office-hours`
  → `/plan-eng-review`.

## Test / verification plan

- **Build smoke.** `bun run build` succeeds; spot-check 5 random
  `/eval/q-NNNN/` pages render with the right answer text.
- **Pagefind search.** After `bun run search:build`, search for a phrase
  from a recorded answer (e.g. "ummeed bar nahin") and confirm the case
  page is in the results.
- **`/try/?prompt=test%20question` round-trip.** Open the URL, confirm
  textarea is prefilled with `test question`. Run a prompt, confirm the
  download JSON validates against `ByokDownloadPayload`.
- **Header collapse.** `/eval/` shows one Sonnet row, no Run filter, with
  the aggregate (mechanical-pass) pass-count matching the sum of
  `apps/mcp/eval/runs/*/sonnet/_score-mechanical.json` per_question
  arrays.
- **Cross-link integrity.** For 5 random case pages, every `p-XXXXXX`
  reference in the answer body that has a matching citation resolves to
  a real page (no 404). Tokens without a matching citation render as
  plain text and emit a build-time **warning** (advisory — does *not*
  fail the build, since legitimate paraphrases occasionally cite ids
  outside the formal `result.citations[]` set).
- **Unit test for paragraph-id resolver.** New file
  `apps/site/src/lib/eval-paragraph-link.test.ts` covers the `(work_slug,
  chapter_number) → chapter_slug` mapping against fixture data, plus the
  fallback when a token has no matching citation. Runs under `bun test`.
- **Run-metadata link integrity.** Per-case page §9 links to
  `apps/mcp/eval/runs/<run-dir>/sonnet/q-NNNN.json` on `main`. CI build
  verifies the file exists for every case in `eval.json` at the path
  derived from `result.from_run` — fails the build if missing.
