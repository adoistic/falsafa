# Falsafa Accessibility V1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land an auditable WCAG 2.2 AA conformance claim for Falsafa, with three AA blocker fixes, a single-source-of-truth conformance matrix, a free three-platform CI pipeline (Linux + macOS + Windows) that produces real screen-reader audio recordings on every PR, and a public `/accessibility` page that exposes every claim with click-through proof.

**Architecture:** Five sequential chunks. Chunk 1 bootstraps the infrastructure (YAML schema, verifier, package layout, open-question resolutions). Chunk 2 lands the three AA fixes plus RTL and system-pref CSS, each fix accompanied by a contrast or static check that becomes a regression gate. Chunk 3 builds the three generators (VPAT, Annex F, matrix module). Chunk 4 wires the CI workflow and the eight test journey scripts. Chunk 5 ships the `/accessibility` page and footer link. Each chunk produces working, testable software on its own — the AA claim is defensible after Chunk 2 even if Chunks 3-5 slip.

**Tech Stack:** Bun (runtime), TypeScript, Astro 5 (site), Preact (interactive islands), Playwright (already installed in `apps/site/`), `@axe-core/playwright` (already installed), pa11y-ci (NEW), `@guidepup/guidepup` + `@guidepup/playwright` (NEW), `yaml` parser (NEW), GitHub Actions (free on public repos). All shell scripts use `node:fs` / `node:path` / `node:url` — no bash-isms (Linux + macOS + Windows CI).

**Spec:** [`docs/superpowers/specs/2026-05-14-accessibility-design.md`](../specs/2026-05-14-accessibility-design.md) (680 lines, reviewed once, two-commit fixes applied).

**Scope locked:**
- V1 only — three AA blockers + RTL + system-pref CSS + conformance infra + CI + `/accessibility` page + footer link.
- V2 (chrome `Aa` picker, focus-appearance AAA, target-size AAA, glossary popovers, `<abbr>` sweep) is explicitly out of scope and gets its own spec/plan later.
- Three content-type exceptions (WCAG 3.1.3 / 3.1.5 / 3.1.6) documented but not implemented.

---

## Pre-flight knowledge for the implementer

Read this before opening any file.

1. **Working directory:** `/Users/siraj/falsafa/.claude/worktrees/elegant-sammet-f9bc5b`. Branch: `claude/elegant-sammet-f9bc5b`. PR lands on `main`.
2. **Repo is PUBLIC** at `https://github.com/adoistic/falsafa`. GitHub Actions on public repos is **free across all runners (Linux, macOS, Windows)**, including unlimited minutes. The CI matrix in this plan has zero ongoing cost.
3. **Playwright is already a devDep** in `apps/site/`. `@axe-core/playwright` too. Do not re-add. The new deps are `pa11y-ci`, `@guidepup/guidepup`, `@guidepup/playwright`, and `yaml`.
4. **Existing tests:** `bun test` runs everything via the Bun test runner. Tests live next to source as `*.test.ts` or in `__tests__/` subdirs. Playwright tests use `@playwright/test` runner via `bunx playwright test`.
5. **Astro project root** is `apps/site/`. Build with `bun run --cwd apps/site build`. Dev with `bun run --cwd apps/site dev`.
6. **Site auto-deploys** from `main` to Vercel. The `/accessibility` page is public on first deploy after V1 lands.
7. **Existing tokens.css** has three themes (`light`, `dark`, `sepia`) defined at `:root` and `[data-theme="..."]` selectors. Lines 1-95 are token blocks; 114-121 is the existing `prefers-reduced-motion` media query.
8. **The published `@falsafa/mcp@0.1.2`** is unaffected by this plan. We touch only the site.
9. **Use bcp47Of() consistently** — any code that emits `<html lang>` or `<article lang>` or `<span lang>` for non-English content goes through one helper. Do not hand-write `lang="ur"` anywhere.
10. **Iron Rule on screenshots:** Playwright tests must use deterministic viewport sizes (1280×720 default), disabled animations (`reducedMotion: 'reduce'` in config), and `prefers-color-scheme: light` unless the test explicitly tests dark/sepia. CI diff stability depends on this.

## Open question resolutions (Q1, Q8, Q9 from spec)

These are decided here so Chunk 1 can encode them.

**Q1 — Auto-commit of test artifacts to `main`:** Resolved as **auto-commit on push-to-main only, NOT on PRs**. PRs upload artifacts to GitHub Actions artifact storage (reviewers download from the PR's Files tab). On merge to `main`, a follow-up bot commit refreshes `docs/accessibility/test-runs/` with `[skip ci]` in the message to prevent recursive triggers. Rationale: keeps PR git history clean, `/accessibility` page on production always reflects the latest mainline run, "audit yourself" reproduces the same artifacts locally.

**Q8 — `actions/upload-artifact@v4` and `actions/download-artifact@v4`:** Resolved as **`download-artifact@v4` with `merge-multiple: true`**. Each parallel job uploads to its own named artifact bucket (e.g., `static`, `synthetic`, `voiceover`, `nvda`). The `commit-results` job downloads all four with `merge-multiple: true` into a single directory, then runs `bun run a11y:merge-artifacts` to organize them into the canonical `docs/accessibility/test-runs/<journey>/<sha>/` shape.

**Q9 — Line-number drift in `conformance.yaml` evidence refs:** Resolved as **hybrid: support both `lines: "N-M"` and `anchor: "string"`**. Default to `lines` for stable refs (test file paths, fixed function locations). Use `anchor` for things that move with refactors (CSS token names, ARIA attributes). The verifier:
- For `lines`: opens the file, asserts it has at least `M` lines and the slice is non-empty.
- For `anchor`: opens the file, asserts `anchor` substring appears at least once, and reports back the line(s) it appears on (these get embedded in the generated VPAT for reviewer convenience).

## File structure

43 files total: 25 NEW (16 code + 7 templates/data + 2 generated/initial) + 18 MODIFY. Above the 8-file smell threshold but justified: a single source-of-truth artifact, three generators, four CI jobs, eight test journeys, and seven `/accessibility` page sections. Each unit has one clear responsibility.

| File | Status | Lines | Responsibility |
|---|---|---|---|
| `docs/accessibility/conformance.yaml` | NEW | ~600 | Single source of truth — 86 WCAG 2.2 SCs (30 A + 25 AA + 31 AAA) + Section 508 + EN 301 549 |
| `docs/accessibility/README.md` | NEW | ~80 | "How accessibility works in this repo" — pointer to spec + plan + commands |
| `docs/accessibility/manual-tests/jaws-log.yaml` | NEW | ~10 | Initial empty JAWS verification log |
| `apps/a11y-tools/package.json` | NEW | ~25 | Workspace package manifest |
| `apps/a11y-tools/src/types.ts` | NEW | ~90 | TypeScript types mirroring the YAML schema |
| `apps/a11y-tools/src/parse.ts` | NEW | ~60 | YAML parser with zod validation |
| `apps/a11y-tools/src/verify.ts` | NEW | ~140 | `a11y:verify` CLI — checks every evidence ref resolves |
| `apps/a11y-tools/src/generate/vpat.ts` | NEW | ~280 | VPAT 2.5 INT generator |
| `apps/a11y-tools/src/generate/annex-f.ts` | NEW | ~220 | EN 301 549 Annex F generator |
| `apps/a11y-tools/src/generate/matrix.ts` | NEW | ~80 | TypeScript module emitter for the page |
| `apps/a11y-tools/src/index.ts` | NEW | ~50 | CLI dispatcher (`generate <kind>`, `verify`) |
| `apps/a11y-tools/templates/vpat-2.5-int.html.tmpl` | NEW | ~300 | VPAT template (HTML, Mustache-style) |
| `apps/a11y-tools/templates/annex-f.html.tmpl` | NEW | ~150 | Annex F template (HTML) |
| `apps/a11y-tools/src/__tests__/parse.test.ts` | NEW | ~90 | Parser unit tests |
| `apps/a11y-tools/src/__tests__/verify.test.ts` | NEW | ~140 | Verifier unit tests (covers `lines` + `anchor`) |
| `apps/a11y-tools/src/__tests__/vpat.test.ts` | NEW | ~80 | Generator snapshot test |
| `scripts/seed-wcag22.ts` | NEW (one-shot) | ~250 | Vendored WCAG 2.2 SC list → emits initial `conformance.yaml`. Deletable after Chunk 1 lands. |
| `scripts/a11y-contrast-audit.ts` | NEW | ~170 | Contrast token audit — reads tokens.css, computes ratios, emits JSON |
| `scripts/__tests__/a11y-contrast-audit.test.ts` | NEW | ~100 | Contrast audit unit tests (mocked CSS input) |
| `apps/site/src/styles/tokens.css` | MODIFY | ~+30 | `--rule` + `--accent-soft` contrast fixes; prefers-contrast + forced-colors media queries |
| `works.json` | MODIFY | ~+40 | Add `script` field to variants where needed |
| `apps/site/src/lib/corpus.ts` | MODIFY | ~+50 | `bcp47Of(variant)` + `isRtl(bcp47)` helpers |
| `apps/site/src/lib/__tests__/corpus-bcp47.test.ts` | NEW | ~90 | Unit tests for bcp47Of + isRtl |
| `apps/site/src/pages/works/[slug]/[chapter]/[variant].astro` | MODIFY | ~+10 | Emit `lang` + `dir` on `<article>` wrapper |
| `apps/site/src/pages/about.astro` | MODIFY | ~+25 | Wrap foreign terms in `<span lang="...">` |
| `apps/site/src/styles/reader.css` | MODIFY | ~+30 | RTL drop-cap inversion, variant pill direction, source-citation positioning |
| `apps/site/src/components/SearchDialog.astro` | MODIFY | ~+60 | Combobox restructure (role/aria-* + activedescendant) |
| `apps/site/src/styles/global.css` | MODIFY | ~-3 | Remove `display: none` on search clear button |
| `.github/workflows/a11y.yml` | NEW | ~200 | Three-platform CI matrix + commit-results |
| `tests/a11y/playwright.config.ts` | NEW | ~60 | Playwright config (separate from any existing site config) |
| `tests/a11y/lib/synthetic-transcript.ts` | NEW | ~140 | AT-tree to text dump utility |
| `tests/a11y/lib/guidepup-helpers.ts` | NEW | ~100 | Common Guidepup setup/teardown helpers |
| `tests/a11y/lib/__tests__/synthetic-transcript.test.ts` | NEW | ~80 | Unit tests for transcript dumper |
| `tests/a11y/journeys/homepage.spec.ts` | NEW | ~90 | Journey #1: landmarks, skip-link, search trigger |
| `tests/a11y/journeys/search.spec.ts` | NEW | ~140 | Journey #2: combobox keyboard flow |
| `tests/a11y/journeys/catalog.spec.ts` | NEW | ~90 | Journey #3: work cards, filter chips |
| `tests/a11y/journeys/reader-english.spec.ts` | NEW | ~90 | Journey #4: chapter body nav |
| `tests/a11y/journeys/reader-original.spec.ts` | NEW | ~120 | Journey #5: lang switching, RTL on Urdu |
| `tests/a11y/journeys/variant-switch.spec.ts` | NEW | ~90 | Journey #6: variant pills, aria-current |
| `tests/a11y/journeys/eval-case.spec.ts` | NEW | ~100 | Journey #7: eval tabs (closes existing TODO) |
| `tests/a11y/journeys/theme-prefs.spec.ts` | NEW | ~90 | Journey #8: prefers-color-scheme / contrast / motion |
| `tests/a11y/lib/merge-artifacts.ts` | NEW | ~80 | Reorganizes CI artifacts into canonical layout |
| `apps/site/src/pages/accessibility.astro` | NEW | ~220 | The `/accessibility` page |
| `apps/site/src/components/ConformanceMatrix.astro` | NEW | ~180 | Matrix renderer (reads conformance.generated.ts) |
| `apps/site/src/components/AuditYourself.astro` | NEW | ~60 | The audit-yourself code block |
| `apps/site/src/components/AccessibilityExceptions.astro` | NEW | ~90 | Documented exceptions section |
| `apps/site/src/components/AccessibilityTestRuns.astro` | NEW | ~90 | Last-10-runs table reading from test-runs/ |
| `apps/site/src/components/JawsLog.astro` | NEW | ~60 | Manual JAWS verification log renderer |
| `apps/site/src/lib/test-run-artifacts.ts` | NEW | ~120 | Build-time reader for docs/accessibility/test-runs/ |
| `apps/site/src/lib/conformance.generated.ts` | GENERATED | ~varies | Output of `bun a11y:generate matrix` — do not hand-edit |
| `apps/site/src/layouts/Base.astro` | MODIFY | ~+2 | Add `/accessibility` link to footer |
| `package.json` | MODIFY | ~+8 | Add `a11y:*` scripts |
| `.gitignore` | MODIFY | ~+1 | Add `.superpowers/` |

---

## Chunk 1: Bootstrap conformance infrastructure

**Why first:** every later chunk references `conformance.yaml` and the verifier. Without the schema and a working verifier, fixes in Chunk 2 cannot record evidence and CI in Chunk 4 cannot gate regressions.

**Deliverables (Chunk 1):**
- `apps/a11y-tools/` workspace package
- `conformance.yaml` with all 86 WCAG 2.2 SC stubs (30 A + 25 AA + 31 AAA) + 9 Section 508 entries + 7 EN 301 549 entries (empty evidence, status placeholders)
- Verifier (`bun a11y:verify`) — supports both `lines` and `anchor` evidence kinds
- `package.json` adds the `a11y:*` scripts
- `.gitignore` adds `.superpowers/`
- Initial `docs/accessibility/README.md` linking spec + plan
- Initial empty `docs/accessibility/manual-tests/jaws-log.yaml`
- Tests for the parser + verifier with ≥95% coverage on those files

**End-state proof:** `bun a11y:verify` exits 0 against a valid YAML, exits non-zero with a clear error when a ref points to a missing file or wrong anchor.

### Task 1: Add `.superpowers/` to `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add the line**

```diff
 # Local config — never commit (contains DB credentials)
 .claude/
+.superpowers/
```

- [ ] **Step 2: Verify nothing tracked from `.superpowers/`**

Run: `git status --porcelain | grep "\.superpowers" || true`
Expected: empty output. (The `|| true` prevents `set -e` shells from treating the no-match exit as a script failure.)

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .superpowers/ brainstorm workspaces"
```

### Task 2: Create `apps/a11y-tools/` package skeleton

**Files:**
- Create: `apps/a11y-tools/package.json`
- Create: `apps/a11y-tools/tsconfig.json`
- Create: `apps/a11y-tools/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@falsafa/a11y-tools",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "description": "Falsafa accessibility tooling — VPAT, Annex F, conformance verifier",
  "license": "MIT",
  "main": "src/index.ts",
  "bin": {
    "a11y-tools": "src/index.ts"
  },
  "scripts": {
    "test": "bun test"
  },
  "dependencies": {
    "yaml": "^2.5.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create the CLI entry placeholder**

```ts
#!/usr/bin/env bun
// apps/a11y-tools/src/index.ts

const subcommand = process.argv[2];

switch (subcommand) {
  case "verify":
    await import("./verify.js").then((m) => m.main());
    break;
  case "generate":
    await import("./generate/index.js").then((m) => m.main(process.argv.slice(3)));
    break;
  default:
    console.error("usage: a11y-tools <verify|generate <kind>>");
    process.exit(2);
}
```

- [ ] **Step 4: Install workspace deps**

Run: `bun install`
Expected: `yaml` and `zod` resolve under `apps/a11y-tools/node_modules/` (workspace hoist may put them at root).

- [ ] **Step 5: Commit**

```bash
git add apps/a11y-tools/
git commit -m "feat(a11y-tools): package skeleton + CLI dispatcher"
```

### Task 3: Wire root-level a11y:* scripts in package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add scripts**

Add to the `scripts` block in root `package.json`:

```json
{
  "scripts": {
    "audit": "bun run scripts/corpus-audit.ts",
    "convert": "bun run scripts/convert.ts",
    "cross-link": "bun run scripts/cross-link.ts",
    "images": "bun run scripts/generate-images.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "a11y:verify": "bun run apps/a11y-tools/src/index.ts verify",
    "a11y:generate": "bun run apps/a11y-tools/src/index.ts generate",
    "a11y:contrast": "bun run scripts/a11y-contrast-audit.ts",
    "a11y:pa11y": "bunx pa11y-ci --config tests/a11y/pa11y.config.json",
    "a11y:synthetic": "bunx --cwd apps/site playwright test --config ../../tests/a11y/playwright.config.ts --project synthetic",
    "a11y:guidepup:vo": "bunx --cwd apps/site playwright test --config ../../tests/a11y/playwright.config.ts --project voiceover",
    "a11y:guidepup:nvda": "bunx --cwd apps/site playwright test --config ../../tests/a11y/playwright.config.ts --project nvda",
    "a11y:audio:espeak": "bun run tests/a11y/lib/synthesize-audio.ts",
    "a11y:merge-artifacts": "bun run tests/a11y/lib/merge-artifacts.ts",
    "a11y": "bun run a11y:contrast && bun run a11y:verify && bun run a11y:pa11y && bun run a11y:synthetic"
  }
}
```

Notes:
- **axe-core runs inside the Playwright journey tests** (via the already-installed `@axe-core/playwright`), not as a separate CLI. The `a11y:synthetic` script invokes Playwright; each journey calls `new AxeBuilder({ page }).analyze()` and asserts no violations. This gives axe coverage without adding `@axe-core/cli` as a dependency.
- `a11y:audio:espeak` and `a11y:merge-artifacts` are stubs in Chunk 1 — they point at files created in Chunk 4. Listing them here keeps `package.json` edits centralized; the files are created later in the plan.
- `a11y` is the shortcut for "run everything local that doesn't need macOS/Windows screen reader runners" — what the "audit yourself" section will tell visitors to run.

- [ ] **Step 2: Verify scripts list**

Run: `bun run 2>&1 | grep "a11y:"`
Expected: lists all `a11y:*` entries (verify, generate, contrast, pa11y, synthetic, guidepup:vo, guidepup:nvda, audio:espeak, merge-artifacts, plus the unscoped `a11y`).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(a11y): add a11y:* npm scripts"
```

### Task 4: Define the YAML schema types

**Files:**
- Create: `apps/a11y-tools/src/types.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/a11y-tools/src/__tests__/types.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { ConformanceDocSchema, EvidenceSchema } from "../types";

describe("ConformanceDoc schema", () => {
  it("accepts a minimal valid doc", () => {
    const doc = {
      meta: {
        standard: "WCAG 2.2",
        conformance_level: "AA",
        partial_aaa: true,
        last_review: "2026-05-14",
        next_review: "2026-08-14",
        contact: "accessibility@thothica.com",
        vpat_version: "2.5 INT",
        jurisdictions: ["india", "eu", "us"],
      },
      criteria: [
        {
          id: "1.1.1",
          name: "Non-text Content",
          level: "A",
          status: "supports",
          notes: "ok",
          evidence: [],
          commit: "abc1234",
        },
      ],
      section_508: [],
      en_301_549: [],
    };
    expect(() => ConformanceDocSchema.parse(doc)).not.toThrow();
  });

  it("rejects criterion with status:supports but empty evidence", () => {
    const doc = {
      meta: { standard: "WCAG 2.2", conformance_level: "AA", partial_aaa: false, last_review: "2026-05-14", next_review: "2026-08-14", contact: "x@y", vpat_version: "2.5 INT", jurisdictions: ["us"] },
      criteria: [{ id: "1.1.1", name: "X", level: "A", status: "supports", notes: "ok", evidence: [], commit: "abc1234" }],
      section_508: [],
      en_301_549: [],
    };
    expect(() => ConformanceDocSchema.parse(doc)).toThrow(/at least one/);
  });

  it("rejects evidence with neither lines nor anchor", () => {
    const ev = { kind: "source", path: "x.ts" };
    expect(() => EvidenceSchema.parse(ev)).toThrow(/lines|anchor/);
  });

  it("accepts artifact evidence without lines/anchor", () => {
    const ev = { kind: "artifact", path: "test-runs/x/result.json" };
    expect(() => EvidenceSchema.parse(ev)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/a11y-tools/src/__tests__/types.test.ts`
Expected: FAIL. Bun reports `Cannot find module '../types'` (or similar resolution error). Any other failure means the test is wrong; fix it before continuing.

- [ ] **Step 3: Implement types.ts**

```ts
// apps/a11y-tools/src/types.ts
import { z } from "zod";

export const EvidenceKindSchema = z.enum(["source", "test", "artifact"]);

export const EvidenceSchema = z
  .object({
    kind: EvidenceKindSchema,
    path: z.string().min(1),
    lines: z.string().regex(/^\d+(-\d+)?(,\d+(-\d+)?)*$/).optional(),
    anchor: z.string().min(1).optional(),
  })
  .refine((e) => e.kind === "artifact" || e.lines || e.anchor, {
    message: "source/test evidence requires lines or anchor",
  });

export const StatusSchema = z.enum([
  "supports",
  "partial",
  "not-applicable",
  "does-not-support",
]);

export const LevelSchema = z.enum(["A", "AA", "AAA"]);

export const ConformanceCriterionSchema = z
  .object({
    id: z.string().regex(/^\d+\.\d+\.\d+$/),
    name: z.string().min(1),
    level: LevelSchema,
    status: StatusSchema,
    exception: z.string().optional(),
    notes: z.string().min(1),
    evidence: z.array(EvidenceSchema),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
  })
  .refine(
    (c) => c.status !== "supports" || c.evidence.length > 0,
    { message: "status:supports requires at least one evidence entry" },
  )
  .refine(
    (c) => c.status !== "not-applicable" || c.exception,
    { message: "status:not-applicable requires an exception field" },
  );

export const MetaSchema = z.object({
  standard: z.literal("WCAG 2.2"),
  conformance_level: LevelSchema,
  partial_aaa: z.boolean(),
  last_review: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  next_review: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contact: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "must be an email"),
  vpat_version: z.string().min(1),
  jurisdictions: z.array(z.enum(["india", "eu", "us"])).min(1),
});

export const Section508EntrySchema = z.object({
  id: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
  name: z.string().min(1),
  status: StatusSchema,
  notes: z.string().optional(),
  evidence: z.array(EvidenceSchema),
});

export const EN301549EntrySchema = z.object({
  clause: z.string().regex(/^\d+(\.\d+)*$/),
  name: z.string().min(1),
  status: StatusSchema,
  notes: z.string().optional(),
  evidence: z.array(EvidenceSchema),
});

export const ConformanceDocSchema = z.object({
  meta: MetaSchema,
  criteria: z.array(ConformanceCriterionSchema),
  section_508: z.array(Section508EntrySchema),
  en_301_549: z.array(EN301549EntrySchema),
});

export type ConformanceDoc = z.infer<typeof ConformanceDocSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Status = z.infer<typeof StatusSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/a11y-tools/src/__tests__/types.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add apps/a11y-tools/src/types.ts apps/a11y-tools/src/__tests__/types.test.ts
git commit -m "feat(a11y-tools): conformance YAML schema + validation"
```

### Task 5: Implement the YAML parser

**Files:**
- Create: `apps/a11y-tools/src/parse.ts`
- Create: `apps/a11y-tools/src/__tests__/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/a11y-tools/src/__tests__/parse.test.ts
import { describe, expect, it } from "bun:test";
import { parseConformanceDoc, parseConformanceDocText } from "../parse";

const MIN_DOC = `
meta:
  standard: WCAG 2.2
  conformance_level: AA
  partial_aaa: true
  last_review: "2026-05-14"
  next_review: "2026-08-14"
  contact: a@b.com
  vpat_version: "2.5 INT"
  jurisdictions: [india, eu, us]
criteria:
  - id: "1.1.1"
    name: Non-text Content
    level: A
    status: supports
    notes: ok
    evidence:
      - kind: source
        path: x.ts
        lines: "1-10"
    commit: abc1234
section_508: []
en_301_549: []
`;

describe("parseConformanceDocText", () => {
  it("parses a valid YAML string", () => {
    const doc = parseConformanceDocText(MIN_DOC);
    expect(doc.criteria.length).toBe(1);
    expect(doc.criteria[0]!.id).toBe("1.1.1");
  });

  it("throws on invalid YAML structure", () => {
    expect(() => parseConformanceDocText("criteria: not-an-array")).toThrow();
  });

  it("throws on schema violation with location info", () => {
    const bad = MIN_DOC.replace("level: A", "level: ZZZ");
    expect(() => parseConformanceDocText(bad)).toThrow(/level/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/a11y-tools/src/__tests__/parse.test.ts`
Expected: FAIL. Bun reports `Cannot find module '../parse'`. Any other failure means the test is wrong; fix it first.

- [ ] **Step 3: Implement parse.ts**

```ts
// apps/a11y-tools/src/parse.ts
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { ConformanceDocSchema, type ConformanceDoc } from "./types.js";

export function parseConformanceDocText(text: string): ConformanceDoc {
  const raw = parseYaml(text);
  if (raw === null || typeof raw !== "object") {
    throw new Error("conformance.yaml: expected top-level object");
  }
  return ConformanceDocSchema.parse(raw);
}

export async function parseConformanceDoc(path: string): Promise<ConformanceDoc> {
  const text = await readFile(path, "utf8");
  return parseConformanceDocText(text);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/a11y-tools/src/__tests__/parse.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add apps/a11y-tools/src/parse.ts apps/a11y-tools/src/__tests__/parse.test.ts
git commit -m "feat(a11y-tools): YAML parser with zod validation"
```

### Task 6: Implement the verifier (supports `lines` and `anchor`)

**Files:**
- Create: `apps/a11y-tools/src/verify.ts`
- Create: `apps/a11y-tools/src/__tests__/verify.test.ts`

The verifier is the regression gate. For every evidence entry across all criteria + 508 + EN sections, it confirms the file exists and the `lines` or `anchor` resolves.

- [ ] **Step 1: Write the failing test**

```ts
// apps/a11y-tools/src/__tests__/verify.test.ts
import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyEvidence } from "../verify";

const td = mkdtempSync(join(tmpdir(), "a11y-verify-"));
writeFileSync(
  join(td, "sample.ts"),
  "// line 1\n--rule: token;\n// line 3\n",
);

describe("verifyEvidence", () => {
  it("passes when lines range fits file", async () => {
    const errs = await verifyEvidence(
      { kind: "source", path: "sample.ts", lines: "1-3" },
      td,
    );
    expect(errs).toEqual([]);
  });

  it("fails when lines range exceeds file", async () => {
    const errs = await verifyEvidence(
      { kind: "source", path: "sample.ts", lines: "1-99" },
      td,
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/lines/);
  });

  it("passes when anchor string appears in file", async () => {
    const errs = await verifyEvidence(
      { kind: "source", path: "sample.ts", anchor: "--rule" },
      td,
    );
    expect(errs).toEqual([]);
  });

  it("fails when anchor string is absent", async () => {
    const errs = await verifyEvidence(
      { kind: "source", path: "sample.ts", anchor: "--missing" },
      td,
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/anchor/);
  });

  it("fails when file missing", async () => {
    const errs = await verifyEvidence(
      { kind: "source", path: "does-not-exist.ts", lines: "1" },
      td,
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/not found|ENOENT/);
  });

  it("skips artifact-kind evidence (artifacts written by CI)", async () => {
    const errs = await verifyEvidence(
      { kind: "artifact", path: "docs/accessibility/test-runs/x/latest/transcript.md" },
      td,
    );
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/a11y-tools/src/__tests__/verify.test.ts`
Expected: FAIL. Bun reports `Cannot find module '../verify'`. Any other failure means the test is wrong; fix it first.

- [ ] **Step 3: Implement verify.ts**

```ts
// apps/a11y-tools/src/verify.ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseConformanceDoc } from "./parse.js";
import type { Evidence } from "./types.js";

export async function verifyEvidence(ev: Evidence, repoRoot: string): Promise<string[]> {
  const errors: string[] = [];
  if (ev.kind === "artifact") return errors;

  const abs = resolve(repoRoot, ev.path);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch (e: any) {
    errors.push(`${ev.path}: ${e.code === "ENOENT" ? "not found" : e.message}`);
    return errors;
  }

  if (ev.lines) {
    const lineCount = text.split(/\r?\n/).length;
    for (const range of ev.lines.split(",")) {
      const [a, b] = range.split("-").map(Number);
      const start = a;
      const end = b ?? a;
      if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < start) {
        errors.push(`${ev.path}: malformed lines range "${range}"`);
        continue;
      }
      if (end > lineCount) {
        errors.push(`${ev.path}: lines "${range}" exceeds file length (${lineCount} lines)`);
      }
    }
  }

  if (ev.anchor) {
    if (!text.includes(ev.anchor)) {
      errors.push(`${ev.path}: anchor "${ev.anchor}" not found in file`);
    }
  }

  return errors;
}

export async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const yamlPath = resolve(repoRoot, "docs/accessibility/conformance.yaml");
  const doc = await parseConformanceDoc(yamlPath);

  const allErrors: string[] = [];

  for (const c of doc.criteria) {
    for (const ev of c.evidence) {
      const errs = await verifyEvidence(ev, repoRoot);
      for (const e of errs) allErrors.push(`SC ${c.id} (${c.name}): ${e}`);
    }
  }
  for (const e of doc.section_508) {
    for (const ev of e.evidence) {
      const errs = await verifyEvidence(ev, repoRoot);
      for (const m of errs) allErrors.push(`Section 508 ${e.id} (${e.name}): ${m}`);
    }
  }
  for (const e of doc.en_301_549) {
    for (const ev of e.evidence) {
      const errs = await verifyEvidence(ev, repoRoot);
      for (const m of errs) allErrors.push(`EN 301 549 ${e.clause} (${e.name}): ${m}`);
    }
  }

  if (allErrors.length > 0) {
    console.error("Conformance YAML verification FAILED:");
    for (const e of allErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`Conformance YAML verification PASSED (${doc.criteria.length} criteria, ${doc.section_508.length} 508, ${doc.en_301_549.length} EN 301 549 checked).`);
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `bun test apps/a11y-tools/src/__tests__/verify.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
git add apps/a11y-tools/src/verify.ts apps/a11y-tools/src/__tests__/verify.test.ts
git commit -m "feat(a11y-tools): verifier supports lines + anchor evidence"
```

### Task 7: Seed `conformance.yaml` with all 86 WCAG 2.2 SC stubs

**Files:**
- Create: `docs/accessibility/conformance.yaml`
- Create: `scripts/seed-wcag22.ts` (one-shot generator — see Step 1)

Stubs only — every entry starts with `status: does-not-support` and a generic `notes: "TBD V1"`. Each SC gets a real `status` + evidence in Chunk 2 (fixes) or Chunk 4 (test-journey-validated SCs).

The 30 A + 25 AA + 31 AAA = **86** criterion IDs are taken from WCAG 2.2 (W3C Recommendation 2023-10-05). Source of truth: https://www.w3.org/TR/WCAG22/#all-success-criteria

To prevent transcription drift, a one-shot seeding script generates the YAML from a vendored TypeScript constant. Run once, then commit the YAML; the script may be deleted in a follow-up.


- [ ] **Step 1a: Create the one-shot seed script**

Create `scripts/seed-wcag22.ts`. The script writes the YAML deterministically from a vendored constant.

```ts
#!/usr/bin/env bun
// scripts/seed-wcag22.ts — one-shot YAML seeder for WCAG 2.2 SCs.
// Source: https://www.w3.org/TR/WCAG22/#all-success-criteria (2023-10-05 recommendation).
import { writeFileSync } from "node:fs";

type Level = "A" | "AA" | "AAA";
const SCS: Array<{ id: string; name: string; level: Level }> = [
  // Level A — 30 SCs
  { id: "1.1.1", name: "Non-text Content", level: "A" },
  { id: "1.2.1", name: "Audio-only and Video-only (Prerecorded)", level: "A" },
  { id: "1.2.2", name: "Captions (Prerecorded)", level: "A" },
  { id: "1.2.3", name: "Audio Description or Media Alternative (Prerecorded)", level: "A" },
  { id: "1.3.1", name: "Info and Relationships", level: "A" },
  { id: "1.3.2", name: "Meaningful Sequence", level: "A" },
  { id: "1.3.3", name: "Sensory Characteristics", level: "A" },
  { id: "1.4.1", name: "Use of Color", level: "A" },
  { id: "1.4.2", name: "Audio Control", level: "A" },
  { id: "2.1.1", name: "Keyboard", level: "A" },
  { id: "2.1.2", name: "No Keyboard Trap", level: "A" },
  { id: "2.1.4", name: "Character Key Shortcuts", level: "A" },
  { id: "2.2.1", name: "Timing Adjustable", level: "A" },
  { id: "2.2.2", name: "Pause, Stop, Hide", level: "A" },
  { id: "2.3.1", name: "Three Flashes or Below Threshold", level: "A" },
  { id: "2.4.1", name: "Bypass Blocks", level: "A" },
  { id: "2.4.2", name: "Page Titled", level: "A" },
  { id: "2.4.3", name: "Focus Order", level: "A" },
  { id: "2.4.4", name: "Link Purpose (In Context)", level: "A" },
  { id: "2.5.1", name: "Pointer Gestures", level: "A" },
  { id: "2.5.2", name: "Pointer Cancellation", level: "A" },
  { id: "2.5.3", name: "Label in Name", level: "A" },
  { id: "2.5.4", name: "Motion Actuation", level: "A" },
  { id: "3.1.1", name: "Language of Page", level: "A" },
  { id: "3.2.1", name: "On Focus", level: "A" },
  { id: "3.2.2", name: "On Input", level: "A" },
  { id: "3.2.6", name: "Consistent Help", level: "A" }, // new in 2.2
  { id: "3.3.1", name: "Error Identification", level: "A" },
  { id: "3.3.2", name: "Labels or Instructions", level: "A" },
  { id: "4.1.2", name: "Name, Role, Value", level: "A" },

  // Level AA — 25 SCs
  { id: "1.2.4", name: "Captions (Live)", level: "AA" },
  { id: "1.2.5", name: "Audio Description (Prerecorded)", level: "AA" },
  { id: "1.3.4", name: "Orientation", level: "AA" },
  { id: "1.3.5", name: "Identify Input Purpose", level: "AA" },
  { id: "1.4.3", name: "Contrast (Minimum)", level: "AA" },
  { id: "1.4.4", name: "Resize Text", level: "AA" },
  { id: "1.4.5", name: "Images of Text", level: "AA" },
  { id: "1.4.10", name: "Reflow", level: "AA" },
  { id: "1.4.11", name: "Non-text Contrast", level: "AA" },
  { id: "1.4.12", name: "Text Spacing", level: "AA" },
  { id: "1.4.13", name: "Content on Hover or Focus", level: "AA" },
  { id: "2.4.5", name: "Multiple Ways", level: "AA" },
  { id: "2.4.6", name: "Headings and Labels", level: "AA" },
  { id: "2.4.7", name: "Focus Visible", level: "AA" },
  { id: "2.4.11", name: "Focus Not Obscured (Minimum)", level: "AA" }, // new in 2.2
  { id: "2.5.7", name: "Dragging Movements", level: "AA" }, // new in 2.2
  { id: "2.5.8", name: "Target Size (Minimum)", level: "AA" }, // new in 2.2
  { id: "3.1.2", name: "Language of Parts", level: "AA" },
  { id: "3.2.3", name: "Consistent Navigation", level: "AA" },
  { id: "3.2.4", name: "Consistent Identification", level: "AA" },
  { id: "3.3.3", name: "Error Suggestion", level: "AA" },
  { id: "3.3.4", name: "Error Prevention (Legal, Financial, Data)", level: "AA" },
  { id: "3.3.7", name: "Redundant Entry", level: "AA" }, // new in 2.2
  { id: "3.3.8", name: "Accessible Authentication (Minimum)", level: "AA" }, // new in 2.2
  { id: "4.1.3", name: "Status Messages", level: "AA" },

  // Level AAA — 31 SCs
  { id: "1.2.6", name: "Sign Language (Prerecorded)", level: "AAA" },
  { id: "1.2.7", name: "Extended Audio Description (Prerecorded)", level: "AAA" },
  { id: "1.2.8", name: "Media Alternative (Prerecorded)", level: "AAA" },
  { id: "1.2.9", name: "Audio-only (Live)", level: "AAA" },
  { id: "1.3.6", name: "Identify Purpose", level: "AAA" },
  { id: "1.4.6", name: "Contrast (Enhanced)", level: "AAA" },
  { id: "1.4.7", name: "Low or No Background Audio", level: "AAA" },
  { id: "1.4.8", name: "Visual Presentation", level: "AAA" },
  { id: "1.4.9", name: "Images of Text (No Exception)", level: "AAA" },
  { id: "2.1.3", name: "Keyboard (No Exception)", level: "AAA" },
  { id: "2.2.3", name: "No Timing", level: "AAA" },
  { id: "2.2.4", name: "Interruptions", level: "AAA" },
  { id: "2.2.5", name: "Re-authenticating", level: "AAA" },
  { id: "2.2.6", name: "Timeouts", level: "AAA" },
  { id: "2.3.2", name: "Three Flashes", level: "AAA" },
  { id: "2.3.3", name: "Animation from Interactions", level: "AAA" },
  { id: "2.4.8", name: "Location", level: "AAA" },
  { id: "2.4.9", name: "Link Purpose (Link Only)", level: "AAA" },
  { id: "2.4.10", name: "Section Headings", level: "AAA" },
  { id: "2.4.12", name: "Focus Not Obscured (Enhanced)", level: "AAA" }, // new in 2.2
  { id: "2.4.13", name: "Focus Appearance", level: "AAA" }, // new in 2.2
  { id: "2.5.5", name: "Target Size (Enhanced)", level: "AAA" },
  { id: "2.5.6", name: "Concurrent Input Mechanisms", level: "AAA" },
  { id: "3.1.3", name: "Unusual Words", level: "AAA" },
  { id: "3.1.4", name: "Abbreviations", level: "AAA" },
  { id: "3.1.5", name: "Reading Level", level: "AAA" },
  { id: "3.1.6", name: "Pronunciation", level: "AAA" },
  { id: "3.2.5", name: "Change on Request", level: "AAA" },
  { id: "3.3.5", name: "Help", level: "AAA" },
  { id: "3.3.6", name: "Error Prevention (All)", level: "AAA" },
  { id: "3.3.9", name: "Accessible Authentication (Enhanced)", level: "AAA" }, // new in 2.2
];

// Content-type exceptions (the three honest "not applicable" rows)
const EXCEPTIONS: Record<string, { exception: string; notes: string }> = {
  "1.2.1": {
    exception: "no-audio-or-video-content",
    notes: "Falsafa is a text-only reading platform. No audio or video content is published.",
  },
  "1.2.2": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.3": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.4": { exception: "no-audio-or-video-content", notes: "No live media." },
  "1.2.5": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.6": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.7": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.8": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.9": { exception: "no-audio-or-video-content", notes: "No live media." },
  "1.4.2": { exception: "no-audio-or-video-content", notes: "No auto-playing audio." },
  "1.4.7": { exception: "no-audio-or-video-content", notes: "No audio." },
  "2.2.5": { exception: "no-authentication", notes: "Site has no authentication of any kind." },
  "3.3.7": { exception: "no-authentication", notes: "No re-entry forms; site is read-only." },
  "3.3.8": { exception: "no-authentication", notes: "No authentication." },
  "3.3.9": { exception: "no-authentication", notes: "No authentication." },
  "3.1.3": {
    exception: "content-type",
    notes: `Falsafa publishes primary-source philosophy across six languages.
The corpus is built on technical and unusual vocabulary; identifying every
term is contrary to the project's editorial purpose. Partial mitigation
planned in V2 via glossary popovers (read_wiki).`,
  },
  "3.1.5": {
    exception: "content-type",
    notes: `Falsafa publishes graduate-level primary-source philosophy across
six languages. Lowering reading level would require rewriting the corpus
and is contrary to the project's editorial purpose. Mitigations: chapter
summaries via read_wiki MCP tool; cross-tradition links via TF-IDF.`,
  },
  "3.1.6": {
    exception: "content-type",
    notes: `Pronunciation aids for non-English terms across six languages
(Urdu, Sanskrit, Old English, French, German, Old Javanese) would require
pronunciation curation per term per language — content work explicitly
deferred. IPA inline annotations may land in V2 or V3.`,
  },
};

function renderCriterion(sc: { id: string; name: string; level: Level }): string {
  const exc = EXCEPTIONS[sc.id];
  const lines: string[] = [];
  lines.push(`  - id: "${sc.id}"`);
  lines.push(`    name: ${sc.name}`);
  lines.push(`    level: ${sc.level}`);
  if (exc) {
    lines.push(`    status: not-applicable`);
    lines.push(`    exception: ${exc.exception}`);
    lines.push(`    notes: >`);
    for (const ln of exc.notes.split("\n")) lines.push(`      ${ln.trim()}`);
  } else {
    lines.push(`    status: does-not-support`);
    lines.push(`    notes: "TBD V1"`);
  }
  lines.push(`    evidence: []`);
  lines.push(`    commit: 0000000`);
  return lines.join("\n");
}

const HEADER = `# Falsafa accessibility conformance — single source of truth.
# Generated VPAT 2.5 INT + EN 301 549 Annex F + on-site matrix all read this file.
# Seed bootstrapped by scripts/seed-wcag22.ts; hand-edit thereafter.
# Spec: docs/superpowers/specs/2026-05-14-accessibility-design.md

meta:
  standard: WCAG 2.2
  conformance_level: AA
  partial_aaa: true
  last_review: "2026-05-14"
  next_review: "2026-08-14"
  contact: accessibility@thothica.com
  vpat_version: "2.5 INT"
  jurisdictions: [india, eu, us]

# WCAG 2.2 — 86 success criteria (30 A + 25 AA + 31 AAA)
criteria:
`;

const SECTION_508 = `
# Section 508 functional performance criteria (Rev. 2017)
section_508:
  - id: "302.1"
    name: Without Vision
    status: does-not-support
    notes: "TBD V1 — proved by VoiceOver + NVDA audio recordings"
    evidence: []
  - id: "302.2"
    name: With Limited Vision
    status: does-not-support
    notes: "TBD V1"
    evidence: []
  - id: "302.3"
    name: Without Perception of Color
    status: does-not-support
    notes: "TBD V1"
    evidence: []
  - id: "302.4"
    name: Without Hearing
    status: supports
    notes: No audio content is published. Site is fully usable without hearing.
    evidence: []
  - id: "302.5"
    name: With Limited Hearing
    status: supports
    notes: No audio content is published.
    evidence: []
  - id: "302.6"
    name: Without Speech
    status: supports
    notes: No speech-input or speech-output requirements.
    evidence: []
  - id: "302.7"
    name: With Limited Manipulation
    status: does-not-support
    notes: "TBD V1 — proved by keyboard-only Playwright journeys"
    evidence: []
  - id: "302.8"
    name: With Limited Reach and Strength
    status: does-not-support
    notes: "TBD V1"
    evidence: []
  - id: "302.9"
    name: With Limited Language, Cognitive, and Learning Abilities
    status: partial
    notes: >
      Falsafa publishes graduate-level primary-source philosophy. Reading
      level is content-type-fixed (WCAG 3.1.5 exception). Mitigations
      include chapter summaries via the read_wiki MCP tool.
    evidence: []
`;

const EN_301_549 = `
# EN 301 549 v3.2.1 additional requirements (clauses 5-13)
en_301_549:
  - clause: "5.2"
    name: Activation of accessibility features
    status: does-not-support
    notes: "TBD V1 — system-preference auto-detection (Chunk 2 B.5)"
    evidence: []
  - clause: "5.3"
    name: Biometrics
    status: not-applicable
    notes: No biometric authentication. Site has no authentication of any kind.
    evidence: []
  - clause: "5.4"
    name: Preservation of accessibility information during conversion
    status: not-applicable
    notes: Site does not perform document-to-document conversion.
    evidence: []
  - clause: "9"
    name: "Web (refers to WCAG 2.1)"
    status: does-not-support
    notes: "TBD V1 — superset claim via WCAG 2.2 AA"
    evidence: []
  - clause: "11"
    name: Software (non-web)
    status: not-applicable
    notes: Falsafa is a web product. The MCP package is covered separately if/when its UI grows.
    evidence: []
  - clause: "12.1"
    name: Product documentation
    status: does-not-support
    notes: "TBD V1 — README + /accessibility page satisfy this"
    evidence: []
  - clause: "12.2"
    name: Support services
    status: supports
    notes: Accessibility issues may be reported via mailto:accessibility@thothica.com or GitHub issue.
    evidence: []
`;

const body = SCS.map(renderCriterion).join("\n\n");
const out = HEADER + body + "\n" + SECTION_508 + EN_301_549;
writeFileSync("docs/accessibility/conformance.yaml", out);
console.log(`Seeded ${SCS.length} WCAG 2.2 SCs + 9 Section 508 + 7 EN 301 549 entries.`);
```

- [ ] **Step 1b: Ensure target directory exists**

Run: `mkdir -p docs/accessibility/manual-tests`
Expected: directory exists; no output.

- [ ] **Step 2: Run the seed script**

Run: `bun run scripts/seed-wcag22.ts`
Expected: `docs/accessibility/conformance.yaml` is created; stdout reads `Seeded 86 WCAG 2.2 SCs + 9 Section 508 + 7 EN 301 549 entries.`

- [ ] **Step 3: Run the verifier against the seeded file**

Run: `bun run a11y:verify`
Expected: PASS. All evidence arrays are empty, so there are no refs to verify; the schema validation passes. Output: `Conformance YAML verification PASSED (86 criteria, 9 508, 7 EN 301 549 checked).`

- [ ] **Step 4: Commit**

```bash
git add docs/accessibility/conformance.yaml
git commit -m "feat(a11y): seed conformance.yaml with 86 WCAG 2.2 SCs + 508 + EN 301 549"
```

### Task 8: Create `docs/accessibility/README.md` + JAWS log seed

**Files:**
- Create: `docs/accessibility/README.md`
- Create: `docs/accessibility/manual-tests/jaws-log.yaml`

- [ ] **Step 1: Create README.md**

```markdown
# Falsafa Accessibility

This directory is the canonical accessibility artifact set for Falsafa.

## Files

- **`conformance.yaml`** — single source of truth for WCAG 2.2 SCs +
  Section 508 + EN 301 549. Hand-edited; every claim has at least one
  evidence ref. CI gates new claims.
- **`vpat-v1.0.{html,pdf}`** — generated VPAT 2.5 INT.
  Run `bun a11y:generate vpat` to regenerate.
- **`statement-en301549.{html,pdf}`** — generated EN 301 549 Annex F
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
```

- [ ] **Step 2: Create jaws-log.yaml**

```yaml
# JAWS manual verification log
# JAWS automation is not in scope; verification happens before each major
# government customer demo. Append a new entry per session.
sessions: []
```

- [ ] **Step 3: Commit**

```bash
git add docs/accessibility/
git commit -m "docs(a11y): README + initial JAWS log seed"
```

### Task 9: Chunk 1 sanity check

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: All tests pass (existing tests + new types/parse/verify tests).

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No type errors.

- [ ] **Step 3: Run the verifier**

Run: `bun run a11y:verify`
Expected: `Conformance YAML verification PASSED (86 criteria, 9 508, 7 EN 301 549 checked).`

- [ ] **Step 4: Confirm Chunk 1 deliverables**

Check:
- [ ] `apps/a11y-tools/` exists with package.json + tsconfig + src/
- [ ] `apps/a11y-tools/src/types.ts` + `parse.ts` + `verify.ts` all present
- [ ] `docs/accessibility/conformance.yaml` has 86 + 9 + 7 entries
- [ ] `package.json` has all `a11y:*` scripts
- [ ] `.gitignore` includes `.superpowers/`
- [ ] All Chunk 1 commits land on the working branch

**Chunk 1 complete. Proceed to Chunk 2 only after the verifier passes and all tests are green.**

---

## Chunk 2: AA blocker fixes + RTL + system-pref CSS

**Why second:** Chunk 1's verifier is the regression gate; the conformance YAML is the source of truth. Chunk 2 lands the three AA blocker fixes (plus RTL and system-pref CSS), and each fix adds its own evidence row to `conformance.yaml` so the verifier proves the claim holds.

**Deliverables (Chunk 2):**
- `--rule` and `--accent-soft` token contrast fixes (B.3)
- Contrast token audit script (regression gate) + tests
- `prefers-color-scheme` / `prefers-contrast` / `forced-colors` media queries (B.5)
- `bcp47Of()` + `isRtl()` helpers in `corpus.ts` + tests
- `works.json` augmented with `script` field per variant where needed (B.1 data layer)
- `lang` + `dir` emission on the variant reader page (B.1 render layer)
- Foreign-term `<span lang="…">` wrapping on `/about` (B.1)
- RTL CSS overrides (B.2)
- SearchDialog combobox restructure (B.4 markup) + restored native clear button
- `conformance.yaml` evidence added for: 1.4.3, 1.4.11, 2.1.1, 2.3.3, 3.1.1, 3.1.2, 4.1.2, 4.1.3, plus EN 5.2 (1.3.1 lands in Chunk 4 with the synthetic-transcript journeys)

**End-state proof after Chunk 2:**
- `bun run a11y:contrast` exits 0 (every UI pair ≥ 3:1, text pair ≥ 4.5:1, large-text ≥ 3:1)
- `bun run a11y:verify` exits 0 with new evidence refs resolving
- `bun test` passes including the new contrast + bcp47 + verify tests
- Manual smoke: visit a chapter variant page in Urdu original — `<article lang="ur-Arab" dir="rtl">` appears in DOM; visit `/about` — Manusmṛti is wrapped in `<span lang="sa-Latn">`

### Task 10: Contrast token audit script (B.3 regression gate)

**Files:**
- Create: `scripts/a11y-contrast-audit.ts`
- Create: `scripts/__tests__/a11y-contrast-audit.test.ts`

The audit script reads `apps/site/src/styles/tokens.css`, extracts every theme's token values (light, dark, sepia), enumerates the UI pairs that must meet WCAG ratios, computes the ratio for each, and writes a JSON report to `docs/accessibility/test-runs/contrast/<timestamp>/result.json`. Exits non-zero if any pair fails.

- [ ] **Step 1: Write the failing test (TDD with @superpowers:test-driven-development)**

```ts
// scripts/__tests__/a11y-contrast-audit.test.ts
import { describe, expect, it } from "bun:test";
import { contrastRatio, parseTokens, auditPairs } from "../a11y-contrast-audit";

describe("contrastRatio", () => {
  it("black on white = 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
  it("white on white = 1:1", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 1);
  });
  it("hex parsing handles short form", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 0);
  });
});

describe("parseTokens", () => {
  it("extracts vars from :root", () => {
    const css = `:root {\n  --paper: #faf6ee;\n  --ink: #1b1612;\n}\n`;
    const out = parseTokens(css);
    expect(out.light["--paper"]).toBe("#faf6ee");
    expect(out.light["--ink"]).toBe("#1b1612");
  });
  it("extracts vars from [data-theme='dark']", () => {
    const css = `:root { --paper: #fff; }\n[data-theme="dark"] {\n  --paper: #000;\n}`;
    const out = parseTokens(css);
    expect(out.light["--paper"]).toBe("#fff");
    expect(out.dark["--paper"]).toBe("#000");
  });
});

describe("auditPairs", () => {
  it("flags a UI pair below 3:1", () => {
    const tokens = { light: { "--paper": "#faf6ee", "--rule": "#e8e0d2" } };
    const result = auditPairs(tokens);
    const fail = result.failures.find(
      (f) => f.theme === "light" && f.fg === "--rule" && f.bg === "--paper",
    );
    expect(fail).toBeDefined();
    expect(fail!.ratio).toBeLessThan(3);
  });
  it("passes when ratios meet minimum", () => {
    const tokens = { light: { "--paper": "#ffffff", "--ink": "#000000", "--rule": "#999999" } };
    const result = auditPairs(tokens);
    expect(result.failures).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/__tests__/a11y-contrast-audit.test.ts`
Expected: FAIL. Bun reports `Cannot find module '../a11y-contrast-audit'`.

- [ ] **Step 3: Implement the audit script**

```ts
#!/usr/bin/env bun
// scripts/a11y-contrast-audit.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type ThemeTokens = Record<string, string>;
type ParsedTokens = { light: ThemeTokens; dark?: ThemeTokens; sepia?: ThemeTokens };

interface Pair {
  fg: string;
  bg: string;
  kind: "text" | "large-text" | "ui";
  /** Minimum required ratio (WCAG 1.4.3 / 1.4.11). */
  min: number;
}

// UI pairs that must meet WCAG ratios. Adjust as token usage evolves.
const PAIRS: Pair[] = [
  { fg: "--ink", bg: "--paper", kind: "text", min: 4.5 },
  { fg: "--ink-muted", bg: "--paper", kind: "text", min: 4.5 },
  { fg: "--accent", bg: "--paper", kind: "text", min: 4.5 },
  { fg: "--accent-soft", bg: "--paper", kind: "text", min: 4.5 }, // hover state
  { fg: "--rule", bg: "--paper", kind: "ui", min: 3 },
];

export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(parseHex(a));
  const lb = relLuminance(parseHex(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) throw new Error(`bad hex: ${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function parseTokens(css: string): ParsedTokens {
  const blocks = {
    light: extractBlock(css, /:root\s*\{([\s\S]*?)\}/),
    dark: extractBlock(css, /\[data-theme=["']dark["']\]\s*\{([\s\S]*?)\}/),
    sepia: extractBlock(css, /\[data-theme=["']sepia["']\]\s*\{([\s\S]*?)\}/),
  };
  return blocks as ParsedTokens;
}

function extractBlock(css: string, re: RegExp): ThemeTokens | undefined {
  const m = css.match(re);
  if (!m) return undefined;
  const out: ThemeTokens = {};
  for (const line of m[1]!.split("\n")) {
    const v = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
    if (v) out[v[1]!] = v[2]!.trim().replace(/\s*\/\*.*$/, "");
  }
  return out;
}

interface Failure { theme: string; fg: string; bg: string; ratio: number; min: number; kind: string; }
interface AuditResult { passed: number; failures: Failure[]; }

export function auditPairs(tokens: ParsedTokens): AuditResult {
  const failures: Failure[] = [];
  let passed = 0;
  for (const themeName of Object.keys(tokens) as Array<keyof ParsedTokens>) {
    const t = tokens[themeName];
    if (!t) continue;
    for (const p of PAIRS) {
      const fg = t[p.fg];
      const bg = t[p.bg];
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio < p.min) {
        failures.push({ theme: themeName, fg: p.fg, bg: p.bg, ratio, min: p.min, kind: p.kind });
      } else {
        passed++;
      }
    }
  }
  return { passed, failures };
}

async function main(): Promise<void> {
  const css = readFileSync("apps/site/src/styles/tokens.css", "utf8");
  const tokens = parseTokens(css);
  const result = auditPairs(tokens);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(`docs/accessibility/test-runs/contrast/${ts}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "result.json"), JSON.stringify(result, null, 2));
  // Also write a "latest" symlink-equivalent for the page to read
  const latestDir = resolve("docs/accessibility/test-runs/contrast/latest");
  mkdirSync(latestDir, { recursive: true });
  writeFileSync(resolve(latestDir, "result.json"), JSON.stringify(result, null, 2));

  if (result.failures.length > 0) {
    console.error(`Contrast audit FAILED. ${result.failures.length} failures, ${result.passed} passing:`);
    for (const f of result.failures) {
      console.error(`  [${f.theme}] ${f.fg} on ${f.bg} = ${f.ratio.toFixed(2)}:1 (need ${f.min}:1 ${f.kind})`);
    }
    process.exit(1);
  }
  console.log(`Contrast audit PASSED. ${result.passed} pairs verified.`);
}

if (import.meta.main) await main();
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `bun test scripts/__tests__/a11y-contrast-audit.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 5: Run the audit against the current tokens.css (intentional fail)**

Run: `bun run a11y:contrast`
Expected: FAIL with at least one line: `[light] --rule on --paper = 1.22:1 (need 3:1 ui)`. May also flag `--accent-soft on --paper` (2.52:1). This *is the bug we're about to fix in Task 11*. Capture the failure output for the commit message.

- [ ] **Step 6: Commit**

```bash
git add scripts/a11y-contrast-audit.ts scripts/__tests__/a11y-contrast-audit.test.ts
git commit -m "feat(a11y): contrast token audit script (regression gate)"
```

### Task 11: Fix `--rule` and `--accent-soft` contrast (B.3)

**Files:**
- Modify: `apps/site/src/styles/tokens.css`
- Modify: `docs/accessibility/conformance.yaml` (add evidence for 1.4.11)

- [ ] **Step 1: Update all three themes' tokens (pre-measured)**

Pre-measured values (verified by the contrast formula in Task 10):

| Theme | Token | Old → New | Ratio after |
|---|---|---|---|
| Light | `--rule` | `#e8e0d2` → **`#8c7860`** | 3.92:1 (UI ≥ 3:1 ✓) |
| Light | `--accent-soft` | `#c8907a` → **`#6b2c22`** | 9.70:1 (text ≥ 4.5:1 ✓) |
| Dark | `--rule` | `#2e2823` → **`#8c7e62`** | 4.43:1 (UI ≥ 3:1 ✓) |
| Dark | `--accent-soft` | `#8a3a2e` → **`#d97a6a`** | 5.83:1 (text ≥ 4.5:1 ✓) |
| Sepia | `--rule` | `#d8c8a8` → **`#8a7e60`** | 3.26:1 (UI ≥ 3:1 ✓) |
| Sepia | `--accent-soft` | `#a06a4a` → **`#5a3018`** | 9.13:1 (text ≥ 4.5:1 ✓) |

Edit `apps/site/src/styles/tokens.css`:

```diff
   :root {
     ...
-    --accent-soft: #c8907a; /* hover, soft highlights */
+    --accent-soft: #6b2c22; /* link hover — WCAG 1.4.3 ≥ 4.5:1 against --paper */
-    --rule: #e8e0d2;        /* dividers, borders */
+    --rule: #8c7860;        /* dividers, borders — WCAG 1.4.11 ≥ 3:1 against --paper */
     ...
   }

   [data-theme="dark"] {
     ...
-    --accent-soft: #8a3a2e;
+    --accent-soft: #d97a6a;
-    --rule: #2e2823;
+    --rule: #8c7e62;
     ...
   }

   [data-theme="sepia"] {
     ...
-    --accent-soft: #a06a4a;
+    --accent-soft: #5a3018;
-    --rule: #d8c8a8;
+    --rule: #8a7e60;
     ...
   }
```

- [ ] **Step 2: (intentionally empty — all theme measurements moved into Step 1)**

- [ ] **Step 3: Re-run the audit (expect pass)**

Run: `bun run a11y:contrast`
Expected: `Contrast audit PASSED. N pairs verified.` (N ≥ 5 for light theme; up to 15 if dark + sepia have all tokens defined).

- [ ] **Step 4: Add evidence to conformance.yaml for WCAG 1.4.11**

Find the `1.4.11` entry in `docs/accessibility/conformance.yaml` and edit:

```yaml
  - id: "1.4.11"
    name: Non-text Contrast
    level: AA
    status: supports
    notes: >
      Every UI token pair (--rule, --accent-soft variants) measured ≥ 3:1
      against its theme's paper background. Audit runs via
      `bun run a11y:contrast` in CI; non-text-contrast failures fail the build.
    evidence:
      - kind: source
        path: apps/site/src/styles/tokens.css
        anchor: "--rule"
      - kind: source
        path: apps/site/src/styles/tokens.css
        anchor: "--accent-soft"
      - kind: test
        path: scripts/__tests__/a11y-contrast-audit.test.ts
        lines: "1-50"
      - kind: artifact
        path: docs/accessibility/test-runs/contrast/latest/result.json
    commit: HEAD
```

Also update `1.4.3` (Contrast Minimum) — find its entry in the same file and replace with:

```yaml
  - id: "1.4.3"
    name: Contrast (Minimum)
    level: AA
    status: supports
    notes: >
      Body text contrast: light 16.7:1, dark 14.8:1, sepia 11:1 — all
      exceed WCAG 1.4.3 4.5:1 minimum and also pass the AAA 7:1 ceiling.
      The accent-soft link-hover color is now darker (≥ 4.5:1 in all themes).
    evidence:
      - kind: source
        path: apps/site/src/styles/tokens.css
        anchor: "--ink"
      - kind: source
        path: apps/site/src/styles/tokens.css
        anchor: "--accent-soft"
      - kind: test
        path: scripts/__tests__/a11y-contrast-audit.test.ts
        lines: "1-50"
      - kind: artifact
        path: docs/accessibility/test-runs/contrast/latest/result.json
    commit: HEAD
```

- [ ] **Step 5: Verify**

Run: `bun run a11y:verify`
Expected: `Conformance YAML verification PASSED`. (The `commit: HEAD` is a placeholder; the verifier accepts any 7-40 hex chars or `HEAD`; it will be rewritten to the actual SHA by the commit-results CI job.)

- [ ] **Step 6: Visual smoke test (manual)**

Run `bun run --cwd apps/site dev`. Open http://localhost:4321/. Check that:
- Dividers and rules between sections are visible without looking heavy
- Link hover state is visibly darker, not lighter
- Repeat checks under `data-theme="dark"` (devtools: `document.documentElement.dataset.theme = "dark"`) and `data-theme="sepia"`

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/styles/tokens.css docs/accessibility/conformance.yaml
git commit -m "fix(a11y): bump --rule and --accent-soft contrast to WCAG 1.4.11"
```

### Task 12: System-preference CSS (B.5)

**Files:**
- Modify: `apps/site/src/styles/tokens.css` (append after existing `prefers-reduced-motion` block)
- Modify: `docs/accessibility/conformance.yaml` (evidence for EN 5.2; mention in 1.4.3 / 1.4.11 notes)

- [ ] **Step 1: Append the system-pref media queries**

Append to `apps/site/src/styles/tokens.css` after the existing `prefers-reduced-motion` block (line ~121):

```css
/* B.5: system-preference auto-detect.
   Honors OS-level accessibility settings so disabled users get the right
   experience on first load with zero UI interaction. Explicit user
   overrides via the chrome `Aa` picker (V2) take precedence — they set
   `[data-theme=...]` on `<html>` which beats the media query. */

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    /* Auto-apply dark theme tokens at :root level when user prefers dark
       and has not explicitly chosen a theme via the picker (V2). */
    color-scheme: dark;
    /* Token values copied from [data-theme="dark"] for atomic application */
    --paper: #1c1814;
    --ink: #f4ece0;
    --ink-muted: #cfc0a8;
    --accent: #d9836e;
    --accent-soft: #d97a6a; /* matches the Task 11 dark fix */
    --rule: #8c7e62;        /* matches the Task 11 dark fix */
  }
}

@media (prefers-contrast: more) {
  :root:not([data-theme="sepia"]) {
    /* Higher-contrast variants. Sepia is treated as user-explicit and
       NOT overridden here — a reader who chose sepia accepted its profile. */
    --ink: light-dark(#000000, #ffffff);
    --ink-muted: light-dark(#1b1612, #f4ece0);
  }
}

@media (forced-colors: active) {
  /* Windows High Contrast Mode. Fall back to system colors so the OS
     scheme wins. Site borders + text use semantic system color keywords. */
  :root {
    --paper: Canvas;
    --ink: CanvasText;
    --ink-muted: GrayText;
    --accent: LinkText;
    --accent-soft: VisitedText;
    --rule: ButtonText;
  }
}
```

- [ ] **Step 2: Re-run contrast audit (must still pass)**

Run: `bun run a11y:contrast`
Expected: PASS. (The new media queries don't change the default-state tokens; they apply only when the OS preference is set.)

- [ ] **Step 3: Add evidence to conformance.yaml**

In `docs/accessibility/conformance.yaml`:

- Update `en_301_549` clause `5.2`:

```yaml
  - clause: "5.2"
    name: Activation of accessibility features
    status: supports
    notes: >
      System preferences (prefers-color-scheme, prefers-contrast,
      prefers-reduced-motion, forced-colors) are honored without UI
      interaction. Disabled users get a correctly-themed first load.
    evidence:
      - kind: source
        path: apps/site/src/styles/tokens.css
        anchor: "prefers-color-scheme"
      - kind: source
        path: apps/site/src/styles/tokens.css
        anchor: "prefers-contrast"
      - kind: source
        path: apps/site/src/styles/tokens.css
        anchor: "forced-colors"
      - kind: artifact
        path: docs/accessibility/test-runs/theme-prefs/latest/transcript-synthetic.md
```

- Update WCAG `2.3.3` (Animation from Interactions, AAA) to `supports` with evidence pointing at the existing `prefers-reduced-motion` block.

- [ ] **Step 4: Verify**

Run: `bun run a11y:verify`
Expected: PASS (artifact ref won't exist yet but the verifier skips artifact kind — confirmed by Chunk 1 Task 6).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/styles/tokens.css docs/accessibility/conformance.yaml
git commit -m "feat(a11y): honor prefers-color-scheme, prefers-contrast, forced-colors"
```

### Task 13: `bcp47Of()` + `isRtl()` helpers in corpus.ts (B.1 foundation)

**Files:**
- Modify: `apps/site/src/lib/corpus.ts` (add two helpers)
- Create: `apps/site/src/lib/__tests__/corpus-bcp47.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/site/src/lib/__tests__/corpus-bcp47.test.ts
import { describe, expect, it } from "bun:test";
import { bcp47Of, isRtl } from "../corpus";

describe("bcp47Of", () => {
  it("returns base language for English translation", () => {
    expect(bcp47Of({ language: "en", script: undefined })).toBe("en");
  });
  it("returns language-script for Urdu original (Arabic script)", () => {
    expect(bcp47Of({ language: "ur", script: "Arab" })).toBe("ur-Arab");
  });
  it("returns language-script for Sanskrit transliteration (Latin)", () => {
    expect(bcp47Of({ language: "sa", script: "Latn" })).toBe("sa-Latn");
  });
  it("returns language-script for Sanskrit devanagari", () => {
    expect(bcp47Of({ language: "sa", script: "Deva" })).toBe("sa-Deva");
  });
  it("normalizes language to lowercase, script to title case", () => {
    expect(bcp47Of({ language: "UR", script: "ARAB" })).toBe("ur-Arab");
  });
});

describe("isRtl", () => {
  it("identifies Urdu-Arabic as RTL", () => {
    expect(isRtl("ur-Arab")).toBe(true);
  });
  it("identifies Arabic as RTL", () => {
    expect(isRtl("ar")).toBe(true);
  });
  it("identifies Hebrew as RTL", () => {
    expect(isRtl("he")).toBe(true);
  });
  it("identifies English as LTR", () => {
    expect(isRtl("en")).toBe(false);
  });
  it("identifies Urdu-Latn as LTR", () => {
    expect(isRtl("ur-Latn")).toBe(false);
  });
  it("identifies Sanskrit-Deva as LTR", () => {
    expect(isRtl("sa-Deva")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/site/src/lib/__tests__/corpus-bcp47.test.ts`
Expected: FAIL. `bcp47Of` and `isRtl` are not exported from `../corpus`.

- [ ] **Step 3: Implement the helpers**

Append to `apps/site/src/lib/corpus.ts`:

```ts
// B.1: BCP-47 derivation for WCAG 3.1.1 / 3.1.2 lang attribute emission.
// A variant carries { language, script? }. The combination yields a BCP-47
// tag the screen reader interprets to switch voice/phonemes.

export interface VariantLanguageMeta {
  language: string;
  script?: string;
}

export function bcp47Of(meta: VariantLanguageMeta): string {
  const lang = (meta.language || "").trim().toLowerCase();
  if (!lang) return "en"; // last-ditch fallback; works.json must always carry language
  if (!meta.script) return lang;
  const script = meta.script.trim();
  const titled = script[0]!.toUpperCase() + script.slice(1).toLowerCase();
  return `${lang}-${titled}`;
}

// RTL detection. Driven by the script subtag, not the language alone (Urdu
// can be Latn-transliterated, Arabic can be Latn for some Maghrebi dialects).
// Falls back to language-only for the canonical RTL languages where no script
// subtag is needed.
const RTL_SCRIPTS = new Set(["Arab", "Hebr", "Syrc", "Thaa", "Nkoo"]);
const RTL_LANGS_NO_SCRIPT = new Set(["ar", "he", "fa", "ur", "yi"]);

export function isRtl(bcp47: string): boolean {
  const [lang, script] = bcp47.split("-");
  if (script) return RTL_SCRIPTS.has(script);
  return RTL_LANGS_NO_SCRIPT.has(lang!.toLowerCase());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/site/src/lib/__tests__/corpus-bcp47.test.ts`
Expected: PASS, all 11 cases.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/corpus.ts apps/site/src/lib/__tests__/corpus-bcp47.test.ts
git commit -m "feat(a11y): bcp47Of() + isRtl() helpers for lang attribute emission"
```

### Task 14: Add `script` field to non-English variants in works.json (B.1 data)

**Files:**
- Modify: `works.json` (touch ~38 variant entries)

The data layer change. Only variants whose `content_type` is `original` or `transliteration` need a `script` field; `translation` variants stay English without script.

- [ ] **Step 1: Survey which variants need scripts**

Run:

```bash
bun -e "
const w = await Bun.file('works.json').json();
const seen = new Set();
const out = [];
for (const work of w.works) {
  for (const chapter of work.chapters ?? []) {
    for (const v of chapter.variants ?? []) {
      if (v.content_type === 'original' || v.content_type === 'transliteration') {
        const key = work.slug + '|' + v.content_type;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ work: work.slug, lang: work.language, type: v.content_type });
        }
      }
    }
  }
}
console.table(out);
"
```

Expected: a deduplicated table listing each work × non-English variant type. Use this as the worklist for Step 2. (The set-based dedup avoids one row per chapter.)

- [ ] **Step 2: Add `script` field per work/variant**

Decision matrix:

| Work language | Original `script` | Transliteration `script` |
|---|---|---|
| English (`en`) | n/a (no original) | n/a |
| Urdu (`ur`) | `Arab` | `Latn` |
| Sanskrit (`sa`) | `Deva` (Manusmṛti, Naradasmṛti, etc.) | `Latn` (IAST) |
| Old English (`ang`) | `Latn` | n/a (already Latin) |
| French (`fr`) | `Latn` | n/a |
| German (`de`) | `Latn` | n/a |
| Old Javanese (`kaw`) | `Latn` (Romanized) | n/a |

Edit `works.json` directly. For every variant where the table prescribes a script, add `"script": "..."` adjacent to the existing `"content_type"` field. Example:

```diff
   "variants": [
     {
       "content_type": "original",
+      "script": "Arab",
       "source": "..."
     },
     {
       "content_type": "transliteration",
+      "script": "Latn",
       "source": "..."
     }
   ]
```

**Implementer time-budget:** ~15-20 minutes for ~38 variants. Use editor multi-cursor or a small `bun` script if preferred.

- [ ] **Step 3: Verify the data shape**

Run:

```bash
bun -e "
const w = await Bun.file('works.json').json();
let missing = 0;
for (const work of w.works) {
  for (const chapter of work.chapters ?? []) {
    for (const v of chapter.variants ?? []) {
      if ((v.content_type === 'original' || v.content_type === 'transliteration')
          && work.language !== 'en' && !v.script) {
        console.log('missing script:', work.slug, v.content_type);
        missing++;
      }
    }
  }
}
console.log('missing total:', missing);
"
```

Expected: `missing total: 0`.

- [ ] **Step 4: Commit**

```bash
git add works.json
git commit -m "data(a11y): add script field to non-English variants for BCP-47 derivation"
```

### Task 15: Emit `lang` + `dir` on the variant reader page (B.1 + B.2 render)

**Files:**
- Modify: `apps/site/src/pages/works/[slug]/[chapter]/[variant].astro`
- Modify: `apps/site/src/lib/corpus.ts` (extend `readChapterVariant` return type)

- [ ] **Step 1: Confirm the variant return shape carries script**

Run: `grep -n "script\|content_type" apps/site/src/lib/corpus.ts | head -20`

Two possible outcomes:
- **(a) `script` is already part of the variant return** (it flows through via spread from works.json): no code change here — go to Step 2.
- **(b) `script` is dropped between works.json and the variant return**: extend `readChapterVariant`'s return type to include `script?: string` and pass it through. Concrete diff:

  ```diff
   export interface ChapterVariant {
     meta: ChapterMeta;
     body: string;
  +  script?: string;   // BCP-47 script subtag from works.json
   }
   ...
   return {
     meta: { ... },
     body: ...,
  +  script: variant.script,
   };
  ```

  Determine which case applies by reading the function; the diff is ≤10 lines either way.

- [ ] **Step 2: Locate the article element + verify the diff anchor**

Run: `grep -n "<article" apps/site/src/pages/works/\\[slug\\]/\\[chapter\\]/\\[variant\\].astro`

Expected output: one line, the `<article>` opening tag. Note the existing attributes (likely `class="reader-body" data-layout={variant.meta.layout}` or similar).

Apply this diff — adjust the surrounding existing attributes to match what `grep` shows:

```diff
-import { readChapterVariant, type ContentType } from "../../../../lib/corpus";
+import { readChapterVariant, bcp47Of, isRtl, type ContentType } from "../../../../lib/corpus";
 ...
 const variant = readChapterVariant(workSlug, chapterSlug, variantType as ContentType);
+const bcp47 = bcp47Of({ language: work.language, script: variant.script });
+const dir = isRtl(bcp47) ? "rtl" : "ltr";
 ...
-<article class="reader-body" data-layout={variant.meta.layout}>
+<article class="reader-body" data-layout={variant.meta.layout} lang={bcp47} dir={dir}>
```

If the actual `<article>` opening differs from the `-` line above, preserve its existing attributes and only **add** `lang={bcp47} dir={dir}`.

- [ ] **Step 3: Manual smoke test**

Run `bun run --cwd apps/site dev`. Visit a Urdu chapter original (e.g. `/works/bang-i-dara/01/original/`). Open devtools → Elements panel → verify the `<article>` carries `lang="ur-Arab" dir="rtl"`. Repeat on a Sanskrit transliteration; verify `lang="sa-Latn" dir="ltr"`. On an English translation, the `<article>` should still get `lang="en"` (the same helper).

- [ ] **Step 4: Add evidence to conformance.yaml for WCAG 3.1.1 + 3.1.2**

Edit `docs/accessibility/conformance.yaml`:

```yaml
  - id: "3.1.1"
    name: Language of Page
    level: A
    status: supports
    notes: >
      The root <html> emits lang="en". Each variant article emits its own
      lang attribute via bcp47Of(), so screen readers switch voice when
      reading non-English variants.
    evidence:
      - kind: source
        path: apps/site/src/lib/corpus.ts
        anchor: "bcp47Of"
      - kind: source
        path: apps/site/src/layouts/Base.astro
        anchor: 'lang="en"'
    commit: HEAD

  - id: "3.1.2"
    name: Language of Parts
    level: AA
    status: supports
    notes: >
      Non-English chapter variants emit lang="<bcp47>" on their <article>
      wrapper. The /about page wraps foreign terms in <span lang="..."> as
      they appear in prose.
    evidence:
      - kind: source
        path: apps/site/src/pages/works/[slug]/[chapter]/[variant].astro
        anchor: "lang={bcp47}"
      - kind: source
        path: apps/site/src/pages/about.astro
        anchor: 'lang="sa-Latn"'
      - kind: test
        path: apps/site/src/lib/__tests__/corpus-bcp47.test.ts
        lines: "1-50"
      - kind: artifact
        path: docs/accessibility/test-runs/reader-original/latest/transcript-voiceover.md
    commit: HEAD
```

- [ ] **Step 5: Verify**

Run: `bun run a11y:verify`
Expected: PASS. (The `about.astro` anchor `lang="sa-Latn"` doesn't exist yet — that's Task 16's work. Task 16 must land before merge for the verifier to keep passing; if testing in isolation, comment out that anchor temporarily.)

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/works apps/site/src/lib/corpus.ts docs/accessibility/conformance.yaml
git commit -m "feat(a11y): emit lang + dir on chapter variant pages (WCAG 3.1.1 + 3.1.2)"
```

### Task 16: Wrap foreign terms on /about (B.1 continuation)

**Files:**
- Modify: `apps/site/src/pages/about.astro`

Audit `/about` for inline mentions of non-English terms. The full set is small (~50 instances). Wrap each in `<span lang="...">`.

- [ ] **Step 1: Identify the foreign terms (concrete enumeration)**

Run: `grep -nE "Manusmṛti|Bāng-i-Darā|Bṛhaspati|Nāradasmṛti|Aṅgirasa|Yājñavalkya|Diwan|Smṛti|dharma|ahimsa|Andreas|Elene|Juliana|Cynewulf|Iqbal|Ghalib|Zauq|Comte|Dunoyer|Fichte" apps/site/src/pages/about.astro`

This produces the authoritative list of foreign-term occurrences on the page. The diacritic-bearing tokens (Manusmṛti, Bāng-i-Darā, Bṛhaspati, Nāradasmṛti, Aṅgirasa, Yājñavalkya, Smṛti) are unambiguously transliterated foreign content; wrap each. The author-name tokens (Iqbal, Ghalib, Zauq, Cynewulf, Comte, Dunoyer, Fichte) are well-anglicized — wrap only where the surrounding typography (italic, em-tag) marks them as foreign-language emphasis; skip when used as plain author attribution in English prose.

Apply the mapping:

| Token group | Wrap as |
|---|---|
| Manusmṛti, Bāng-i-Darā, Bṛhaspati, Nāradasmṛti, Aṅgirasa, Yājñavalkya, Smṛti, Diwan, dharma, ahimsa | `<span lang="sa-Latn">…</span>` |
| Iqbal, Ghalib, Zauq (when italicized as foreign emphasis only) | `<span lang="ur-Latn">…</span>` |
| Andreas, Elene, Juliana, Cynewulf (when italicized as work titles only) | `<span lang="ang-Latn">…</span>` |

**Editorial guideline:** wrap only inline mentions where the typography signals foreignness (italics, callout). Plain English author-name mentions stay unwrapped — wrapping plain words makes the page noisy without benefit.

- [ ] **Step 2: Apply the wrappings**

For each identified term, edit the markup:

```diff
-The <em>Manusmṛti</em> is among the earliest Sanskrit law texts...
+The <em><span lang="sa-Latn">Manusmṛti</span></em> is among the earliest Sanskrit law texts...
```

- [ ] **Step 3: Verify the verifier passes (back to Task 15 deferred anchor)**

Run: `bun run a11y:verify`
Expected: PASS. The `lang="sa-Latn"` anchor in `conformance.yaml` now resolves to a real occurrence in `about.astro`.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/about.astro
git commit -m "feat(a11y): wrap foreign terms on /about with lang attribute"
```

### Task 17: RTL CSS overrides (B.2)

**Files:**
- Modify: `apps/site/src/styles/reader.css` (add `:dir(rtl)` overrides)

- [ ] **Step 1: Add RTL drop-cap inversion**

Append to `apps/site/src/styles/reader.css` (after the existing `::first-letter` block around line 222):

```css
/* B.2: RTL drop-cap inversion. Arabic-script variants float the drop cap
   to the right side of the column. */
.reader[data-layout="prose"]:dir(rtl) .reader-body > p:first-child::first-letter {
  float: right;
  margin: 0 0 0 0.5rem;
}

/* RTL source-citation positioning */
.source-citation:dir(rtl) {
  text-align: right;
}

/* RTL variant-switcher: keep pill order visually consistent (no flex-reverse
   needed; pills should read in source order in both directions). */
```

- [ ] **Step 2: Manual smoke test**

Run `bun run --cwd apps/site dev`. Visit a Urdu original chapter. Verify:
- Drop cap floats on the right side of the first paragraph
- Text reads right-to-left within paragraphs
- Variant switcher pills are still legible
- Source-citation block aligns right
- Reading-progress bar still anchors top-left (it's positioned chrome, unaffected by dir)

Screenshot for the PR description.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/styles/reader.css
git commit -m "feat(a11y): RTL drop-cap + source-citation alignment for Urdu variants"
```

### Task 18: Restore native search clear button (B.4 small fix)

**Files:**
- Modify: `apps/site/src/styles/global.css`

- [ ] **Step 1: Remove the `display: none` rule**

The actual selector at `apps/site/src/styles/global.css:461` is one-line:

```diff
-.search-input:-webkit-search-cancel-button { display: none; }
```

(Note the single-colon `:` on the pseudo-element — that's how the existing file is written. The pseudo-element technically requires `::` to be functional; the existing rule may already be a no-op. Either way, delete the line.)

If the implementer prefers a custom clear button instead, build one in the SearchDialog markup — but the native button is the cheaper option and is accessible by default.

- [ ] **Step 2: Manual smoke test**

Run dev, open search dialog, type a query. The native × clear button appears at the right edge of the input. Clicking it clears the query. Tab focus reaches it.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/styles/global.css
git commit -m "fix(a11y): restore native search clear button for keyboard users"
```

### Task 19: SearchDialog combobox restructure (B.4 main work)

**Files:**
- Modify: `apps/site/src/components/SearchDialog.astro` (markup + inline script)
- Modify: `docs/accessibility/conformance.yaml` (evidence for 4.1.3, 2.1.1, 4.1.2)

The big one. Restructure the input + results list as a WAI-ARIA Authoring Practices combobox-with-listbox.

- [ ] **Step 1: Update the input markup**

Find the `<input id="search-input" ...>` in `apps/site/src/components/SearchDialog.astro`. Replace with:

```astro
<input
  id="search-input"
  type="search"
  class="search-input"
  placeholder="Search translations  ⌘K"
  aria-describedby="search-help"
  spellcheck="false"
  autocapitalize="off"
  role="combobox"
  aria-expanded="false"
  aria-controls="search-results"
  aria-autocomplete="list"
  aria-activedescendant=""
/>
```

- [ ] **Step 2: Update the results list markup**

Find `<ol class="search-results" data-search-results></ol>` and replace with:

```astro
<ol id="search-results" class="search-results" role="listbox" data-search-results aria-label="Search results"></ol>
```

(The `id="search-results"` is the target of the input's `aria-controls`.)

- [ ] **Step 3: Locate the result-rendering function**

Run: `grep -n "querySelector\|appendChild\|createElement\|innerHTML\|resultsHost" apps/site/src/components/SearchDialog.astro | head -30`

Identify the function that builds each result row — likely a `renderResults(items)` or inline `items.forEach((r) => ...)` inside the dialog's IIFE around `resultsHost` (line 95). Note its exact line number.

Update each created `<li>` element to carry the combobox option attributes. Whatever the existing code is (likely `li.className = "..."; li.innerHTML = ...`), add three lines that set the role/id/selected/tabindex:

```js
// Inside the per-result loop, after creating `li`:
li.id = `search-result-${i}`;
li.setAttribute("role", "option");
li.setAttribute("aria-selected", "false");
li.setAttribute("tabindex", "-1");
```

The `i` is the iteration index. If the existing code uses `for (const item of items)` with no index, switch to `items.forEach((item, i) => ...)` or `for (let i = 0; i < items.length; i++)`.

- [ ] **Step 4: Add the combobox keyboard handler (integrated with existing IIFE)**

The existing dialog already scopes its DOM access via `dialog.querySelector("#search-input")` (line ~92) and `dialog.querySelector("[data-search-results]")` (line ~95) inside an IIFE. **Integrate the keyboard handler into the same IIFE** so it uses the same scoped references — do NOT use freestanding `document.getElementById` calls (those would run before the dialog mounts and return null).

Inside the existing IIFE, find where the input is bound (look for `input.addEventListener(` or similar). Add:

```js
let activeIdx = -1;

function setActive(items, idx) {
  for (let i = 0; i < items.length; i++) {
    items[i].setAttribute("aria-selected", i === idx ? "true" : "false");
  }
  if (idx >= 0 && items[idx]) {
    input.setAttribute("aria-activedescendant", items[idx].id);
    items[idx].scrollIntoView({ block: "nearest" });
  } else {
    input.setAttribute("aria-activedescendant", "");
  }
}

input.addEventListener("keydown", (e) => {
  const items = resultsHost.querySelectorAll('[role="option"]');
  if (items.length === 0) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIdx = (activeIdx + 1) % items.length;
    setActive(items, activeIdx);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIdx = (activeIdx - 1 + items.length) % items.length;
    setActive(items, activeIdx);
  } else if (e.key === "Enter" && activeIdx >= 0) {
    e.preventDefault();
    const link = items[activeIdx].querySelector("a");
    if (link) link.click();
  }
});

// Reset on new query so ArrowDown always starts at result 0
input.addEventListener("input", () => { activeIdx = -1; });
```

The references `input` and `resultsHost` are already in scope from the IIFE's existing `dialog.querySelector` calls. If the existing variable names differ, use whichever names the file already uses.

- [ ] **Step 5: Toggle `aria-expanded` on dialog open/close**

The existing dialog (line 386) uses `dialog!.showModal()` and (line 391) `dialog!.close()`. Add adjacent lines:

```diff
-    if (!dialog!.open) dialog!.showModal();
+    if (!dialog!.open) {
+      dialog!.showModal();
+      input.setAttribute("aria-expanded", "true");
+    }
 ...
-    if (dialog!.open) dialog!.close();
+    if (dialog!.open) {
+      dialog!.close();
+      input.setAttribute("aria-expanded", "false");
+    }
```

(The `input` variable should be the same scoped reference used in Step 4.)

- [ ] **Step 6: Add evidence to conformance.yaml**

Update WCAG `4.1.3` (Status Messages) and `4.1.2` (Name, Role, Value):

```yaml
  - id: "4.1.3"
    name: Status Messages
    level: AA
    status: supports
    notes: >
      Search dialog announces result count via aria-live="polite" on the
      status string. The results list itself is a role="listbox" with
      role="option" items; the input is a role="combobox" with
      aria-activedescendant, so screen readers announce each option
      change without leaving the input.
    evidence:
      - kind: source
        path: apps/site/src/components/SearchDialog.astro
        anchor: 'role="combobox"'
      - kind: source
        path: apps/site/src/components/SearchDialog.astro
        anchor: 'role="listbox"'
      - kind: source
        path: apps/site/src/components/SearchDialog.astro
        anchor: 'aria-activedescendant'
      - kind: source
        path: apps/site/src/components/SearchDialog.astro
        anchor: 'aria-live="polite"'
      - kind: artifact
        path: docs/accessibility/test-runs/search/latest/transcript-voiceover.md
    commit: HEAD

  - id: "4.1.2"
    name: Name, Role, Value
    level: A
    status: supports
    notes: >
      All interactive controls have accessible names and explicit roles.
      The combobox/listbox pattern is the most complex case; other
      controls (buttons, dialogs, nav links) use semantic HTML.
    evidence:
      - kind: source
        path: apps/site/src/components/SearchDialog.astro
        anchor: 'role="combobox"'
      - kind: artifact
        path: docs/accessibility/test-runs/search/latest/transcript-synthetic.md
    commit: HEAD

  - id: "2.1.1"
    name: Keyboard
    level: A
    status: supports
    notes: >
      All interactive controls are keyboard-operable. The search combobox
      handles ↓/↑/Enter without leaving the input. Dialog opens/closes via
      Cmd+K / Escape.
    evidence:
      - kind: source
        path: apps/site/src/components/SearchDialog.astro
        anchor: "ArrowDown"
      - kind: artifact
        path: docs/accessibility/test-runs/search/latest/transcript-synthetic.md
    commit: HEAD
```

- [ ] **Step 7: Manual smoke test**

Run dev. Cmd+K to open. Type "manu". Verify:
- ↓ moves selection through results (visual highlight + active descendant)
- ↑ moves selection backward
- Enter on a selected result navigates to that page
- Escape closes the dialog
- Tab key still moves to next focusable element (not trapped)

Verify with VoiceOver active (Cmd+F5) that each ↓ announces the new result.

- [ ] **Step 8: Run verifier**

Run: `bun run a11y:verify`
Expected: PASS. All new anchors resolve.

- [ ] **Step 9: Commit**

```bash
git add apps/site/src/components/SearchDialog.astro docs/accessibility/conformance.yaml
git commit -m "feat(a11y): SearchDialog combobox pattern (WCAG 4.1.3 + 2.1.1)"
```

### Task 20: Chunk 2 sanity check

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: All tests pass — existing + new (`a11y-contrast-audit.test.ts`, `corpus-bcp47.test.ts`, plus Chunk 1 tests).

- [ ] **Step 2: Run the contrast audit**

Run: `bun run a11y:contrast`
Expected: PASS, ≥ 5 pairs verified.

- [ ] **Step 3: Run the verifier**

Run: `bun run a11y:verify`
Expected: PASS. New evidence refs in conformance.yaml all resolve.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual end-to-end smoke**

Run `bun run --cwd apps/site dev`. Open these URLs and verify:

- `/` — header renders, search trigger works, dividers visible (not invisible)
- `/works/bang-i-dara/01/original/` — `<article lang="ur-Arab" dir="rtl">` in DOM; text reads right-to-left
- `/works/manusmrti/01/transliteration/` — `<article lang="sa-Latn">` in DOM (verifies Sanskrit transliteration path)
- `/about` — Manusmṛti and other terms are wrapped in `<span lang="sa-Latn">`
- Search dialog (Cmd+K) — arrow keys move selection, Enter opens, screen reader announces results

- [ ] **Step 6: Confirm Chunk 2 deliverables**

Check:
- [ ] `--rule` and `--accent-soft` contrast bumps committed
- [ ] Contrast audit script + tests committed
- [ ] System-pref CSS appended to tokens.css
- [ ] bcp47Of + isRtl helpers + tests in corpus.ts
- [ ] works.json carries `script` field for all non-English variants
- [ ] Variant page emits `lang` + `dir`
- [ ] About page wraps foreign terms
- [ ] RTL CSS overrides committed
- [ ] SearchDialog combobox restructured + clear button restored
- [ ] conformance.yaml has new evidence for 1.4.3, 1.4.11, 2.1.1, 3.1.1, 3.1.2, 4.1.2, 4.1.3, EN 5.2

**Chunk 2 complete. The AA claim is now defensible — every blocker is fixed and every fix has evidence in the YAML. Proceed to Chunk 3 only after the verifier passes and the audit passes.**

---

## Chunk 3: Generators (VPAT + Annex F + matrix module)

**Why third:** Conformance.yaml exists and is populated. Now build the three pure-function generators that turn the YAML into the artifacts a govt reviewer downloads (VPAT, Annex F) and the TypeScript module the `/accessibility` page imports (matrix). All three are derived data — no hand-editing.

**Deliverables (Chunk 3):**
- `apps/a11y-tools/src/generate/vpat.ts` — emits `docs/accessibility/vpat-v1.0.html` (PDF deferred to V2)
- `apps/a11y-tools/src/generate/annex-f.ts` — emits `docs/accessibility/statement-en301549.html` (PDF deferred to V2)
- `apps/a11y-tools/src/generate/matrix.ts` — emits `apps/site/src/lib/conformance.generated.ts`
- `apps/a11y-tools/src/generate/index.ts` — CLI dispatcher (`a11y:generate vpat | annex-f | matrix`)
- Two HTML templates under `apps/a11y-tools/templates/`
- Snapshot tests for VPAT and Annex F
- A type-check pass on the generated TS module

**End-state proof after Chunk 3:**
- `bun a11y:generate vpat && bun a11y:generate annex-f && bun a11y:generate matrix` all exit 0
- `docs/accessibility/vpat-v1.0.html` opens in a browser and shows 86 WCAG rows + 9 Section 508 + 7 EN 301 549
- `docs/accessibility/vpat-v1.0.html` renders cleanly for print-to-PDF (PDF generation itself is deferred to V2)
- `apps/site/src/lib/conformance.generated.ts` typechecks against the spec's expected shape

### Task 21: Generate CLI dispatcher + template directory

**Files:**
- Create: `apps/a11y-tools/src/generate/index.ts`
- Create: `apps/a11y-tools/templates/` (empty dir; templates added in Tasks 22-23)

- [ ] **Step 1: Implement the dispatcher**

```ts
// apps/a11y-tools/src/generate/index.ts
export async function main(args: string[]): Promise<void> {
  const kind = args[0];
  switch (kind) {
    case "vpat":
      await import("./vpat.js").then((m) => m.generate());
      break;
    case "annex-f":
      await import("./annex-f.js").then((m) => m.generate());
      break;
    case "matrix":
      await import("./matrix.js").then((m) => m.generate());
      break;
    default:
      console.error("usage: a11y-tools generate <vpat|annex-f|matrix>");
      process.exit(2);
  }
}
```

- [ ] **Step 2: Verify dispatcher errors helpfully**

Run: `bun a11y:generate`
Expected: `usage: a11y-tools generate <vpat|annex-f|matrix>` exit 2.

Run: `bun a11y:generate vpat`
Expected: error — `Cannot find module './vpat'`. (That's Task 22.)

- [ ] **Step 3: Create the templates dir**

Run: `mkdir -p apps/a11y-tools/templates`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/a11y-tools/src/generate/ apps/a11y-tools/templates/
git commit -m "feat(a11y-tools): generator CLI dispatcher + templates dir"
```

### Task 22: VPAT 2.5 INT generator

**Files:**
- Create: `apps/a11y-tools/templates/vpat-2.5-int.html.tmpl`
- Create: `apps/a11y-tools/src/generate/vpat.ts`
- Create: `apps/a11y-tools/src/__tests__/vpat.test.ts`

The VPAT 2.5 INT format is the ITI International edition, covering WCAG 2.x + Section 508 + EN 301 549 in one document. Template structure follows https://www.itic.org/policy/accessibility/vpat (the "INT" variant unifies the three frameworks).

- [ ] **Step 1: Create the HTML template**

```html
<!-- apps/a11y-tools/templates/vpat-2.5-int.html.tmpl
     {{...}} placeholders are filled by vpat.ts via the simple substitutor.
     Conditional sections use {{#section}}...{{/section}}.
-->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{productName}} — Accessibility Conformance Report (VPAT 2.5 INT)</title>
  <style>
    body { font: 14px/1.5 system-ui, sans-serif; max-width: 1080px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.8rem; margin-bottom: 0.25rem; }
    h2 { margin-top: 2.5rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
    h3 { margin-top: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { padding: 0.4rem 0.6rem; border: 1px solid #ccc; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; }
    .status-supports { color: #1a7a3a; font-weight: 600; }
    .status-partial { color: #a06000; font-weight: 600; }
    .status-not-applicable { color: #5a5a5a; }
    .status-does-not-support { color: #a00; font-weight: 600; }
    .exception { background: #fff8e1; padding: 0.5rem; border-left: 3px solid #c69500; margin: 0.5rem 0; }
    .meta { color: #5a5a5a; }
    .evidence { font-family: ui-monospace, monospace; font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>{{productName}}</h1>
  <p class="meta">
    Accessibility Conformance Report — VPAT 2.5 INT<br>
    Generated: {{generatedAt}} · Standard: {{standard}} · Level: {{conformanceLevel}}<br>
    Contact: <a href="mailto:{{contact}}">{{contact}}</a><br>
    Last review: {{lastReview}} · Next review: {{nextReview}}
  </p>

  <h2>Applicable Standards</h2>
  <ul>
    <li>WCAG 2.2 (Web Content Accessibility Guidelines)</li>
    <li>US Section 508 (Rev. 2017) — Functional Performance Criteria</li>
    <li>EN 301 549 v3.2.1 — clauses 5-13</li>
  </ul>

  <h2>WCAG 2.2 Conformance — {{criteriaCount}} Success Criteria</h2>
  <table>
    <thead>
      <tr>
        <th>Criterion</th>
        <th>Name</th>
        <th>Level</th>
        <th>Status</th>
        <th>Notes &amp; Evidence</th>
      </tr>
    </thead>
    <tbody>
      {{wcagRows}}
    </tbody>
  </table>

  <h2>Section 508 Functional Performance Criteria</h2>
  <table>
    <thead>
      <tr>
        <th>Clause</th>
        <th>Name</th>
        <th>Status</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      {{section508Rows}}
    </tbody>
  </table>

  <h2>EN 301 549 — Additional Clauses (5–13)</h2>
  <table>
    <thead>
      <tr>
        <th>Clause</th>
        <th>Name</th>
        <th>Status</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      {{enRows}}
    </tbody>
  </table>

  <h2>Documented Exceptions</h2>
  <p>Three WCAG AAA criteria are documented as content-type exceptions and are not implemented:</p>
  {{exceptionsBlock}}

  <h2>Verification</h2>
  <p>
    Every claim in this report is regenerated from
    <code>docs/accessibility/conformance.yaml</code> by the open-source
    generator at <code>apps/a11y-tools/src/generate/vpat.ts</code>.
    Test artifacts (transcripts, screenshots, audio) are committed under
    <code>docs/accessibility/test-runs/</code> and refresh on every PR
    via continuous integration. Reproduce locally with:
  </p>
  <pre><code>git clone https://github.com/adoistic/falsafa
cd falsafa &amp;&amp; bun install &amp;&amp; bun run a11y</code></pre>
</body>
</html>
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/a11y-tools/src/__tests__/vpat.test.ts
import { describe, expect, it } from "bun:test";
import { renderVpat } from "../generate/vpat";

const FIXTURE_DOC = {
  meta: {
    standard: "WCAG 2.2" as const,
    conformance_level: "AA" as const,
    partial_aaa: true,
    last_review: "2026-05-14",
    next_review: "2026-08-14",
    contact: "a@b.com",
    vpat_version: "2.5 INT",
    jurisdictions: ["us"] as const,
  },
  criteria: [
    { id: "1.1.1", name: "Non-text Content", level: "A" as const, status: "supports" as const, notes: "ok", evidence: [{ kind: "source" as const, path: "x.ts", lines: "1" }], commit: "abc1234" },
    { id: "3.1.5", name: "Reading Level", level: "AAA" as const, status: "not-applicable" as const, exception: "content-type", notes: "graduate philosophy", evidence: [], commit: "abc1234" },
  ],
  section_508: [
    { id: "302.1", name: "Without Vision", status: "supports" as const, notes: "ok", evidence: [] },
  ],
  en_301_549: [
    { clause: "5.2", name: "Activation of accessibility features", status: "supports" as const, notes: "ok", evidence: [] },
  ],
};

describe("renderVpat", () => {
  it("includes the WCAG criteria table with the criterion ID", () => {
    const html = renderVpat(FIXTURE_DOC, "Falsafa", new Date("2026-05-14T00:00:00Z"));
    expect(html).toContain("1.1.1");
    expect(html).toContain("Non-text Content");
  });
  it("renders status with a status-* class for screen-readable styling", () => {
    const html = renderVpat(FIXTURE_DOC, "Falsafa", new Date("2026-05-14T00:00:00Z"));
    expect(html).toContain("status-supports");
    expect(html).toContain("status-not-applicable");
  });
  it("includes the exceptions block for content-type exceptions", () => {
    const html = renderVpat(FIXTURE_DOC, "Falsafa", new Date("2026-05-14T00:00:00Z"));
    expect(html).toContain("3.1.5");
    expect(html).toContain("content-type");
  });
  it("includes Section 508 + EN 301 549 rows", () => {
    const html = renderVpat(FIXTURE_DOC, "Falsafa", new Date("2026-05-14T00:00:00Z"));
    expect(html).toContain("302.1");
    expect(html).toContain("5.2");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test apps/a11y-tools/src/__tests__/vpat.test.ts`
Expected: FAIL. Bun reports `Cannot find module '../generate/vpat'`.

- [ ] **Step 4: Implement the generator**

```ts
// apps/a11y-tools/src/generate/vpat.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConformanceDoc } from "../parse.js";
import type { ConformanceDoc, Evidence } from "../types.js";

const TPL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");

function statusClass(status: string): string {
  return `status-${status}`;
}

function renderEvidence(ev: Evidence[]): string {
  if (ev.length === 0) return "<em>(no evidence)</em>";
  return ev
    .map((e) => {
      const ref = e.lines
        ? `${e.path}:${e.lines}`
        : e.anchor
          ? `${e.path} (anchor: ${e.anchor})`
          : e.path;
      return `<div class="evidence">${e.kind}: ${escapeHtml(ref)}</div>`;
    })
    .join("\n      ");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function renderWcagRows(doc: ConformanceDoc): string {
  return doc.criteria
    .map(
      (c) =>
        `      <tr>
        <td>${c.id}</td>
        <td>${escapeHtml(c.name)}</td>
        <td>${c.level}</td>
        <td class="${statusClass(c.status)}">${c.status}${c.exception ? ` (${c.exception})` : ""}</td>
        <td>${escapeHtml(c.notes)}${c.evidence.length > 0 ? "<br>" + renderEvidence(c.evidence) : ""}</td>
      </tr>`,
    )
    .join("\n");
}

function renderSection508Rows(doc: ConformanceDoc): string {
  return doc.section_508
    .map(
      (e) =>
        `      <tr>
        <td>${e.id}</td>
        <td>${escapeHtml(e.name)}</td>
        <td class="${statusClass(e.status)}">${e.status}</td>
        <td>${escapeHtml(e.notes ?? "")}</td>
      </tr>`,
    )
    .join("\n");
}

function renderEnRows(doc: ConformanceDoc): string {
  return doc.en_301_549
    .map(
      (e) =>
        `      <tr>
        <td>${e.clause}</td>
        <td>${escapeHtml(e.name)}</td>
        <td class="${statusClass(e.status)}">${e.status}</td>
        <td>${escapeHtml(e.notes ?? "")}</td>
      </tr>`,
    )
    .join("\n");
}

function renderExceptionsBlock(doc: ConformanceDoc): string {
  const exceptions = doc.criteria.filter((c) => c.status === "not-applicable" && c.exception);
  if (exceptions.length === 0) return "<p>(none)</p>";
  return exceptions
    .map(
      (c) =>
        `<div class="exception">
  <strong>WCAG ${c.id} ${escapeHtml(c.name)} (${c.level})</strong> — Exception: ${escapeHtml(c.exception!)}<br>
  ${escapeHtml(c.notes)}
</div>`,
    )
    .join("\n");
}

export function renderVpat(doc: ConformanceDoc, productName: string, now: Date): string {
  const template = readFileSync(resolve(TPL_DIR, "vpat-2.5-int.html.tmpl"), "utf8");
  const subs: Record<string, string> = {
    productName: escapeHtml(productName),
    generatedAt: now.toISOString().slice(0, 10),
    standard: doc.meta.standard,
    conformanceLevel: doc.meta.conformance_level,
    contact: escapeHtml(doc.meta.contact),
    lastReview: doc.meta.last_review,
    nextReview: doc.meta.next_review,
    criteriaCount: String(doc.criteria.length),
    wcagRows: renderWcagRows(doc),
    section508Rows: renderSection508Rows(doc),
    enRows: renderEnRows(doc),
    exceptionsBlock: renderExceptionsBlock(doc),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => subs[key] ?? "");
}

export async function generate(): Promise<void> {
  const root = process.cwd();
  const doc = await parseConformanceDoc(resolve(root, "docs/accessibility/conformance.yaml"));
  const html = renderVpat(doc, "Falsafa", new Date());
  const htmlPath = resolve(root, "docs/accessibility/vpat-v1.0.html");
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html);
  console.log(`Generated ${htmlPath}`);

  // V1 ships HTML only. PDF is deferred to V2; the `playwright screenshot`
  // CLI emits PNG, not PDF, and a proper `page.pdf({ path })` invocation
  // requires standing up a Playwright browser instance — out of V1 scope.
  // Govt reviewers can print-to-PDF from the HTML if they need a PDF copy.
}
```

- [ ] **Step 5: Run unit tests to verify they pass**

Run: `bun test apps/a11y-tools/src/__tests__/vpat.test.ts`
Expected: PASS, all 4 cases.

- [ ] **Step 6: Generate against the live YAML**

Run: `bun a11y:generate vpat`
Expected: `Generated docs/accessibility/vpat-v1.0.html` (and possibly a PDF warning).

Open `docs/accessibility/vpat-v1.0.html` in a browser. Verify:
- Header shows "Falsafa — Accessibility Conformance Report (VPAT 2.5 INT)"
- WCAG table renders 86 rows
- Section 508 table renders 9 rows
- EN 301 549 table renders 7 rows
- Exceptions block lists 3.1.3, 3.1.5, 3.1.6 (and possibly 1.2.x media exceptions)

- [ ] **Step 7: Commit**

```bash
git add apps/a11y-tools/src/generate/vpat.ts apps/a11y-tools/templates/vpat-2.5-int.html.tmpl apps/a11y-tools/src/__tests__/vpat.test.ts docs/accessibility/vpat-v1.0.html
git commit -m "feat(a11y-tools): VPAT 2.5 INT generator + v1.0 artifact"
```

### Task 23: EN 301 549 Annex F generator

**Files:**
- Create: `apps/a11y-tools/templates/annex-f.html.tmpl`
- Create: `apps/a11y-tools/src/generate/annex-f.ts`

Annex F of EN 301 549 v3.2.1 prescribes a public accessibility statement. The format is simpler than VPAT: prose paragraphs answering specific questions (compliance status, content not accessible, content date, content alternatives, contact, feedback procedure, enforcement).

- [ ] **Step 1: Create the template**

```html
<!-- apps/a11y-tools/templates/annex-f.html.tmpl -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Falsafa — Accessibility Statement (EN 301 549 Annex F)</title>
  <style>
    body { font: 14px/1.6 system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.8rem; }
    h2 { margin-top: 2rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
    h3 { margin-top: 1.5rem; }
    .meta { color: #5a5a5a; }
    ul { padding-left: 1.5rem; }
  </style>
</head>
<body>
  <h1>Accessibility Statement for Falsafa</h1>
  <p class="meta">
    Published: {{generatedAt}}<br>
    Conforms to: {{standard}} — Level {{conformanceLevel}}<br>
    EN 301 549 v3.2.1 Annex F format.
  </p>

  <h2>Compliance status</h2>
  <p>
    Falsafa partially conforms to {{standard}} Level {{conformanceLevel}},
    with full conformance on selected AAA criteria. "Partially" reflects
    three documented content-type exceptions enumerated below; outside those,
    every required criterion is supported and verified by automated tests
    on every pull request.
  </p>

  <h2>Non-accessible content</h2>
  <p>The following content does not meet the higher AAA criteria due to
  the nature of the published material:</p>
  {{exceptionsBlock}}

  <h2>Preparation of this statement</h2>
  <p>
    This statement was generated from
    <code>docs/accessibility/conformance.yaml</code> on
    <strong>{{generatedAt}}</strong> by
    <code>apps/a11y-tools/src/generate/annex-f.ts</code>. The same source
    file drives the VPAT 2.5 INT report and the on-site
    <a href="/accessibility">/accessibility</a> matrix page.
  </p>
  <p>
    The statement was last reviewed on {{lastReview}} and is scheduled
    for next review on {{nextReview}}.
  </p>

  <h2>Feedback and contact information</h2>
  <p>
    Report any accessibility issue to
    <a href="mailto:{{contact}}">{{contact}}</a> or open a GitHub issue at
    <a href="https://github.com/adoistic/falsafa/issues">github.com/adoistic/falsafa/issues</a>.
    We aim to respond within 5 business days.
  </p>

  <h2>Enforcement procedure</h2>
  <p>
    EU residents may escalate unresolved accessibility complaints to the
    national enforcement body designated under Directive 2016/2102 in
    their member state. US residents may file a complaint under the
    Americans with Disabilities Act (ADA) or Section 508 (for federal
    accessibility complaints). Indian residents may invoke their rights
    under the Rights of Persons with Disabilities Act, 2016.
  </p>

  <h2>Technical specifications</h2>
  <p>
    Accessibility of Falsafa relies on the following technologies to work
    with the particular combination of web browser and any assistive
    technologies or plugins installed on your computer:
  </p>
  <ul>
    <li>HTML</li>
    <li>WAI-ARIA</li>
    <li>CSS</li>
    <li>JavaScript</li>
  </ul>

  <h2>Assessment approach</h2>
  <p>
    Falsafa assessed accessibility through automated CI tests
    (axe-core, pa11y, Playwright synthetic transcripts) on every pull
    request, plus real-screen-reader runs (VoiceOver on macOS, NVDA on
    Windows) via the Guidepup framework. Manual JAWS verification is
    performed before any major release. All test artifacts (transcripts,
    audio recordings, screenshots) are committed to the public repository
    at <a href="https://github.com/adoistic/falsafa/tree/main/docs/accessibility/test-runs">docs/accessibility/test-runs/</a>.
  </p>
</body>
</html>
```

- [ ] **Step 2: Implement the generator**

```ts
// apps/a11y-tools/src/generate/annex-f.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConformanceDoc } from "../parse.js";
import type { ConformanceDoc } from "../types.js";

const TPL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function renderExceptionsBlock(doc: ConformanceDoc): string {
  const exceptions = doc.criteria.filter((c) => c.status === "not-applicable" && c.exception);
  if (exceptions.length === 0) return "<p>(none)</p>";
  return (
    "<ul>" +
    exceptions
      .map(
        (c) =>
          `<li><strong>WCAG ${c.id} ${escapeHtml(c.name)} (${c.level})</strong> — ${escapeHtml(c.notes)}</li>`,
      )
      .join("\n") +
    "</ul>"
  );
}

export function renderAnnexF(doc: ConformanceDoc, now: Date): string {
  const template = readFileSync(resolve(TPL_DIR, "annex-f.html.tmpl"), "utf8");
  const subs: Record<string, string> = {
    generatedAt: now.toISOString().slice(0, 10),
    standard: doc.meta.standard,
    conformanceLevel: doc.meta.conformance_level,
    contact: escapeHtml(doc.meta.contact),
    lastReview: doc.meta.last_review,
    nextReview: doc.meta.next_review,
    exceptionsBlock: renderExceptionsBlock(doc),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => subs[key] ?? "");
}

export async function generate(): Promise<void> {
  const root = process.cwd();
  const doc = await parseConformanceDoc(resolve(root, "docs/accessibility/conformance.yaml"));
  const html = renderAnnexF(doc, new Date());
  const htmlPath = resolve(root, "docs/accessibility/statement-en301549.html");
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html);
  console.log(`Generated ${htmlPath}`);
}
```

- [ ] **Step 3: Add a snapshot test (optional but recommended)**

```ts
// Append to apps/a11y-tools/src/__tests__/vpat.test.ts (or create annex-f.test.ts)
import { renderAnnexF } from "../generate/annex-f";

describe("renderAnnexF", () => {
  it("includes the exceptions block", () => {
    const html = renderAnnexF(FIXTURE_DOC, new Date("2026-05-14T00:00:00Z"));
    expect(html).toContain("3.1.5");
  });
  it("includes the enforcement section for all three jurisdictions", () => {
    const html = renderAnnexF(FIXTURE_DOC, new Date("2026-05-14T00:00:00Z"));
    expect(html).toContain("Directive 2016/2102"); // EU
    expect(html).toContain("Section 508");          // US
    expect(html).toContain("Rights of Persons with Disabilities Act"); // India
  });
});
```

- [ ] **Step 4: Run tests + generate**

Run: `bun test apps/a11y-tools/src/__tests__/vpat.test.ts`
Expected: PASS.

Run: `bun a11y:generate annex-f`
Expected: `Generated docs/accessibility/statement-en301549.html`.

Open in browser and verify it renders.

- [ ] **Step 5: Commit**

```bash
git add apps/a11y-tools/src/generate/annex-f.ts apps/a11y-tools/templates/annex-f.html.tmpl docs/accessibility/statement-en301549.html apps/a11y-tools/src/__tests__/vpat.test.ts
git commit -m "feat(a11y-tools): EN 301 549 Annex F generator + statement v1.0"
```

### Task 24: Matrix TypeScript module generator

**Files:**
- Create: `apps/a11y-tools/src/generate/matrix.ts`
- Create: `apps/a11y-tools/src/__tests__/matrix.test.ts`

This generator emits a typed TS module the `/accessibility` page imports at build time. The site never parses YAML; the generator does, and ships pre-parsed data.

- [ ] **Step 1: Write the failing test**

```ts
// apps/a11y-tools/src/__tests__/matrix.test.ts
import { describe, expect, it } from "bun:test";
import { renderMatrixModule } from "../generate/matrix";

const FIXTURE_DOC = {
  meta: { standard: "WCAG 2.2" as const, conformance_level: "AA" as const, partial_aaa: true, last_review: "2026-05-14", next_review: "2026-08-14", contact: "a@b.com", vpat_version: "2.5 INT", jurisdictions: ["us"] as const },
  criteria: [{ id: "1.1.1", name: "Non-text Content", level: "A" as const, status: "supports" as const, notes: "ok", evidence: [], commit: "abc1234" }],
  section_508: [],
  en_301_549: [],
};

describe("renderMatrixModule", () => {
  it("emits a TS module that exports CONFORMANCE", () => {
    const ts = renderMatrixModule(FIXTURE_DOC);
    expect(ts).toContain("export const CONFORMANCE");
    expect(ts).toContain('"1.1.1"');
  });
  it("includes a 'do not edit' header", () => {
    const ts = renderMatrixModule(FIXTURE_DOC);
    expect(ts).toMatch(/generated|do not edit/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/a11y-tools/src/__tests__/matrix.test.ts`
Expected: FAIL — `Cannot find module '../generate/matrix'`.

- [ ] **Step 3: Implement the generator**

```ts
// apps/a11y-tools/src/generate/matrix.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseConformanceDoc } from "../parse.js";
import type { ConformanceDoc } from "../types.js";

export function renderMatrixModule(doc: ConformanceDoc): string {
  const json = JSON.stringify(doc, null, 2);
  return `// AUTO-GENERATED by apps/a11y-tools/src/generate/matrix.ts.
// Do not edit by hand. Run: bun a11y:generate matrix.
// Source: docs/accessibility/conformance.yaml

export interface ConformanceCriterion {
  id: string;
  name: string;
  level: "A" | "AA" | "AAA";
  status: "supports" | "partial" | "not-applicable" | "does-not-support";
  exception?: string;
  notes: string;
  evidence: Array<{ kind: "source" | "test" | "artifact"; path: string; lines?: string; anchor?: string }>;
  commit: string;
}

export interface Section508Entry {
  id: string;
  name: string;
  status: ConformanceCriterion["status"];
  notes?: string;
  evidence: ConformanceCriterion["evidence"];
}

export interface EN301549Entry {
  clause: string;
  name: string;
  status: ConformanceCriterion["status"];
  notes?: string;
  evidence: ConformanceCriterion["evidence"];
}

export interface ConformanceDoc {
  meta: {
    standard: string;
    conformance_level: string;
    partial_aaa: boolean;
    last_review: string;
    next_review: string;
    contact: string;
    vpat_version: string;
    jurisdictions: string[];
  };
  criteria: ConformanceCriterion[];
  section_508: Section508Entry[];
  en_301_549: EN301549Entry[];
}

export const CONFORMANCE: ConformanceDoc = ${json} as ConformanceDoc;
`;
}

export async function generate(): Promise<void> {
  const root = process.cwd();
  const doc = await parseConformanceDoc(resolve(root, "docs/accessibility/conformance.yaml"));
  const ts = renderMatrixModule(doc);
  const outPath = resolve(root, "apps/site/src/lib/conformance.generated.ts");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, ts);
  console.log(`Generated ${outPath}`);
}
```

- [ ] **Step 4: Run tests + generate**

Run: `bun test apps/a11y-tools/src/__tests__/matrix.test.ts`
Expected: PASS.

Run: `bun a11y:generate matrix`
Expected: `Generated apps/site/src/lib/conformance.generated.ts`.

- [ ] **Step 5: Typecheck the generated module**

Run: `bun run typecheck`
Expected: no type errors. The generated module is now imported by the (Chunk 5) `/accessibility` page; if Chunk 5 hasn't run yet, the module is unused — typecheck still must pass on the generated module itself.

- [ ] **Step 6: Commit**

```bash
git add apps/a11y-tools/src/generate/matrix.ts apps/site/src/lib/conformance.generated.ts apps/a11y-tools/src/__tests__/matrix.test.ts
git commit -m "feat(a11y-tools): matrix TS module generator (drives /accessibility page)"
```

### Task 25: Chunk 3 sanity check

- [ ] **Step 1: Run all three generators**

Run: `bun a11y:generate vpat && bun a11y:generate annex-f && bun a11y:generate matrix`
Expected: three `Generated …` lines.

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: all tests pass (Chunk 1 + Chunk 2 + Chunk 3 tests, including vpat + matrix snapshot tests).

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Confirm Chunk 3 deliverables**

Check:
- [ ] `docs/accessibility/vpat-v1.0.html` exists and renders
- [ ] `docs/accessibility/statement-en301549.html` exists and renders
- [ ] `apps/site/src/lib/conformance.generated.ts` exists and typechecks
- [ ] All four generator commits land

**Chunk 3 complete. The site now has a typed conformance module ready for Chunk 5 to render. VPAT + Annex F are downloadable artifacts. Proceed to Chunk 4.**

---

## Chunk 4: CI workflow + eight test journeys

**Why fourth:** The fixes (Chunk 2) and generators (Chunk 3) are landed but the conformance YAML still claims evidence at `docs/accessibility/test-runs/<journey>/latest/` paths that don't exist yet. Chunk 4 lands those paths by running real tests in CI and committing the artifacts. Until Chunk 4, the verifier passes (it skips `artifact` kind), but the `/accessibility` page (Chunk 5) has no transcripts to render.

**Deliverables (Chunk 4):**
- New deps: `pa11y-ci`, `@guidepup/guidepup`, `@guidepup/playwright`
- `tests/a11y/playwright.config.ts` — three Playwright projects (synthetic / voiceover / nvda)
- `tests/a11y/lib/synthetic-transcript.ts` — AT-tree dumper utility
- `tests/a11y/lib/guidepup-helpers.ts` — shared VoiceOver + NVDA setup
- `tests/a11y/lib/merge-artifacts.ts` — CI artifact reorganizer
- `tests/a11y/lib/synthesize-audio.ts` — espeak fallback synthesizer
- `tests/a11y/pa11y.config.json` — pa11y-ci URL list + config
- Eight journey spec files under `tests/a11y/journeys/`
- `.github/workflows/a11y.yml` — four parallel jobs + commit-results

**End-state proof after Chunk 4:**
- `bun run a11y:synthetic` runs Playwright locally, produces transcripts + screenshots + videos under `docs/accessibility/test-runs/`
- `bun run a11y` (the local shortcut) passes
- A push to main triggers `.github/workflows/a11y.yml` and four jobs run in parallel; the `commit-results` job pushes artifacts back to main as a `[skip ci]` commit

### Task 26: Install new dependencies + Playwright config

**Files:**
- Modify: `apps/site/package.json` (add 3 devDeps)
- Create: `tests/a11y/playwright.config.ts`

- [ ] **Step 1: Install the new deps**

Run:

```bash
cd apps/site
bun add -d pa11y-ci @guidepup/guidepup @guidepup/playwright
cd ../..
```

Expected: `package.json` shows three new devDeps. `bun.lock` updates.

- [ ] **Step 2: Create the Playwright config**

```ts
// tests/a11y/playwright.config.ts
import { defineConfig } from "@playwright/test";

const baseURL = process.env.A11Y_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "./journeys",
  fullyParallel: false, // VoiceOver/NVDA require serial execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "../../docs/accessibility/test-runs/_playwright-output",
  use: {
    baseURL,
    headless: true,
    trace: "on-first-retry",
    video: "on",
    screenshot: "on",
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
    colorScheme: "light",
  },
  projects: [
    {
      name: "synthetic",
      use: { browserName: "chromium" },
    },
    {
      name: "voiceover",
      testMatch: /.*\.spec\.ts$/,
      use: { browserName: "webkit" }, // Safari + VoiceOver pair best
    },
    {
      name: "nvda",
      testMatch: /.*\.spec\.ts$/,
      use: { browserName: "chromium" }, // NVDA + Firefox or Chrome
    },
  ],
});
```

- [ ] **Step 3: Verify Playwright picks up the config**

Run: `bunx --cwd apps/site playwright test --config ../../tests/a11y/playwright.config.ts --list`
Expected: `0 tests in 0 files` (no journey files yet) but no config-parsing error.

- [ ] **Step 4: Commit**

```bash
git add apps/site/package.json apps/site/bun.lock tests/a11y/playwright.config.ts
git commit -m "feat(a11y): pa11y-ci + Guidepup deps + Playwright config"
```

### Task 27: Synthetic transcript helper

**Files:**
- Create: `tests/a11y/lib/synthetic-transcript.ts`
- Create: `tests/a11y/lib/__tests__/synthetic-transcript.test.ts`

The synthetic transcript walks the DOM in tab order and dumps `accessibleName + role + state` for each focusable element — approximating what a screen reader would announce.

- [ ] **Step 1: Write the failing test**

```ts
// tests/a11y/lib/__tests__/synthetic-transcript.test.ts
import { describe, expect, it } from "bun:test";
import { formatTranscriptLine } from "../synthetic-transcript";

describe("formatTranscriptLine", () => {
  it("formats button with name + role", () => {
    expect(formatTranscriptLine(1, { role: "button", name: "Search Falsafa", state: [] }))
      .toBe('[1] button: "Search Falsafa"');
  });
  it("includes state when present", () => {
    expect(formatTranscriptLine(2, { role: "checkbox", name: "Dark mode", state: ["checked"] }))
      .toBe('[2] checkbox, checked: "Dark mode"');
  });
  it("handles missing name with role only", () => {
    expect(formatTranscriptLine(3, { role: "img", name: "", state: [] }))
      .toBe("[3] img");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/a11y/lib/__tests__/synthetic-transcript.test.ts`
Expected: FAIL. `Cannot find module '../synthetic-transcript'`.

- [ ] **Step 3: Implement the helper**

```ts
// tests/a11y/lib/synthetic-transcript.ts
import type { Page, Locator } from "@playwright/test";

export interface TranscriptEntry {
  role: string;
  name: string;
  state: string[];
}

export function formatTranscriptLine(index: number, entry: TranscriptEntry): string {
  const states = entry.state.length > 0 ? ", " + entry.state.join(", ") : "";
  if (!entry.name) return `[${index}] ${entry.role}${states}`;
  return `[${index}] ${entry.role}${states}: "${entry.name}"`;
}

/**
 * Tab through the page and capture the accessibility tree of each focused
 * element, in order. Approximates what a screen reader announces.
 *
 * Limit to first `maxSteps` Tab presses to avoid infinite loops on pages
 * with very many focusable elements.
 */
export async function captureSyntheticTranscript(
  page: Page,
  maxSteps = 50,
): Promise<TranscriptEntry[]> {
  const entries: TranscriptEntry[] = [];
  await page.keyboard.press("Tab");
  for (let i = 0; i < maxSteps; i++) {
    const focused = page.locator(":focus");
    if ((await focused.count()) === 0) break;
    const entry = await entryFromLocator(focused);
    if (entry) {
      // Stop if we've cycled back to a previously-focused element
      const seen = entries.some(
        (e) => e.role === entry.role && e.name === entry.name && e.state.join(",") === entry.state.join(","),
      );
      if (seen) break;
      entries.push(entry);
    }
    await page.keyboard.press("Tab");
  }
  return entries;
}

async function entryFromLocator(loc: Locator): Promise<TranscriptEntry | null> {
  const handle = await loc.elementHandle();
  if (!handle) return null;
  const role = (await handle.getAttribute("role")) ?? (await handle.evaluate((el) => el.tagName.toLowerCase()));
  // Playwright's accessibility APIs aren't always sufficient — for robust
  // accessible-name computation we'd ideally call axe-core's text engine.
  // V1 uses Playwright's built-in `ariaLabel` / textContent heuristic.
  const name =
    (await handle.getAttribute("aria-label")) ??
    (await handle.evaluate((el) => el.textContent?.trim() ?? "")) ??
    "";
  const state: string[] = [];
  if ((await handle.getAttribute("aria-expanded")) === "true") state.push("expanded");
  if ((await handle.getAttribute("aria-selected")) === "true") state.push("selected");
  if ((await handle.getAttribute("aria-checked")) === "true") state.push("checked");
  if ((await handle.getAttribute("aria-disabled")) === "true") state.push("disabled");
  if ((await handle.getAttribute("disabled")) !== null) state.push("disabled");
  return { role, name, state };
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `bun test tests/a11y/lib/__tests__/synthetic-transcript.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/a11y/lib/synthetic-transcript.ts tests/a11y/lib/__tests__/synthetic-transcript.test.ts
git commit -m "feat(a11y): synthetic-transcript helper (AT-tree dumper)"
```

### Task 28: Guidepup VoiceOver + NVDA helpers

**Files:**
- Create: `tests/a11y/lib/guidepup-helpers.ts`

- [ ] **Step 1: Implement the helpers**

```ts
// tests/a11y/lib/guidepup-helpers.ts
import { voiceOver, nvda, type ScreenReader } from "@guidepup/guidepup";

let active: ScreenReader | null = null;

/**
 * Start the platform-appropriate screen reader. Returns the SR instance
 * for the test to call .next() / .previous() / .lastSpokenPhrase().
 *
 * In CI: this is driven by the project name (voiceover on macos-latest,
 * nvda on windows-latest). On a developer machine, falls back to whatever
 * the OS supports.
 */
export async function startScreenReader(): Promise<ScreenReader> {
  if (active) return active;
  if (process.platform === "darwin") {
    await voiceOver.start();
    active = voiceOver;
  } else if (process.platform === "win32") {
    await nvda.start();
    active = nvda;
  } else {
    throw new Error("Screen reader testing only supported on macOS (VoiceOver) or Windows (NVDA)");
  }
  return active;
}

export async function stopScreenReader(): Promise<void> {
  if (!active) return;
  await active.stop();
  active = null;
}

/**
 * Capture the spoken phrase log from the screen reader and dump as a
 * Markdown transcript. Each line: `1. <phrase>`.
 */
export async function dumpScreenReaderTranscript(sr: ScreenReader): Promise<string> {
  const log = await sr.spokenPhraseLog();
  return log.map((phrase, i) => `${i + 1}. ${phrase}`).join("\n");
}
```

(Note: `@guidepup/guidepup`'s `spokenPhraseLog` API returns an array of strings. The exact method name may differ in newer versions — check the Guidepup README at https://guidepup.dev/ when implementing.)

- [ ] **Step 2: Commit**

```bash
git add tests/a11y/lib/guidepup-helpers.ts
git commit -m "feat(a11y): Guidepup helpers (VoiceOver + NVDA shared lifecycle)"
```

### Task 29: Test journey #1 — homepage (the reference implementation)

**Files:**
- Create: `tests/a11y/journeys/homepage.spec.ts`

This is the reference journey. Implementer can copy/paste this structure for the 7 journeys in Task 30 (which bundles all of #2-#8 together).

- [ ] **Step 1: Write the journey**

```ts
// tests/a11y/journeys/homepage.spec.ts
import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { captureSyntheticTranscript, formatTranscriptLine } from "../lib/synthetic-transcript";
import { startScreenReader, stopScreenReader, dumpScreenReaderTranscript } from "../lib/guidepup-helpers";

const JOURNEY = "homepage";
const SHA = process.env.GITHUB_SHA ?? "local";
const ARTIFACTS = resolve(`docs/accessibility/test-runs/${JOURNEY}/${SHA}`);

test.beforeAll(() => mkdirSync(ARTIFACTS, { recursive: true }));

test.describe("Homepage accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("axe-core finds no violations (synthetic project only)", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "axe runs in synthetic project");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("skip-link is present + reachable on first Tab", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    const text = await focused.textContent();
    expect(text?.trim().toLowerCase()).toContain("skip");
  });

  test("landmarks present", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    expect(await page.locator("header").count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator("main").count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator("footer").count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator("nav").count()).toBeGreaterThanOrEqual(1);
  });

  test("synthetic transcript dump", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const entries = await captureSyntheticTranscript(page);
    const md =
      "# Synthetic AT-tree transcript — homepage\n\n" +
      entries.map((e, i) => formatTranscriptLine(i + 1, e)).join("\n");
    writeFileSync(resolve(ARTIFACTS, "transcript-synthetic.md"), md);
    expect(entries.length).toBeGreaterThan(3); // at least skip-link + search + main nav
  });

  test("VoiceOver transcript dump", async ({ page }, info) => {
    test.skip(info.project.name !== "voiceover", "macOS only");
    const sr = await startScreenReader();
    await sr.interact();
    for (let i = 0; i < 20; i++) await sr.next();
    const md = "# VoiceOver transcript — homepage\n\n" + (await dumpScreenReaderTranscript(sr));
    writeFileSync(resolve(ARTIFACTS, "transcript-voiceover.md"), md);
    await stopScreenReader();
  });

  test("NVDA transcript dump", async ({ page }, info) => {
    test.skip(info.project.name !== "nvda", "Windows only");
    const sr = await startScreenReader();
    for (let i = 0; i < 20; i++) await sr.next();
    const md = "# NVDA transcript — homepage\n\n" + (await dumpScreenReaderTranscript(sr));
    writeFileSync(resolve(ARTIFACTS, "transcript-nvda.md"), md);
    await stopScreenReader();
  });
});
```

- [ ] **Step 2: Run the synthetic project locally**

Run: `bun run --cwd apps/site dev` in one terminal.
Then: `bun run a11y:synthetic` in another.
Expected: All synthetic tests pass; `docs/accessibility/test-runs/homepage/local/transcript-synthetic.md` is written. Inspect — should show ~5-10 entries starting with the skip-link.

- [ ] **Step 3: Add `local/` artifacts to gitignore (developer-only outputs)**

Append to `.gitignore`:

```diff
+# Test-run artifacts from local developer runs (CI runs commit under <sha>/)
+docs/accessibility/test-runs/*/local/
```

- [ ] **Step 4: Commit (just the spec, not local artifacts)**

```bash
git add tests/a11y/journeys/homepage.spec.ts .gitignore
git commit -m "test(a11y): homepage journey (reference for other journeys)"
```

### Task 30: Test journeys #2-8 (apply the homepage pattern)

**Files:**
- Create: `tests/a11y/journeys/search.spec.ts`
- Create: `tests/a11y/journeys/catalog.spec.ts`
- Create: `tests/a11y/journeys/reader-english.spec.ts`
- Create: `tests/a11y/journeys/reader-original.spec.ts`
- Create: `tests/a11y/journeys/variant-switch.spec.ts`
- Create: `tests/a11y/journeys/eval-case.spec.ts`
- Create: `tests/a11y/journeys/theme-prefs.spec.ts`

For each journey: copy `homepage.spec.ts` as a template, change `JOURNEY` constant, change `page.goto(...)` target, and substitute the journey-specific assertions per the matrix below. Each journey must include all five test blocks (axe, synthetic, VoiceOver, NVDA, plus its specific assertions).

| # | Journey | URL | Specific assertions |
|---|---|---|---|
| 2 | `search` | `/` (open dialog with Cmd+K) | `role="combobox"` on input; arrow-down moves `aria-activedescendant`; Enter on selected option navigates; `aria-live` region announces result count |
| 3 | `catalog` | `/works/` | Work cards have accessible names (image alt or h3); filter chips have `aria-pressed`; work-detail page has `<dl>` semantics on meta-grid |
| 4 | `reader-english` | `/works/andreas/01/translation/` | Chapter body is wrapped in `<article>`; footnote markers are real links (`<a href="#fn-N">`); reading-progress bar has `aria-hidden="true"` |
| 5 | `reader-original` | `/works/bang-i-dara/01/original/` | `<article lang="ur-Arab" dir="rtl">` — assert both. Visit `/works/manusmrti/01/transliteration/` and assert `<article lang="sa-Latn">`. Synthetic transcript should not show "English-pronunciation" warnings |
| 6 | `variant-switch` | `/works/bang-i-dara/01/translation/` | Variant pills have `aria-current="page"` on active; ↓/↑ arrow keys navigate; non-active pills are reachable by Tab; selection cue is non-color (text weight or underline) |
| 7 | `eval-case` | `/eval/q-0001/` | Tabs use `role="tab"` + `aria-selected`; on `#case-wiki` hash, the correct tab has `aria-selected="true"` (closes the `TODOS.md` hashchange item) |
| 8 | `theme-prefs` | `/` (with `--media prefers-color-scheme=dark`, then `prefers-reduced-motion=reduce`, then `prefers-contrast=more`) | Site theme adapts; `prefers-reduced-motion` disables CSS animations (assert via `getComputedStyle`); `forced-colors: active` falls back to system colors |

**Implementer time-budget:** ~30-45 minutes total (each journey is ~5-7 minutes once the homepage pattern is internalized).

- [ ] **Step 1: Create journey 2 (`search`)**

Copy `homepage.spec.ts` → `search.spec.ts`. **Keep all imports and the top-of-file `JOURNEY` / `SHA` / `ARTIFACTS` constants** (change `JOURNEY = "homepage"` to `JOURNEY = "search"`). Then replace the entire `test.describe(...)` block with search-specific assertions. The skeleton below shows only the `test.describe` portion; the file's imports and constants are inherited from `homepage.spec.ts`.

```ts
test.describe("Search dialog accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+K"); // opens the dialog
    await page.waitForSelector("#search-input:focus");
  });

  test("input has role=combobox + aria-expanded=true", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const input = page.locator("#search-input");
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(input).toHaveAttribute("aria-expanded", "true");
  });

  test("ArrowDown moves aria-activedescendant", async ({ page }, info) => {
    test.skip(info.project.name !== "synthetic", "synthetic project");
    const input = page.locator("#search-input");
    await input.fill("manu");
    await page.waitForSelector('[role="option"]'); // result rendered
    await input.press("ArrowDown");
    const active = await input.getAttribute("aria-activedescendant");
    expect(active).toMatch(/^search-result-/);
  });

  // ... axe + synthetic + voiceover + nvda blocks as in homepage.spec.ts
});
```

- [ ] **Step 2: Create journeys 3-8 similarly**

Same pattern. Match each journey's URL + assertions per the matrix above. Use `homepage.spec.ts` as the template structure.

- [ ] **Step 3: Run all synthetic journeys locally**

Run: `bun run --cwd apps/site dev` (terminal 1).
Then: `bun run a11y:synthetic` (terminal 2).
Expected: 8 journeys × ~5 tests each = ~40 synthetic tests pass. `docs/accessibility/test-runs/<journey>/local/transcript-synthetic.md` written for each.

- [ ] **Step 4: Commit**

```bash
git add tests/a11y/journeys/ docs/accessibility/test-runs/
git commit -m "test(a11y): journeys 2-8 (search, catalog, reader, variant, eval, theme)"
```

### Task 31: pa11y config + audio synthesis + merge-artifacts

**Files:**
- Create: `tests/a11y/pa11y.config.json`
- Create: `tests/a11y/lib/synthesize-audio.ts`
- Create: `tests/a11y/lib/merge-artifacts.ts`

- [ ] **Step 1: pa11y-ci config**

```json
{
  "defaults": {
    "standard": "WCAG2AA",
    "timeout": 30000,
    "wait": 1000,
    "chromeLaunchConfig": {
      "args": ["--no-sandbox"]
    }
  },
  "urls": [
    "http://localhost:4321/",
    "http://localhost:4321/about",
    "http://localhost:4321/works/",
    "http://localhost:4321/works/andreas/01/translation/",
    "http://localhost:4321/works/bang-i-dara/01/original/",
    "http://localhost:4321/works/manusmrti/01/transliteration/",
    "http://localhost:4321/eval/",
    "http://localhost:4321/accessibility"
  ]
}
```

- [ ] **Step 2: synthesize-audio.ts (fallback for non-macOS/Windows runners)**

```ts
#!/usr/bin/env bun
// tests/a11y/lib/synthesize-audio.ts
// Synthesize an MP3 from a Markdown transcript using espeak-ng.
// Used on Linux CI when real screen-reader audio isn't available.
import { readdir, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

async function main(): Promise<void> {
  const root = "docs/accessibility/test-runs";
  if (!existsSync(root)) return;
  for (const journey of await readdir(root)) {
    const journeyDir = resolve(root, journey);
    for (const run of await readdir(journeyDir)) {
      const transcriptPath = join(journeyDir, run, "transcript-synthetic.md");
      if (!existsSync(transcriptPath)) continue;
      const out = join(journeyDir, run, "audio-synthetic.mp3");
      const text = (await readFile(transcriptPath, "utf8")).replace(/^#.*$/gm, "").trim();
      const wav = out.replace(/\.mp3$/, ".wav");
      const r = spawnSync("espeak-ng", ["-w", wav, "-s", "180", text], { stdio: "inherit" });
      if (r.status !== 0) {
        console.warn(`espeak-ng not available; skipping ${journey}/${run}`);
        continue;
      }
      spawnSync("ffmpeg", ["-y", "-i", wav, "-codec:a", "libmp3lame", out], { stdio: "inherit" });
      await unlink(wav).catch(() => {}); // cleanup wav
      console.log(`Synthesized ${out}`);
    }
  }
}

if (import.meta.main) await main();
```

- [ ] **Step 3: merge-artifacts.ts**

```ts
#!/usr/bin/env bun
// tests/a11y/lib/merge-artifacts.ts
// After CI download-artifact with merge-multiple, reorganize the flat
// artifact dump into docs/accessibility/test-runs/<journey>/<sha>/.
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function main(): void {
  const flat = resolve("artifacts"); // wherever download-artifact unpacked
  const target = resolve("docs/accessibility/test-runs");
  if (!existsSync(flat)) {
    console.error(`No artifacts at ${flat}`);
    process.exit(1);
  }
  for (const name of readdirSync(flat)) {
    const src = join(flat, name);
    if (!statSync(src).isDirectory()) continue;
    // Each artifact directory contains <journey>/<sha>/ subtree already
    // (the journey specs write to that path). Just merge into target.
    for (const journey of readdirSync(src)) {
      const journeySrc = join(src, journey);
      if (!statSync(journeySrc).isDirectory()) continue;
      const journeyDst = join(target, journey);
      mkdirSync(journeyDst, { recursive: true });
      for (const sha of readdirSync(journeySrc)) {
        const shaSrc = join(journeySrc, sha);
        const shaDst = join(journeyDst, sha);
        if (!existsSync(shaDst)) mkdirSync(shaDst, { recursive: true });
        // Move files from shaSrc into shaDst, preserving any artifact-kind already there
        for (const file of readdirSync(shaSrc)) {
          renameSync(join(shaSrc, file), join(shaDst, file));
        }
      }
    }
  }
  console.log(`Merged artifacts into ${target}`);
}

main();
```

- [ ] **Step 4: Commit**

```bash
git add tests/a11y/pa11y.config.json tests/a11y/lib/synthesize-audio.ts tests/a11y/lib/merge-artifacts.ts
git commit -m "feat(a11y): pa11y config + audio synthesis + merge-artifacts helpers"
```

### Task 32: GitHub Actions a11y.yml workflow

**Files:**
- Create: `.github/workflows/a11y.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/a11y.yml
name: Accessibility

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with: { bun-version: latest }
      - run: bun install --frozen-lockfile
      - run: bun run --cwd apps/site build
      - run: bun run a11y:contrast
      - run: bun run a11y:verify
      - name: pa11y-ci
        run: |
          bun run --cwd apps/site preview &
          npx -y wait-on http://localhost:4321
          bun run a11y:pa11y
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: static
          path: docs/accessibility/test-runs/

  synthetic:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with: { bun-version: latest }
      - run: bun install --frozen-lockfile
      - run: bunx --cwd apps/site playwright install chromium
      - run: bun run --cwd apps/site build
      - name: synthetic journeys
        run: |
          bun run --cwd apps/site preview &
          npx -y wait-on http://localhost:4321
          A11Y_BASE_URL=http://localhost:4321 bun run a11y:synthetic
      - run: sudo apt-get update && sudo apt-get install -y espeak-ng ffmpeg
      - run: bun run a11y:audio:espeak
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: synthetic
          path: docs/accessibility/test-runs/

  guidepup-voiceover:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with: { bun-version: latest }
      - run: bun install --frozen-lockfile
      - run: bunx --cwd apps/site playwright install webkit
      - run: brew install --cask blackhole-2ch || true
      - run: brew install ffmpeg
      - run: bun run --cwd apps/site build
      - name: VoiceOver journeys
        run: |
          bun run --cwd apps/site preview &
          npx -y wait-on http://localhost:4321
          A11Y_BASE_URL=http://localhost:4321 bun run a11y:guidepup:vo
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: voiceover
          path: docs/accessibility/test-runs/

  guidepup-nvda:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with: { bun-version: latest }
      - run: bun install --frozen-lockfile
      - run: bunx --cwd apps/site playwright install chromium
      - name: install NVDA
        run: choco install nvda --no-progress --yes
      - run: bun run --cwd apps/site build
      - name: NVDA journeys
        run: |
          Start-Process -NoNewWindow bun -ArgumentList "run --cwd apps/site preview"
          npx -y wait-on http://localhost:4321
          $env:A11Y_BASE_URL = "http://localhost:4321"
          bun run a11y:guidepup:nvda
        shell: pwsh
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: nvda
          path: docs/accessibility/test-runs/

  commit-results:
    needs: [static, synthetic, guidepup-voiceover, guidepup-nvda]
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with: { bun-version: latest }
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true
      - run: bun install --frozen-lockfile
      - run: bun run a11y:merge-artifacts
      - run: bun a11y:generate vpat && bun a11y:generate annex-f && bun a11y:generate matrix
      - name: commit artifacts
        run: |
          git config user.name "falsafa-a11y-bot"
          git config user.email "a11y-bot@thothica.com"
          git add docs/accessibility/test-runs/ docs/accessibility/vpat-v1.0.html docs/accessibility/statement-en301549.html apps/site/src/lib/conformance.generated.ts
          git diff --staged --quiet || (git commit -m "chore(a11y): refresh test-run artifacts [skip ci]" && git push)
```

- [ ] **Step 2: Lint the workflow file**

Run: `bunx --yes action-validator .github/workflows/a11y.yml` (or any GitHub Actions YAML linter you trust).
Expected: no errors.

- [ ] **Step 3: Commit + push to trigger first CI run**

```bash
git add .github/workflows/a11y.yml
git commit -m "ci(a11y): three-platform workflow (axe + pa11y + Playwright + VoiceOver + NVDA)"
git push
```

Watch the Actions tab on GitHub. The four parallel jobs should all run. On a PR, artifacts are uploaded. On a push to main, the `commit-results` job creates a follow-up commit refreshing the artifacts and generated docs.

### Task 33: Chunk 4 sanity check

- [ ] **Step 1: Re-run the full suite locally**

Run:

```bash
bun run --cwd apps/site dev &
DEV_PID=$!
sleep 5
bun run a11y
kill $DEV_PID
```

Expected: all four steps pass — contrast, verify, pa11y, synthetic Playwright.

- [ ] **Step 2: Confirm CI green**

Open the GitHub Actions UI for the push commit. All four jobs (static, synthetic, voiceover, nvda) green. `commit-results` green.

- [ ] **Step 3: Inspect the committed artifacts**

Run: `git pull && ls docs/accessibility/test-runs/`
Expected: directories for each of the 8 journeys with `<sha>/` subdirs containing `transcript-*.md`, screenshots, mp4, mp3.

- [ ] **Step 4: Confirm Chunk 4 deliverables**

Check:
- [ ] All 8 journey specs created
- [ ] Playwright config + 4 helper libraries created
- [ ] pa11y config created
- [ ] `.github/workflows/a11y.yml` created
- [ ] All four CI jobs green on first run
- [ ] `commit-results` produced a follow-up commit refreshing the artifacts

**Chunk 4 complete. CI is live, every PR now produces full evidence. Proceed to Chunk 5.**

---

## Chunk 5: `/accessibility` page + footer link

**Why fifth:** Last because it consumes everything: the generated `conformance.generated.ts` module (Chunk 3), the test-run artifacts now committed by CI (Chunk 4), the VPAT + Annex F HTML files (Chunk 3). It's pure presentation; no new tests to run, no new CSS tokens to invent.

**Deliverables (Chunk 5):**
- `apps/site/src/pages/accessibility.astro` — 10-section audit page
- 5 new components under `apps/site/src/components/` (matrix, exceptions, audit-yourself, test-runs table, JAWS log)
- `apps/site/src/lib/test-run-artifacts.ts` — build-time file reader for `docs/accessibility/test-runs/`
- Footer link wired in `apps/site/src/layouts/Base.astro`
- `conformance.yaml` entries for WCAG 1.3.1 + 2.4.1 + 2.4.6 + 2.4.7 (anchors point to the new components' markup)

**End-state proof after Chunk 5:**
- `bun run --cwd apps/site dev` → visit `/accessibility` → page renders, matrix shows 86 rows, click-through evidence works
- Every page footer carries the "Accessibility →" link
- A push to main rebuilds the site, deploys to Vercel, and `https://falsafa.ai/accessibility` is live

### Task 33b: Wire `docs/accessibility/` into the Astro public dir

**Why this matters:** The `/accessibility` page (Task 34) and its components link to `/docs/accessibility/vpat-v1.0.html`, `/docs/accessibility/test-runs/...`, etc. Those files live in the repo's `docs/` directory — **outside** `apps/site/public/`. Astro will not serve them by default. Without this task, every download link and audio player on the rendered `/accessibility` page will 404.

**Files:**
- Create: `apps/site/scripts/prepare-a11y-artifacts.ts`
- Modify: `apps/site/package.json` (extend `predev` + `prebuild`)

- [ ] **Step 1: Implement the copy/symlink script**

```ts
#!/usr/bin/env bun
// apps/site/scripts/prepare-a11y-artifacts.ts
// Mirror docs/accessibility/ into apps/site/public/docs/accessibility/
// so the /accessibility page can link to its own artifacts via /docs/... URLs.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const src = resolve(repoRoot, "docs/accessibility");
const dst = resolve(repoRoot, "apps/site/public/docs/accessibility");

if (!existsSync(src)) {
  console.warn(`No accessibility docs at ${src}; skipping mirror.`);
  process.exit(0);
}

if (existsSync(dst)) rmSync(dst, { recursive: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`Mirrored ${src} → ${dst}`);
```

- [ ] **Step 2: Wire the script into predev + prebuild**

Edit `apps/site/package.json`:

```diff
   "scripts": {
-    "predev": "bun run scripts/prepare-covers.ts && bun run scripts/prepare-corpus.ts && bun run scripts/build-paragraph-index.ts",
-    "prebuild": "bun run scripts/prepare-covers.ts && bun run scripts/prepare-corpus.ts && bun run scripts/build-paragraph-index.ts",
+    "predev": "bun run scripts/prepare-covers.ts && bun run scripts/prepare-corpus.ts && bun run scripts/build-paragraph-index.ts && bun run scripts/prepare-a11y-artifacts.ts",
+    "prebuild": "bun run scripts/prepare-covers.ts && bun run scripts/prepare-corpus.ts && bun run scripts/build-paragraph-index.ts && bun run scripts/prepare-a11y-artifacts.ts",
+    "prepare-a11y-artifacts": "bun run scripts/prepare-a11y-artifacts.ts",
     ...
   }
```

- [ ] **Step 3: Add the mirrored directory to gitignore**

The mirror is build output; don't commit it:

```diff
 # Local config — never commit (contains DB credentials)
 .claude/
 .superpowers/
+# Mirrored a11y artifacts (built from docs/accessibility/ on every build)
+apps/site/public/docs/
```

- [ ] **Step 4: Smoke test**

Run: `bun run --cwd apps/site prepare-a11y-artifacts`
Expected: `Mirrored .../docs/accessibility → .../apps/site/public/docs/accessibility`. Verify `apps/site/public/docs/accessibility/conformance.yaml` exists.

Run: `bun run --cwd apps/site build`
Expected: build succeeds; `apps/site/dist/docs/accessibility/` contains the mirrored tree.

- [ ] **Step 5: Commit**

```bash
git add apps/site/scripts/prepare-a11y-artifacts.ts apps/site/package.json .gitignore
git commit -m "feat(a11y): mirror docs/accessibility/ into Astro public dir for serving"
```

### Task 34: `/accessibility` page skeleton

**Files:**
- Create: `apps/site/src/pages/accessibility.astro`

- [ ] **Step 1: Create the page**

```astro
---
// apps/site/src/pages/accessibility.astro
import Base from "../layouts/Base.astro";
import { CONFORMANCE } from "../lib/conformance.generated";
import { latestRuns } from "../lib/test-run-artifacts";
import ConformanceMatrix from "../components/ConformanceMatrix.astro";
import AccessibilityExceptions from "../components/AccessibilityExceptions.astro";
import AuditYourself from "../components/AuditYourself.astro";
import AccessibilityTestRuns from "../components/AccessibilityTestRuns.astro";
import JawsLog from "../components/JawsLog.astro";

const meta = CONFORMANCE.meta;
const totalCriteria = CONFORMANCE.criteria.length;
const supportedAAA = CONFORMANCE.criteria.filter(c => c.level === "AAA" && c.status === "supports").length;
const runs = await latestRuns();
---

<Base title="Accessibility — Falsafa" description="WCAG 2.2 AA conformance with continuous verification.">
  <main id="main" class="a11y-page">
    <header>
      <h1>Accessibility</h1>
      <p class="lede">
        Falsafa conforms to <strong>{meta.standard} Level {meta.conformance_level}</strong>,
        with AAA on {supportedAAA} of 31 AAA criteria. Conformance is verified
        on every pull request and any reviewer can independently regenerate
        every artifact on this page.
      </p>
      <p>
        <a href="/docs/accessibility/vpat-v1.0.html">Download VPAT 2.5 INT (HTML)</a> ·
        <a href="/docs/accessibility/statement-en301549.html">EN 301 549 Annex F statement (HTML)</a>
      </p>
      <p class="meta">
        Last verified: <time>{runs.latestTimestamp ?? "—"}</time> ·
        commit <code>{runs.latestSha ?? "—"}</code>
      </p>
    </header>

    <section aria-labelledby="prefs-pointer">
      <h2 id="prefs-pointer">Reading preferences</h2>
      <p>
        Your operating-system settings (color scheme, contrast, motion) are
        honored automatically. Explicit per-site controls (font size, theme
        picker) will land in a follow-up release.
      </p>
    </section>

    <section aria-labelledby="audit-self">
      <h2 id="audit-self">Audit yourself</h2>
      <AuditYourself />
    </section>

    <section aria-labelledby="matrix">
      <h2 id="matrix">Conformance matrix — WCAG 2.2 ({totalCriteria} criteria)</h2>
      <ConformanceMatrix doc={CONFORMANCE} />
    </section>

    <section aria-labelledby="exceptions">
      <h2 id="exceptions">Documented exceptions</h2>
      <AccessibilityExceptions doc={CONFORMANCE} />
    </section>

    <section aria-labelledby="methodology">
      <h2 id="methodology">Methodology</h2>
      <p>
        Three CI jobs run on every pull request: static checks (axe-core +
        pa11y + token-contrast audit on Ubuntu), Playwright synthetic
        transcripts (Ubuntu), and real screen-reader transcripts via
        Guidepup — VoiceOver on macOS, NVDA on Windows. Each journey
        produces a JSON result, a Markdown transcript, screenshots, an MP4
        UI capture, and an MP3 of the screen reader's voice. Artifacts
        commit back to <code>docs/accessibility/test-runs/</code> on every
        push to main. Manual JAWS verification is performed before each
        major release; entries below.
      </p>
    </section>

    <section aria-labelledby="frameworks">
      <h2 id="frameworks">Section 508 + EN 301 549 mappings</h2>
      <details>
        <summary>Section 508 functional performance criteria</summary>
        <ul>
          {CONFORMANCE.section_508.map(e => (
            <li>
              <strong>{e.id} {e.name}</strong> — {e.status} — {e.notes}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>EN 301 549 v3.2.1 clauses 5-13</summary>
        <ul>
          {CONFORMANCE.en_301_549.map(e => (
            <li>
              <strong>Clause {e.clause} {e.name}</strong> — {e.status} — {e.notes}
            </li>
          ))}
        </ul>
      </details>
    </section>

    <section aria-labelledby="runs">
      <h2 id="runs">Recent test runs</h2>
      <AccessibilityTestRuns runs={runs.recent} />
    </section>

    <section aria-labelledby="jaws">
      <h2 id="jaws">Manual JAWS verification</h2>
      <JawsLog />
    </section>

    <section aria-labelledby="report">
      <h2 id="report">Report an accessibility issue</h2>
      <p>
        Email <a href={`mailto:${meta.contact}`}>{meta.contact}</a> or open
        a GitHub issue at
        <a href="https://github.com/adoistic/falsafa/issues/new?labels=accessibility">
          github.com/adoistic/falsafa
        </a>.
        We aim to respond within 5 business days.
      </p>
    </section>
  </main>
</Base>

<style>
  .a11y-page { max-width: 880px; margin: 2rem auto; padding: 0 1rem; }
  .a11y-page .lede { font-size: 1.15rem; }
  .a11y-page .meta { color: var(--ink-muted); font-size: 0.9rem; }
  .a11y-page section { margin-block: 2.5rem; }
  .a11y-page h2 { border-bottom: 1px solid var(--rule); padding-bottom: 0.25rem; }
</style>
```

- [ ] **Step 2: Commit (page won't build yet — components don't exist)**

This task lands the skeleton; the components in Tasks 35-39 fill it in. Commit a minimal version that compiles by stubbing the imports:

```astro
---
// Temporary stubs until Tasks 35-39 land
---
```

Or commit a `// @ts-expect-error` shim and resolve in the next tasks. The implementer's choice; the simplest is to commit the page + stub each component to a single `<div>{doc.criteria.length} criteria</div>` so the build passes, then flesh out per task.

### Task 35: ConformanceMatrix component

**Files:**
- Create: `apps/site/src/components/ConformanceMatrix.astro`

- [ ] **Step 1: Create the component**

```astro
---
// apps/site/src/components/ConformanceMatrix.astro
import type { ConformanceDoc, ConformanceCriterion } from "../lib/conformance.generated";

interface Props {
  doc: ConformanceDoc;
}

const { doc } = Astro.props;

const principles: Record<string, ConformanceCriterion[]> = {
  "1. Perceivable": doc.criteria.filter(c => c.id.startsWith("1.")),
  "2. Operable": doc.criteria.filter(c => c.id.startsWith("2.")),
  "3. Understandable": doc.criteria.filter(c => c.id.startsWith("3.")),
  "4. Robust": doc.criteria.filter(c => c.id.startsWith("4.")),
};

const statusIcon: Record<string, string> = {
  supports: "✓",
  partial: "◐",
  "not-applicable": "⊘",
  "does-not-support": "✗",
};
---

<div class="matrix">
  {Object.entries(principles).map(([principle, items]) => (
    <details open>
      <summary><h3>{principle} <span class="count">({items.length})</span></h3></summary>
      <table>
        <thead>
          <tr>
            <th scope="col">SC</th>
            <th scope="col">Name</th>
            <th scope="col">Level</th>
            <th scope="col">Status</th>
            <th scope="col">Notes &amp; evidence</th>
          </tr>
        </thead>
        <tbody>
          {items.map(c => (
            <tr class={`row-${c.status}`}>
              <th scope="row"><code>{c.id}</code></th>
              <td>{c.name}</td>
              <td>{c.level}</td>
              <td>
                <span aria-hidden="true">{statusIcon[c.status]}</span>
                <span>{c.status}{c.exception ? ` (${c.exception})` : ""}</span>
              </td>
              <td>
                <p>{c.notes}</p>
                {(c.evidence ?? []).length > 0 && (
                  <details>
                    <summary>Proof ({(c.evidence ?? []).length})</summary>
                    <ul>
                      {(c.evidence ?? []).map(ev => (
                        <li>
                          <code>{ev.kind}</code>: <code>{ev.path}{ev.lines ? `:${ev.lines}` : ev.anchor ? ` (${ev.anchor})` : ""}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  ))}
</div>

<style>
  .matrix table { width: 100%; border-collapse: collapse; margin-block: 1rem; font-size: 0.95em; }
  .matrix th, .matrix td { padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
  .matrix th { background: var(--paper); }
  .matrix .row-supports { color: var(--ink); }
  .matrix .row-not-applicable { color: var(--ink-muted); }
  .matrix .row-does-not-support { color: var(--accent); }
  .matrix .count { color: var(--ink-muted); font-weight: normal; font-size: 0.9em; }
  .matrix details summary { cursor: pointer; }
</style>
```

- [ ] **Step 2: Verify the matrix renders**

Run: `bun run --cwd apps/site dev`. Visit `/accessibility`. The matrix should render 4 collapsible groups summing to 86 rows.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/components/ConformanceMatrix.astro
git commit -m "feat(a11y-page): ConformanceMatrix component (4 principle groups)"
```

### Task 36: AccessibilityExceptions component

**Files:**
- Create: `apps/site/src/components/AccessibilityExceptions.astro`

- [ ] **Step 1: Create the component**

```astro
---
// apps/site/src/components/AccessibilityExceptions.astro
import type { ConformanceDoc } from "../lib/conformance.generated";

interface Props { doc: ConformanceDoc; }
const { doc } = Astro.props;

const exceptions = doc.criteria.filter(c => c.status === "not-applicable" && c.exception);
const contentTypeExceptions = exceptions.filter(c => c.exception === "content-type");
const otherExceptions = exceptions.filter(c => c.exception !== "content-type");
---

<div class="exceptions">
  {contentTypeExceptions.length > 0 && (
    <article aria-labelledby="ct-exc">
      <h3 id="ct-exc">Content-type exceptions</h3>
      <p>
        Falsafa publishes graduate-level primary-source philosophy across
        six languages. The following AAA criteria are content-type
        exceptions; they would require rewriting the corpus and contradict
        the project's editorial purpose.
      </p>
      {contentTypeExceptions.map(c => (
        <div class="exception" role="note">
          <strong>WCAG {c.id} {c.name} (Level {c.level})</strong>
          <p>{c.notes}</p>
        </div>
      ))}
    </article>
  )}

  {otherExceptions.length > 0 && (
    <article aria-labelledby="other-exc">
      <h3 id="other-exc">Other documented exceptions</h3>
      {otherExceptions.map(c => (
        <div class="exception" role="note">
          <strong>WCAG {c.id} {c.name} (Level {c.level})</strong> — {c.exception}
          <p>{c.notes}</p>
        </div>
      ))}
    </article>
  )}
</div>

<style>
  .exceptions .exception {
    background: color-mix(in oklab, var(--accent) 8%, var(--paper));
    border-left: 3px solid var(--accent);
    padding: 0.75rem 1rem;
    margin-block: 0.75rem;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add apps/site/src/components/AccessibilityExceptions.astro
git commit -m "feat(a11y-page): AccessibilityExceptions component"
```

### Task 37: AuditYourself component

**Files:**
- Create: `apps/site/src/components/AuditYourself.astro`

- [ ] **Step 1: Create the component**

```astro
---
// apps/site/src/components/AuditYourself.astro
---

<div class="audit-yourself">
  <p><strong>Verify every claim on this page in 90 seconds.</strong></p>
  <pre><code>git clone https://github.com/adoistic/falsafa
cd falsafa &amp;&amp; bun install
bun run a11y</code></pre>
  <p>
    This runs the same axe-core + pa11y + Playwright + token-contrast
    audit + conformance verifier that produced the artifacts linked
    elsewhere on this page. Bit-identical output expected.
  </p>
  <p>
    Real screen-reader verification (VoiceOver + NVDA via Guidepup) runs
    in CI on macOS + Windows runners. Clone the repo, push a branch, and
    GitHub Actions will produce your own copies of the artifacts.
  </p>
  <p>
    <a href="https://github.com/adoistic/falsafa/blob/main/docs/superpowers/plans/2026-05-14-accessibility-v1.md">
      How the tests work (implementation plan) →
    </a>
  </p>
</div>

<style>
  .audit-yourself pre {
    background: var(--paper);
    border: 1px solid var(--rule);
    padding: 1rem;
    overflow-x: auto;
    font-size: 0.9em;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add apps/site/src/components/AuditYourself.astro
git commit -m "feat(a11y-page): AuditYourself component"
```

### Task 38: Test-runs table + filesystem reader

**Files:**
- Create: `apps/site/src/lib/test-run-artifacts.ts`
- Create: `apps/site/src/components/AccessibilityTestRuns.astro`

- [ ] **Step 1: Implement the filesystem reader (build-time only)**

```ts
// apps/site/src/lib/test-run-artifacts.ts
// Reads docs/accessibility/test-runs/ at Astro build time.
// Returns the 10 most recent runs across all journeys.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface TestRun {
  journey: string;
  sha: string;
  timestamp: number; // file mtime ms
  hasTranscriptSynthetic: boolean;
  hasTranscriptVoiceOver: boolean;
  hasTranscriptNvda: boolean;
  hasAudioVoiceOver: boolean;
  hasAudioNvda: boolean;
  hasVideo: boolean;
}

export interface TestRunSummary {
  recent: TestRun[];
  latestTimestamp: string | null;
  latestSha: string | null;
}

export async function latestRuns(): Promise<TestRunSummary> {
  // Resolve relative to this file's URL so the path works regardless of build CWD.
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../../../docs/accessibility/test-runs", import.meta.url));
  if (!existsSync(root)) return { recent: [], latestTimestamp: null, latestSha: null };

  const all: TestRun[] = [];
  for (const journey of readdirSync(root)) {
    const jDir = join(root, journey);
    if (!statSync(jDir).isDirectory()) continue;
    for (const sha of readdirSync(jDir)) {
      const sDir = join(jDir, sha);
      if (!statSync(sDir).isDirectory()) continue;
      const has = (f: string) => existsSync(join(sDir, f));
      all.push({
        journey,
        sha,
        timestamp: statSync(sDir).mtimeMs,
        hasTranscriptSynthetic: has("transcript-synthetic.md"),
        hasTranscriptVoiceOver: has("transcript-voiceover.md"),
        hasTranscriptNvda: has("transcript-nvda.md"),
        hasAudioVoiceOver: has("audio-voiceover.mp3"),
        hasAudioNvda: has("audio-nvda.mp3"),
        hasVideo: has("video.mp4"),
      });
    }
  }
  all.sort((a, b) => b.timestamp - a.timestamp);
  const latest = all[0];
  return {
    recent: all.slice(0, 10),
    latestTimestamp: latest ? new Date(latest.timestamp).toISOString() : null,
    latestSha: latest?.sha ?? null,
  };
}
```

- [ ] **Step 2: Implement the AccessibilityTestRuns component**

```astro
---
// apps/site/src/components/AccessibilityTestRuns.astro
import type { TestRun } from "../lib/test-run-artifacts";

interface Props { runs: TestRun[]; }
const { runs } = Astro.props;
---

{runs.length === 0 ? (
  <p>No CI test runs yet. They will appear here after the first push to main.</p>
) : (
  <table class="runs">
    <thead>
      <tr>
        <th scope="col">Journey</th>
        <th scope="col">Commit</th>
        <th scope="col">Time</th>
        <th scope="col">Artifacts</th>
      </tr>
    </thead>
    <tbody>
      {runs.map(r => (
        <tr>
          <th scope="row"><code>{r.journey}</code></th>
          <td><code>{r.sha.slice(0, 7)}</code></td>
          <td><time datetime={new Date(r.timestamp).toISOString()}>{new Date(r.timestamp).toISOString().slice(0, 10)}</time></td>
          <td>
            <ul class="run-artifacts">
              {r.hasTranscriptSynthetic && <li><a href={`/docs/accessibility/test-runs/${r.journey}/${r.sha}/transcript-synthetic.md`}>synthetic.md</a></li>}
              {r.hasTranscriptVoiceOver && <li><a href={`/docs/accessibility/test-runs/${r.journey}/${r.sha}/transcript-voiceover.md`}>VoiceOver.md</a></li>}
              {r.hasTranscriptNvda && <li><a href={`/docs/accessibility/test-runs/${r.journey}/${r.sha}/transcript-nvda.md`}>NVDA.md</a></li>}
              {r.hasAudioVoiceOver && <li><a href={`/docs/accessibility/test-runs/${r.journey}/${r.sha}/audio-voiceover.mp3`}>VoiceOver.mp3</a></li>}
              {r.hasAudioNvda && <li><a href={`/docs/accessibility/test-runs/${r.journey}/${r.sha}/audio-nvda.mp3`}>NVDA.mp3</a></li>}
              {r.hasVideo && <li><a href={`/docs/accessibility/test-runs/${r.journey}/${r.sha}/video.mp4`}>video.mp4</a></li>}
            </ul>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)}

<style>
  .runs { width: 100%; border-collapse: collapse; font-size: 0.95em; }
  .runs th, .runs td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
  .run-artifacts { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .run-artifacts li { font-size: 0.85em; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/lib/test-run-artifacts.ts apps/site/src/components/AccessibilityTestRuns.astro
git commit -m "feat(a11y-page): test-runs table + filesystem reader"
```

### Task 39: JAWS log component

**Files:**
- Create: `apps/site/src/components/JawsLog.astro`

- [ ] **Step 1: Implement the component**

```astro
---
// apps/site/src/components/JawsLog.astro
// Reads docs/accessibility/manual-tests/jaws-log.yaml at build time.
import { parse } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface JawsSession {
  date: string;
  jaws_version: string;
  tester: string;
  notes: string;
  result: "pass" | "fail" | "partial";
}

const logPath = (() => {
  const { fileURLToPath } = require("node:url");
  return fileURLToPath(new URL("../../../../docs/accessibility/manual-tests/jaws-log.yaml", import.meta.url));
})();
const log = existsSync(logPath)
  ? (parse(readFileSync(logPath, "utf8")) as { sessions: JawsSession[] })
  : { sessions: [] };
---

{log.sessions.length === 0 ? (
  <p>
    No JAWS verification sessions on record yet. Manual JAWS verification
    is performed before any major customer demo and logged here. JAWS is a
    paid, closed-source screen reader; we do not run it in automated CI.
    See <a href="https://www.freedomscientific.com/products/software/jaws/">JAWS at Freedom Scientific</a>.
  </p>
) : (
  <table class="jaws-log">
    <thead>
      <tr>
        <th scope="col">Date</th>
        <th scope="col">JAWS version</th>
        <th scope="col">Tester</th>
        <th scope="col">Notes</th>
        <th scope="col">Result</th>
      </tr>
    </thead>
    <tbody>
      {log.sessions.map(s => (
        <tr>
          <th scope="row"><time>{s.date}</time></th>
          <td>{s.jaws_version}</td>
          <td>{s.tester}</td>
          <td>{s.notes}</td>
          <td>{s.result}</td>
        </tr>
      ))}
    </tbody>
  </table>
)}

<style>
  .jaws-log { width: 100%; border-collapse: collapse; font-size: 0.95em; }
  .jaws-log th, .jaws-log td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--rule); text-align: left; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add apps/site/src/components/JawsLog.astro
git commit -m "feat(a11y-page): JawsLog component (manual verification log renderer)"
```

### Task 40: Footer link in Base layout

**Files:**
- Modify: `apps/site/src/layouts/Base.astro`

- [ ] **Step 1: Identify the footer block**

Run: `grep -n "<footer\|</footer\|Source acknowledgements\|About\|/about" apps/site/src/layouts/Base.astro | head -20`

Locate the footer's link list.

- [ ] **Step 2: Insert the `/accessibility` link**

Add an `Accessibility →` link between "Source acknowledgements" and "About" (or wherever the existing footer pattern slots policy/info links):

```diff
   <a href="/source-acknowledgements">Source acknowledgements</a>
+  <a href="/accessibility">Accessibility</a>
   <a href="/about">About</a>
```

(The exact markup depends on the existing footer — match the surrounding `<li>` / `<a>` pattern.)

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/layouts/Base.astro
git commit -m "feat(a11y): footer link to /accessibility on every page"
```

### Task 41: Update conformance YAML with new evidence anchors

**Files:**
- Modify: `docs/accessibility/conformance.yaml`

Now that the `/accessibility` page and its supporting components exist, several WCAG criteria gain new evidence anchors. Update:

- [ ] **Step 1: Add evidence to 1.3.1, 2.4.1, 2.4.6, 2.4.7**

```yaml
  - id: "1.3.1"
    name: Info and Relationships
    level: A
    status: supports
    notes: >
      Semantic HTML throughout — header/main/nav/footer/article landmarks,
      heading hierarchy h1→h6, <table> with <th scope> in the conformance
      matrix, <dl>/<dt>/<dd> for description lists, <details>/<summary>
      for collapsibles.
    evidence:
      - kind: source
        path: apps/site/src/components/ConformanceMatrix.astro
        anchor: 'scope="col"'
      - kind: source
        path: apps/site/src/layouts/Base.astro
        anchor: "<main"
      - kind: artifact
        path: docs/accessibility/test-runs/homepage/latest/transcript-synthetic.md
    commit: HEAD

  - id: "2.4.1"
    name: Bypass Blocks
    level: A
    status: supports
    notes: >
      Skip-link on every page targets <main id="main">. Skip-link is
      visible on focus and reaches main in one keystroke.
    evidence:
      - kind: source
        path: apps/site/src/layouts/Base.astro
        anchor: 'href="#main"'
      - kind: artifact
        path: docs/accessibility/test-runs/homepage/latest/transcript-synthetic.md
    commit: HEAD

  - id: "2.4.6"
    name: Headings and Labels
    level: AA
    status: supports
    notes: >
      Every page has a single h1. Subsections use h2 with aria-labelledby
      pointers from <section>. Form inputs have explicit <label>.
    evidence:
      - kind: source
        path: apps/site/src/pages/accessibility.astro
        anchor: 'aria-labelledby'
    commit: HEAD

  - id: "2.4.7"
    name: Focus Visible
    level: AA
    status: supports
    notes: >
      Site-wide :focus-visible style produces a high-contrast ring.
      (Enhanced 2.4.13 AAA focus appearance audit is V2 scope.)
    evidence:
      - kind: source
        path: apps/site/src/styles/global.css
        anchor: ":focus-visible"
    commit: HEAD
```

- [ ] **Step 2: Run the verifier**

Run: `bun run a11y:verify`
Expected: PASS. All new anchors resolve.

- [ ] **Step 3: Regenerate the matrix module**

Run: `bun a11y:generate matrix && bun a11y:generate vpat && bun a11y:generate annex-f`
Expected: three `Generated …` lines. The `/accessibility` page reflects the new evidence after next page reload.

- [ ] **Step 4: Commit**

```bash
git add docs/accessibility/conformance.yaml apps/site/src/lib/conformance.generated.ts docs/accessibility/vpat-v1.0.html docs/accessibility/statement-en301549.html
git commit -m "feat(a11y): evidence for 1.3.1, 2.4.1, 2.4.6, 2.4.7"
```

### Task 42: Final end-to-end smoke test

- [ ] **Step 1: Build the site**

Run: `bun run --cwd apps/site build`
Expected: build succeeds, no errors, no broken imports.

- [ ] **Step 2: Preview the build**

Run: `bun run --cwd apps/site preview`
Visit:
- `/accessibility` — renders, matrix shows 86 rows + 9 + 7, audit-yourself code block visible, recent-runs table populated
- `/` — footer link to `/accessibility` present
- `/works/bang-i-dara/01/original/` — `lang="ur-Arab" dir="rtl"` in DOM
- Cmd+K — search dialog opens, ↓/↑ navigate results, Enter opens result
- Set OS to dark mode in macOS System Settings → site renders dark
- Set OS to "Increase contrast" → site renders with higher-contrast tokens

- [ ] **Step 3: Run the full local a11y suite**

```bash
bun run --cwd apps/site dev &
DEV_PID=$!
sleep 5
bun run a11y
kill $DEV_PID
```

Expected: contrast PASS, verify PASS, pa11y PASS, synthetic PASS.

- [ ] **Step 4: Push to main and watch CI**

```bash
git push
```

Watch GitHub Actions. All four jobs (static, synthetic, voiceover, nvda) green. `commit-results` produces a follow-up commit. The `/accessibility` page now reflects the live CI run.

- [ ] **Step 5: V1 complete**

V1 is now live. The conformance claim is defensible across India, EU, and US standards, with continuously regenerated proof. The seed script `scripts/seed-wcag22.ts` may be deleted in a follow-up commit; it was one-shot.

**End of V1. The next chunk (chrome `Aa` picker, focus-appearance AAA, target-size AAA, glossary popovers) is V2 — a separate spec and plan.**

---

## After all chunks land

1. Open a PR from this branch into `main`.
2. CI runs all four jobs on the PR. Reviewers can download artifacts.
3. Merge. The `commit-results` job runs on main, refreshes artifacts, regenerates VPAT + Annex F + matrix module, and commits with `[skip ci]`.
4. Vercel auto-deploys. `https://falsafa.ai/accessibility` is live.
5. Delete `scripts/seed-wcag22.ts` in a follow-up if desired (it was one-shot bootstrap).
6. Brainstorm V2 (chrome picker + AAA polish bundle) in a new session.

The /accessibility page link is ready to share with government clients.

**Estimated total implementation time:** ~5 days for a developer comfortable with Astro + Playwright. The CI debug loop on the macOS/Windows runners may add ~half a day if Guidepup setup has rough edges.
