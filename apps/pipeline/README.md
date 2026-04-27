# @falsafa/pipeline

Methodology pipeline for ingesting classical / philosophical archives into a Karpathy-style markdown knowledge base. Mirrors the exact process used to produce the Falsafa corpus.

```bash
npx @falsafa/pipeline ingest <archive>
```

## Status

Scaffolded by `/plan-eng-review` run 2 (2026-04-27). Implementation in **Phase 3 worktree D** of the Falsafa launch plan. See `docs/designs/falsafa-perseus-launch.md` for the full launch artifact context and `~/.gstack/projects/falsafa/siraj-feat-chapter-splitting-eng-review-run2-20260427-160000.md` for the engineering decisions that shape this package.

## What it will do (planned)

1. Discover work boundaries in a target archive (TEI XML, plain text, or scraped HTML).
2. Apply the Falsafa chapter-splitting heuristics (TYPE_A / TYPE_B / TYPE_C — see `scripts/chapter-splitting/`).
3. Render per-chapter markdown variants (original, transliteration, translation) under the canonical `corpus/works/<slug>/chapters/<NN>-<title>/` layout.
4. Emit `manifest.json` + `meta.json` per chapter + `cross-links.json` ready for use by `@falsafa/mcp`.
5. Optionally invoke an LLM for catalog-quality descriptions and cross-link summaries.

## Why a separate package

`scripts/` is for one-off internal tooling. `@falsafa/pipeline` is the methodology, packaged for any builder who wants to apply Falsafa's approach to their own archive. Different release cadence, different audience, different versioning story.

## Distribution

Published to npm. Built with tsup. Targets Node 20+. CLI exposed as `npx @falsafa/pipeline`.
