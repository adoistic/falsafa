# Falsafa Accessibility

This directory is the canonical accessibility artifact set for Falsafa.

## Files

- **`conformance.yaml`** — single source of truth for WCAG 2.2 SCs +
  Section 508 + EN 301 549. Hand-edited; every claim has at least one
  evidence ref. CI gates new claims.
- **`vpat-v1.0.html`** — generated VPAT 2.5 INT.
  Run `bun a11y:generate vpat` to regenerate.
- **`statement-en301549.html`** — generated EN 301 549 Annex F
  accessibility statement. Run `bun a11y:generate annex-f`.
- **`test-runs/<journey>/<sha>/`** — per-PR test artifacts: JSON,
  Markdown transcripts, screenshots, mp4 video, mp3 audio. Written by
  CI; not hand-edited.
- **`manual-tests/jaws-log.yaml`** — manual JAWS verification log
  (JAWS automation is not in scope; verification happens before major
  customer demos).

## Commands

- `bun a11y:verify` — validate `conformance.yaml`'s evidence refs
- `bun a11y:generate vpat` — regenerate the VPAT
- `bun a11y:generate annex-f` — regenerate the Annex F statement
- `bun a11y:generate matrix` — regenerate the TS module the site reads
- `bun a11y` — run the local-runnable suite (axe + pa11y + Playwright synthetic + contrast)

## Spec + plan

- Spec: [`docs/superpowers/specs/2026-05-14-accessibility-design.md`](../superpowers/specs/2026-05-14-accessibility-design.md)
- Plan: [`docs/superpowers/plans/2026-05-14-accessibility-v1.md`](../superpowers/plans/2026-05-14-accessibility-v1.md)
