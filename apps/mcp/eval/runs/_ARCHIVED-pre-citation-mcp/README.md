# Archived: pre-citation-MCP runs

These three runs were generated **before** commit `b6a13ac fix(mcp): annotate
read_chapter body with [p-xxxxxx] paragraph_id markers` (2026-04-28).

That commit was the load-bearing fix that lets the model see paragraph_id
hashes inline in chapter bodies — without it, Sonnet judges had already
flagged at least two failures (`q-0626`, `q-0951`) where the agent had to
guess paragraph_ids from the body and got them wrong. Citation precision is
the entire pitch of the eval. Running it against the un-annotated body is
running it against the wrong product.

## What's in here

- `1k-final-patched-sonnet/` — 12 cases
- `1k-orchestrated-200/` — 134 cases
- `1k-orchestrated-batch2/` — 86 cases
- `_snapshot-eval-json/` — `eval.json` + `eval-index.json` as they were
  committed when this archive was created. Restore-able if the new run
  hits a snag and we need the old data back temporarily.

Total recorded: 232 cases against ~232 of the 1,000-question pool.

## Why archive instead of delete

The runs are still useful as a **before/after** comparison once the new
batch lands — concrete evidence that the citation-MCP fix moved the
needle on hallucination + paragraph-id precision. The numbers don't
become production claims, but they do become a footnote in the writeup.

## Filter status

The `_` prefix on the directory name means the build script's
`EXCLUDED_RUN_DIRS` regex (`(^_INVALIDATED|-NOT-BLIND$|-quarantine|^_)`)
already excludes these from any future `eval.json` regeneration. No
explicit code change needed.

## Next step

Re-run on the full 1,000-question pool against the current MCP. See
`TODOS.md` § "Re-run eval on 1,000-question pool against citation-aware MCP"
for the plan.
