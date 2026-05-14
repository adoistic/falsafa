# Falsafa Accessibility — Design

**Status:** Spec, awaiting implementation plan.
**Author:** Adnan + Claude (brainstorming session 2026-05-14).
**Goal:** Make Falsafa a showcase-grade accessibility artifact for government
clients in India, the EU, and the US, with every conformance claim
backtrackable to a specific test artifact in the repository.

## Why

Recent accessibility audit (2026-05-14) found Falsafa already meets several
WCAG 2.2 AAA criteria on body text contrast, motion, line-height, and reading
column, but has three Level AA blockers that prevent any honest conformance
claim:

1. **Missing `lang` attributes** on non-English chapter variants. Urdu,
   Sanskrit, Old English, French, German, Old Javanese content inherits
   `<html lang="en">` and is read aloud with English phonemes by screen
   readers — the site's multilingual content is incomprehensible to a blind
   user reading the original-language variants. WCAG 3.1.1 + 3.1.2.
2. **`--rule` token contrast of 1.22:1** against `--paper`, well below the
   3:1 floor for non-text UI. Affects every divider, separator, blockquote
   rule, search-result boundary, variant pill, and work-card border across
   the site. WCAG 1.4.11.
3. **SearchDialog results announce silently.** Only the status string ("12
   results") is in a live region; the results `<ol>` itself updates without
   announcement. Keyboard users have no in-dialog mechanism to step into the
   results list. WCAG 4.1.3 + 2.1.1.

Beyond fixing the blockers, the project is being positioned as a showcase
artifact for government clients across three jurisdictions — India (BIS
IS 17802:2020, GIGW 3.0), the EU (EN 301 549, European Accessibility Act),
and the US (Section 508 Rev. 2017). All three converge on WCAG 2.1/2.2 AA
as the floor. The differentiator a showcase needs is not a higher standard
but **independently verifiable evidence**. Most accessibility statements
are self-attested PDFs with no traceable proof. Falsafa's claim becomes
showcase-grade if any auditor can clone the repo, run one command, and
regenerate every artifact bit-for-bit.

## Non-Goals

- **WCAG 3.0 / "Silver."** Draft only, no government recognizes it, would
  reduce credibility, not increase it.
- **Third-party paid VPAT audit.** ($5K-20K range.) Defer until a paying
  government customer requires it contractually.
- **Real-user testing with disabled testers** via Fable, AccessWorks,
  Knowbility, etc. ($200-2K per session.) Triggered when first paying govt
  customer asks; documented as "scheduled" until then.
- **JAWS automation.** Closed-source, paid license, not CI-friendly. Documented
  as a manual verification step performed before any major government
  customer demo, logged in `/accessibility` under the manual-verification
  table.
- **Pronunciation audio for non-English titles.** Content work, defer to a
  dedicated project. WCAG 3.1.6 AAA stays documented as a content-type
  exception.
- **Orca (Linux screen reader)** and **TalkBack / mobile screen readers.**
  Defer until real demand. NVDA and VoiceOver cover ~67% of global SR usage
  per the WebAIM Screen Reader User Survey #10.
- **Lowering reading level.** WCAG 3.1.5 AAA stays an explicit content-type
  exception. Falsafa publishes graduate-level primary-source philosophy;
  lowering reading level would contradict the project's editorial purpose.
- **Glossary popovers for unusual words (3.1.3 AAA)** are V2, not V1.
  The data exists via `read_wiki` MCP tool but wiring it into the reader
  UI is its own design decision.
- **Pronunciation IPA inline annotations.** Defer to V2 or beyond.

## Conformance target

> Falsafa targets **WCAG 2.2 Level AA conformance**, with **AAA** on
> criteria the content supports, documented in a **VPAT 2.5 INT** plus
> an **EN 301 549 Annex F** accessibility statement. Conformance is
> provable via continuous automated testing committed to the public
> repository; any reviewer may independently regenerate every artifact.

Three content-type exceptions are documented and held across all
jurisdictions: 3.1.3 (Unusual Words), 3.1.5 (Reading Level), 3.1.6
(Pronunciation).

## Architecture overview

A single source of truth (`docs/accessibility/conformance.yaml`) feeds
four downstream artifacts. A three-platform CI matrix runs on every pull
request, producing test artifacts committed back to the branch.

```
docs/accessibility/conformance.yaml         (single source of truth)
            │
            ├──→  apps/a11y-tools/generators/
            │         ├── vpat        →  docs/accessibility/vpat-v1.0.{html,pdf}
            │         ├── annex-f     →  docs/accessibility/statement-en301549.{html,pdf}
            │         └── matrix      →  apps/site/src/lib/conformance.generated.ts
            │
            ├──→  apps/a11y-tools/verify.ts  (CI gate: file:line refs valid?)
            │
            └──→  apps/site/src/pages/accessibility.astro  (reads matrix module)


.github/workflows/a11y.yml (every PR, public-repo CI, free)
            │
            ├── jobs.static          (ubuntu-latest)
            │     axe-core + pa11y + contrast token audit + verify
            │
            ├── jobs.synthetic       (ubuntu-latest)
            │     Playwright AT-tree dumps + Playwright video
            │     espeak fallback audio for non-Mac environments
            │
            ├── jobs.guidepup-vo     (macos-latest)
            │     Guidepup + real VoiceOver + ffmpeg/BlackHole audio
            │
            ├── jobs.guidepup-nvda   (windows-latest)
            │     Guidepup + real NVDA (Chocolatey install) + audio
            │
            └── jobs.commit-results  (ubuntu-latest, on push only)
                  merge artifacts → docs/accessibility/test-runs/<journey>/<sha>/
                  git commit + push back to branch
```

Per-journey test outputs (every PR):

```
docs/accessibility/test-runs/<journey>/<sha>/
            ├── result.json              (machine-readable)
            ├── transcript-synthetic.md  (AT-tree dump)
            ├── transcript-voiceover.md  (real VO output)
            ├── transcript-nvda.md       (real NVDA output)
            ├── screenshots/             (one per focus step)
            ├── video.mp4                (Playwright UI, merged w/ SR audio)
            ├── audio-voiceover.mp3      (real VO voice)
            └── audio-nvda.mp3           (real NVDA voice)
```

## V1 / V2 split

V1 ships an auditable AA claim with full infrastructure. V2 raises the
ceiling to AAA-where-feasible. Each gets its own implementation plan.

### V1 contents (~5 days of focused work)

- Fix three AA blockers (B.1, B.3, B.4 below)
- RTL support on Arabic-script content (B.2)
- System-preference CSS detection complete (B.5)
- Conformance YAML schema + generators (C.1, C.2)
- CI pipeline across Linux + macOS + Windows (C.3)
- Eight test journeys (C.4)
- `/accessibility` page (D)
- VPAT 2.5 INT v1.0 + EN 301 549 Annex F statement (generated)
- Existing AAA wins documented in matrix
- Footer link on every page

### V2 contents (~1-2 weeks, separate spec)

- `Aa` picker in chrome (satisfies 1.4.8 AAA)
- Skip-to-preferences link
- Focus appearance audit (2.4.13 AAA)
- Target size enhanced (2.5.5 AAA)
- `<abbr>` sweep (3.1.4 AAA)
- Link purpose sweep (2.4.9 AAA)
- Glossary popovers via `read_wiki` data (partial credit on 3.1.3 AAA)
- Focus not obscured (2.4.12 AAA)
- VPAT bump to v1.1

# Section B — V1: AA blocker fixes

## B.1 — `lang` attributes on non-English content (WCAG 3.1.1 + 3.1.2)

**Files touched**

- `works.json` — add `script` field per variant where the language code
  alone (`ur`, `sa`, `ang`) is ambiguous. Affected variants: Urdu original
  (`ur-Arab`), Sanskrit transliteration (`sa-Latn`), Sanskrit devanagari
  (`sa-Deva`). Translation variants stay as the base language code (`en`).
- `apps/site/src/lib/corpus.ts` — derive BCP-47 code from
  `variant.language + variant.script`. Add `bcp47Of(variant)` helper.
- `apps/site/src/pages/works/[slug]/[chapter]/[variant].astro` — emit
  `<article class="reader-body" lang={bcp47} dir={isRtl(bcp47) ? 'rtl' : 'ltr'}>`
  on the reader wrapper.
- `apps/site/src/pages/about.astro` — wrap inline mentions of non-English
  terms (Manusmṛti, Bāng-i-Darā, Bṛhaspati, etc.) in
  `<span lang="sa-Latn">…</span>` where the term is foreign. The full term
  list is finite (~50 terms); one-time edit.
- `apps/site/src/components/ChapterBody.astro` — if a variant body
  contains inline foreign words (translator-glossed Sanskrit terms in an
  English translation, for example), those stay as English unless wrapped.
  V1 does not auto-detect mixed-language paragraphs; V2 may add this.

**Test journey**: `reader-original` walks the site to a Bāng-i-Darā Urdu
original chapter, verifies the `lang` attribute is `ur-Arab` and `dir` is
`rtl`. The Guidepup VoiceOver transcript proves the announced voice
switches; the NVDA transcript does the same on Windows.

## B.2 — RTL layout on Arabic-script content

Once Urdu (`ur-Arab`) emits `dir="rtl"`, several existing styles need
`:dir(rtl)` overrides:

- Drop cap (`apps/site/src/styles/reader.css:212-221`) — the `::first-letter`
  float must invert in RTL contexts.
- Variant switcher pills (`apps/site/src/components/VariantSwitcher.astro`)
  — verify the pill order reads naturally in RTL; reverse if confusing.
- Source-citation block dotted underline (`reader.css:358-371`) — verify
  positioning works.
- Reading-progress bar (`reader.css:334-354`) — positioned chrome,
  unaffected; verify only.

The test journey runs both LTR and RTL passes and screenshots both. A
visual regression in CI is a `bun run a11y:contrast` follow-up check.

## B.3 — `--rule` token contrast (WCAG 1.4.11)

**Files touched**

- `apps/site/src/styles/tokens.css` — replace `--rule: #e8e0d2` (1.22:1)
  with a value ≥ 3:1 against `--paper: #faf6ee`. Candidate: `#bfb09a`
  (≈ 3.1:1, needs measurement). Audit dark and sepia theme equivalents.
- `apps/site/src/styles/global.css:50` — replace `--accent-soft #c8907a`
  (2.52:1 hover state) with a *darker* shade like `#6b2c22` (≈ 9:1). Hover
  must darken, not lighten.

**Build-time guard**

A new `scripts/a11y-contrast-audit.ts` reads every token pair from
`tokens.css`, computes ratios via the standard WCAG formula, writes JSON
to `docs/accessibility/test-runs/contrast/<sha>/result.json`. CI fails if
any UI-pair ratio falls below 3:1 or text-pair below 4.5:1.

## B.4 — SearchDialog combobox pattern (WCAG 4.1.3 + 2.1.1)

**Files touched**

- `apps/site/src/components/SearchDialog.astro` — restructure markup
  per the WAI-ARIA Authoring Practices combobox-with-listbox pattern:

  ```html
  <input
    role="combobox"
    aria-expanded="true"
    aria-controls="search-results"
    aria-activedescendant={activeId}
    aria-autocomplete="list"
  />
  <ol id="search-results" role="listbox">
    {results.map((r, i) => (
      <li id={`search-result-${i}`} role="option" aria-selected={i === active}>
        …
      </li>
    ))}
  </ol>
  ```

  Inline script handles ↓ / ↑ to move the active descendant, Enter to open,
  Escape to close (already wired), Cmd+K toggle (already wired).

- Status string ("12 results") stays as `aria-live="polite"`, separate
  from the listbox role.
- Native search clear button (`global.css:461` `display:none`) — restore
  a visible clear control or stop suppressing the native one.

**Test journey**: `search` types a query, verifies `aria-expanded` flips,
arrow-keys move the active descendant, Enter opens the result. Guidepup
transcripts on both screen readers verify each keystroke announces the
new result.

## B.5 — System-preference CSS (multiple AAA criteria, free wins)

`tokens.css` already honors `prefers-reduced-motion`. V1 completes the
others as pure CSS — no UI, no JS:

- `@media (prefers-color-scheme: dark)` → auto-applies `data-theme="dark"`
  tokens at the `:root` level when no localStorage override exists.
- `@media (prefers-contrast: more)` → auto-applies higher-contrast token
  variants (`--ink` → pure black on light, pure white on dark).
- `@media (forced-colors: active)` → tokens fall back to system colors via
  `CanvasText`, `Canvas`, `LinkText`, `ButtonText`, etc. (Windows High
  Contrast Mode support.)

No UI for explicit user overrides in V1; that lands in V2 as the `Aa`
picker. V1 conformance YAML claims **support** for the underlying SCs but
notes the explicit picker is V2.

# Section C — V1: conformance infrastructure

## C.1 — `docs/accessibility/conformance.yaml`

The single source of truth. One entry per WCAG 2.2 Success Criterion (30
A + 20 AA + 28 AAA = 78 entries). Appended sections for Section 508
functional performance criteria and EN 301 549 additional clauses 5-13.

```yaml
meta:
  standard: WCAG 2.2
  conformance_level: AA
  partial_aaa: true
  last_review: 2026-05-14
  next_review: 2026-08-14
  contact: accessibility@thothica.com
  vpat_version: "2.5 INT"
  jurisdictions: [india, eu, us]

criteria:
  - id: "1.1.1"
    name: "Non-text Content"
    level: A
    status: supports     # supports | partial | not-applicable | does-not-support
    notes: >
      All informative images have alt text. Decorative SVGs are marked
      aria-hidden="true".
    evidence:
      - kind: source
        path: apps/site/src/components/WorkCardGrid.astro
        lines: "42-44"
      - kind: source
        path: apps/site/src/layouts/Base.astro
        lines: "92,107,135"
      - kind: test
        path: tests/a11y/journeys/homepage.spec.ts
        lines: "23-31"
      - kind: artifact
        path: docs/accessibility/test-runs/homepage/latest/transcript-synthetic.md
    commit: a3f2b91

  - id: "3.1.5"
    name: "Reading Level"
    level: AAA
    status: not-applicable
    exception: content-type
    notes: >
      Falsafa publishes graduate-level primary-source philosophy across
      six languages. Lowering reading level would require rewriting the
      corpus and is contrary to the project's editorial purpose.
      Mitigations: chapter-level summaries via `read_wiki` MCP tool;
      cross-tradition links via TF-IDF; glossary popovers (planned V2).
    commit: a3f2b91

section_508:
  - id: "302.1"
    name: "Without Vision"
    status: supports
    evidence:
      - kind: artifact
        path: docs/accessibility/test-runs/reader-english/latest/audio-voiceover.mp3
      - kind: artifact
        path: docs/accessibility/test-runs/reader-english/latest/audio-nvda.mp3

en_301_549:
  - clause: "5.2"
    name: "Activation of accessibility features"
    status: supports
    evidence:
      - kind: source
        path: apps/site/src/styles/tokens.css
        lines: "110-130"
```

Each entry is self-contained. A reviewer working through any single row
needs no other context.

## C.2 — Generators (`apps/a11y-tools/`)

New package under `apps/`. Three exposed commands:

```
bun a11y:generate vpat       → docs/accessibility/vpat-v1.0.{html,pdf}
bun a11y:generate annex-f    → docs/accessibility/statement-en301549.{html,pdf}
bun a11y:generate matrix     → apps/site/src/lib/conformance.generated.ts
bun a11y:verify              → exits non-zero if any file:line ref invalid
```

Templates:

- **VPAT 2.5 INT** — follows the official ITI template structure
  (https://www.itic.org/policy/accessibility/vpat). HTML output; PDF via
  Playwright headless render.
- **Annex F** — follows EN 301 549 v3.2.1 Annex F section structure
  (clauses 1-7). HTML output; PDF via Playwright.
- **Matrix module** — emits a typed TypeScript module the Astro page
  imports. No runtime YAML parsing on the client.

Generators are pure functions of the YAML; running them on a clean
checkout produces identical output. The CI commits regenerated artifacts
back to the branch alongside the test runs.

## C.3 — CI pipeline (`.github/workflows/a11y.yml`)

```yaml
name: Accessibility
on:
  pull_request:
  push:
    branches: [main]

jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run build:site
      - run: bun run a11y:axe          # axe-core/cli over built site
      - run: bun run a11y:pa11y        # pa11y-ci over journey URLs
      - run: bun run a11y:contrast     # token-pair contrast audit
      - run: bun run a11y:verify       # conformance.yaml refs valid?
      - uses: actions/upload-artifact@v4
        with: { name: static, path: docs/accessibility/test-runs/ }

  synthetic:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bunx playwright install chromium
      - run: bun run a11y:synthetic    # AT-tree dumps + Playwright video
      - run: bun run a11y:audio:espeak # synthesize text→audio fallback
      - uses: actions/upload-artifact@v4
        with: { name: synthetic, path: docs/accessibility/test-runs/ }

  guidepup-voiceover:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bunx playwright install webkit
      - run: brew install --cask blackhole-2ch
      - run: brew install ffmpeg
      - run: bun run a11y:guidepup:vo  # real VoiceOver, audio capture
      - uses: actions/upload-artifact@v4
        with: { name: voiceover, path: docs/accessibility/test-runs/ }

  guidepup-nvda:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bunx playwright install chromium
      - run: choco install nvda --no-progress --yes
      - run: bun run a11y:guidepup:nvda  # real NVDA, audio capture
      - uses: actions/upload-artifact@v4
        with: { name: nvda, path: docs/accessibility/test-runs/ }

  commit-results:
    needs: [static, synthetic, guidepup-voiceover, guidepup-nvda]
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
      - run: bun run a11y:merge-artifacts
      - run: |
          git config user.name "falsafa-a11y-bot"
          git config user.email "a11y-bot@thothica.com"
          git add docs/accessibility/test-runs/
          git diff --staged --quiet || \
            (git commit -m "chore(a11y): refresh test-run artifacts [skip ci]" && git push)
```

The `commit-results` job runs only on pushes to `main`, not on PRs (PRs
upload artifacts but do not auto-commit; reviewers download them). A
follow-up commit on `main` keeps `/accessibility` page evidence current.

Any of the four parallel jobs failing fails the workflow. CI never
silently degrades the conformance claim.

## C.4 — Test journey list

Eight journeys across the surface, each rendered on three runners (Linux
synthetic + macOS VoiceOver + Windows NVDA) = 24 artifact bundles per CI
run.

| # | Journey | Purpose | Key SCs verified |
|---|---|---|---|
| 1 | `homepage` | Landmarks, skip-link, search trigger, primary nav | 1.3.1, 2.4.1, 2.4.4 |
| 2 | `search` | Combobox keyboard flow, results announce, open-result | 4.1.3, 2.1.1, 1.3.1 |
| 3 | `catalog` | Work card grid, filter chips, work-detail page | 1.3.1, 2.4.6, 4.1.2 |
| 4 | `reader-english` | Chapter body nav, footnote citation, reading-progress | 1.3.1, 2.4.6, 2.4.4 |
| 5 | `reader-original` | Urdu / Sanskrit `lang` switching, RTL on Urdu | 3.1.1, 3.1.2 |
| 6 | `variant-switch` | Variant pill keyboard nav, aria-current state | 4.1.2, 2.1.1 |
| 7 | `eval-case` | Eval explorer tabs (closes existing TODO), delta strip | 4.1.2, 2.4.6 |
| 8 | `theme-prefs` | System-pref auto-detect verified | 1.4.3, 1.4.11, 2.3.3 |

Each journey is one `tests/a11y/journeys/<name>.spec.ts` file. Adding a
journey is one file; adding a runner is one matrix entry in the workflow.

The `eval-case` journey supersedes the existing `aria-selected hashchange`
TODO from `TODOS.md` — that fix lands as part of this journey's
verification work.

# Section D — V1: the `/accessibility` page

`apps/site/src/pages/accessibility.astro`. Read top-to-bottom by an
accessibility officer in ~3 minutes. Linked from every page's footer.

## D.1 — Information architecture

Ten numbered sections, fixed order:

| § | Section | Purpose |
|---|---|---|
| 1 | Conformance claim | The headline statement + last-verified timestamp + VPAT/Annex F downloads |
| 2 | Reading-preferences pointer | One-line nudge to the chrome `Aa` icon (V2 — placeholder text in V1) |
| 3 | Audit yourself | Three shell commands. 90-second verification. The showcase moment |
| 4 | Conformance matrix | The main artifact. WCAG 2.2 SCs grouped by principle, each row click-expandable |
| 5 | Documented exceptions | 3.1.3 / 3.1.5 / 3.1.6 with full rationale. Above the matrix, not below |
| 6 | Methodology | One paragraph: how tests run, OSes, screen readers, artifact paths |
| 7 | Section 508 + EN 301 549 mappings | Two collapsed sections. Same evidence, different framework |
| 8 | Test runs (recent) | Last 10 CI runs. Each row links to artifacts |
| 9 | Manual JAWS verification log | Sparse but present. Honest about the JAWS gap |
| 10 | Report an issue | mailto + GitHub issue template link + SLA commitment |

## D.2 — Conformance matrix row

Each WCAG SC renders as one expandable row that includes the SC ID,
human-readable name, level (A/AA/AAA), status icon, brief notes, and a
"Proof →" link expanding to file:line refs + artifact paths + commit SHA
+ verified-on timestamp. Source comes from `conformance.generated.ts`
which is generated from `conformance.yaml` at build time.

Exception rows (status `not-applicable` with `exception` field) render
with a distinct visual treatment (warning/muted) and full rationale prose.
They appear inline in the matrix at their SC position and are also
re-listed in section §5 for emphasis.

## D.3 — Audit-yourself section

```
Verify every claim on this page in 90 seconds.

  $ git clone https://github.com/adoistic/falsafa
  $ cd falsafa && bun install
  $ bun run a11y

This runs the same axe-core + pa11y + Playwright + VoiceOver (macOS)
+ NVDA (Windows) suite that produced the artifacts on this page.
Bit-identical output expected.

→ How tests work
→ Latest CI run: #1247 (passed all 24 checks)
→ Conformance held without regression since: 2026-04-22
```

## D.4 — Embedded SR audio

For SR-relevant SCs (most of 4.1.x, 2.1.x, 1.3.x, 3.1.x), the proof link
expands to inline audio players:

```
4.1.3  Status Messages                              AA    ✓ Supports

▶ 0:00 ──────────────── 0:42   NVDA reading search results
▶ 0:00 ──────────────── 0:38   VoiceOver reading search results

The search dialog announces "12 results" via aria-live="polite"
and individual results via the combobox listbox pattern.
```

A government reviewer can click play and hear what a blind user hears.
This is the artifact most accessibility statements lack.

## D.5 — Footer wiring

Every page footer adds one new link: `Accessibility →`. Placed between
"Source acknowledgements" and "About" in the existing footer order.

# Section E — V2 preview

Not in scope for the V1 implementation plan. Captured here so V2 is
discoverable.

- **Chrome `Aa` picker** — 24×24 icon in header, popover with
  theme / size / density / motion. Wires the existing
  `data-theme` / `data-size` / `data-density` localStorage system that
  has no UI today. Satisfies WCAG 1.4.8 AAA.
- **Skip-to-preferences** — second skip-link target, visible only on
  focus.
- **Focus appearance audit** — `:focus-visible` styles meet WCAG 2.4.13
  AAA contrast + area requirements.
- **Target size enhanced** — all click targets ≥ 44×44 CSS px. WCAG
  2.5.5 AAA.
- **Focus not obscured** — `scroll-padding-top` on `html` clears the
  sticky header. WCAG 2.4.12 AAA.
- **`<abbr>` sweep** — first-use abbreviations marked across the site.
  Finite list. WCAG 3.1.4 AAA.
- **Link purpose sweep** — "read more" / "view" / bare-image links
  rewritten to make sense in isolation. WCAG 2.4.9 AAA.
- **Glossary popovers** — tap a term in the reader → small popover with
  `read_wiki` definition. Wires existing wiki data. Partial credit on
  WCAG 3.1.3 AAA (still claims `not-applicable` in YAML; most philosophy
  terms remain unmarked).
- **VPAT bump to v1.1** — regenerates VPAT + Annex F with new AAA rows.

## Testing

Verification follows the per-section testing already embedded in each
section. To summarize the testing posture:

**Automated tests catch ~70% of issues.** axe-core, pa11y, Playwright
synthetic transcripts, and contrast token audits run on every PR on
Linux, free.

**Real screen-reader runs catch the remaining ~30%.** Guidepup drives
real VoiceOver on macOS runners and real NVDA on Windows runners, both
free on public GitHub Actions. Audio captured via BlackHole + ffmpeg
(macOS) and Windows native audio APIs (Windows). Real SR transcripts +
audio committed to the repo on every push to main.

**Manual JAWS verification** is performed before any major government
customer demo. Each session is logged in a table on `/accessibility` §9
with date, JAWS version, tester, notes, and result.

**Regression gates:**

- CI fails if axe / pa11y find new violations.
- CI fails if any test journey transcript changes in ways that affect
  the conformance claim (diff comparison against the prior committed
  transcript).
- CI fails if any UI token-pair contrast falls below 3:1, or any text
  pair below 4.5:1, against any active theme.
- CI fails if any `file:line` reference in `conformance.yaml` no longer
  resolves to existing code.

Snapshot tests for the VPAT / Annex F HTML are intentionally NOT in
scope — those documents regenerate from `conformance.yaml`, and a
ref-validity check is sufficient.

## Open questions and risks

**Q1: Auto-commit of test artifacts to `main`.** Specified above as a
follow-up commit after PR merge. Risk: doubles the commit count on
`main` (one for the human-authored change, one for the bot artifact
refresh). Alternative: emit artifacts to a sibling `gh-pages`-style
branch and let `/accessibility` page fetch them at build time. Less
clean for "audit yourself" but cleaner git history. **Decision deferred
to implementation-plan author.**

**Q2: Guidepup version compatibility with the latest Playwright.**
The `@guidepup/playwright` package follows Playwright's release cadence.
We pin both in `package.json`. Risk: an upstream Playwright minor bump
silently breaks Guidepup integration. Mitigation: V1 implementation
plan should add a `bun outdated` check to the weekly dependency-review
routine.

**Q3: macOS VoiceOver audio routing requires BlackHole.** BlackHole is
a kernel extension on macOS, installed via Homebrew. On GitHub
Actions macos-latest runners it requires `sudo`; the install line in
the workflow does this. Risk: GitHub deprecates the macos-latest image
in a way that breaks the install. Mitigation: pin to a specific image
(`macos-14` etc.) and bump on review.

**Q4: NVDA in CI is silent by default.** NVDA installed via Chocolatey
runs in a windowless mode by default. Guidepup handles this. Risk:
an NVDA update breaks the silent-mode contract. Mitigation: pin NVDA
version in the Chocolatey install (`choco install nvda --version=...`).

**Q5: Conformance YAML claims drift from reality.** A developer fixes
something in code but forgets to update the YAML; CI passes (the test
transcripts still show support); the YAML is silently stale. Mitigation:
the `a11y:verify` step also checks that every SC marked `supports` has
at least one `kind: test` evidence entry pointing to a passing test.
A code fix without a test update fails CI.

**Q6: WCAG 2.2 vs 2.1 in different jurisdictions.** India's GIGW 3.0
and EN 301 549 v3.2.1 reference WCAG 2.1; Section 508 references
WCAG 2.0. WCAG 2.2 is a strict superset, so the conformance claim
holds across all three. The VPAT 2.5 INT template covers WCAG 2.2
explicitly. Risk: a reviewer specifically demands WCAG 2.1 conformance
language. Mitigation: the VPAT template includes a clause acknowledging
2.2 supersets 2.1; if a customer requires 2.1-specific wording, V2 can
generate a second variant of the VPAT.

**Q7: The `--rule` color change has visual-design implications.** The
existing `#e8e0d2` is intentionally faint; bumping it to `#bfb09a`
makes every divider line more visible. Risk: design-quality regression
on a site where editorial typography is the product. Mitigation: the
contrast fix is a token change, easily previewed across all themes;
spec writer / V1 implementer should screenshot key pages in all three
themes before merging, and re-tune the exact hex value if the visual
heaviness is wrong.
