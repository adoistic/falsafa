# Falsafa methodology Skill

Source for the gstack-format Skill that documents Falsafa's methodology — corpus ingestion, catalog descriptions, cross-link computation, eval-gen, etc. — for any AI agent (Claude Code, Codex, Cursor, Aider) to apply to its own archive.

## Distribution

Will be published downstream into the gstack distribution as `falsafa-methodology`. Users install with:

```bash
gstack skills install falsafa-methodology
```

## Why a separate directory

Skills are distributed prose — the format expected by the gstack Skill loader. They're not code, not data, not app. Lives in `skill/` to make the boundary obvious and to keep the prose authoring loop separate from the implementation loops.

## Status

Scaffolded by `/plan-eng-review` run 2 (2026-04-27). Authoring runs in parallel with implementation; the Skill is one of the Phase 3 streams that can ship independently of the launch site.

## Planned structure

```
skill/
  SKILL.md           # the entry point loaded by gstack Skill runner
  references/        # supporting prose chapters loaded on demand
    chapter-splitting.md
    catalog-descriptions.md
    cross-linking.md
    eval-gen.md
  fixtures/          # tiny example corpora the Skill operates on for demos
```
