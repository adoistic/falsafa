# `/try/` Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-cards-side-by-side layout on `/try/` with two outer CSS-`:target` tabs (Install default, BYOK secondary).

**Architecture:** Single-file edit. Markup change to `apps/site/src/pages/try/index.astro` swaps the existing `try-hero` grid for a tab nav + two stacked `<section>` panels. CSS rules added inline in the same file's `<style>` block. Pattern matches the eval case detail tabs at `apps/site/src/pages/eval/[id].astro` and `apps/site/src/styles/eval.css`. The `<InstallCard>`'s inner ARIA tabs and the `<ByokDemo>` Preact island stay untouched.

**Tech Stack:** Astro 5 page, plain CSS with `color-mix(in oklch, ...)` and `body:has(:target)`. Zero new JS for the outer tabs.

**Spec:** `docs/superpowers/specs/2026-05-01-try-page-redesign-design.md` (spec-reviewer Approved + 4 advisories applied; 5 sections cover structure, CSS, header copy, mobile, trailing chrome).

---

## Pre-flight

Things the implementer should know before opening the file:

1. **The file is fully self-contained.** `apps/site/src/pages/try/index.astro` has its own `<style>` block at the bottom (lines 93–181 in current code) with all of today's `try-page` / `try-header` / `try-hero` / `try-byok-card` / `try-clone` styles. The new tab CSS goes in the SAME `<style>` block, no separate stylesheet.
2. **Don't import `eval.css`.** The eval-case `:target` rules use `body:has(#case-wiki:target)` — those selectors are scoped to the eval-case ID convention. The `/try/` tabs use their own panel IDs (`#panel-install` / `#panel-byok`) so there's no risk of cross-page interference, but also no reason to share a stylesheet.
3. **The `chips={CHIPS}` prop.** The frontmatter at the top of `try/index.astro` already declares `const CHIPS = [...]` with 12 hand-picked questions. Reuse it as-is in the BYOK section. No new constant.
4. **Don't strip the BYOK card-head wrapper.** Spec Section 2 removes the `<h2>Try it now (BYOK)</h2>` element but keeps the surrounding `<header class="try-byok-card-head">` element with its `<p>Bring your own API key. Stays in the browser.</p>` inside. The wrapper class drives existing margin/padding.
5. **`InstallCard` and `ByokDemo` are unchanged.** `apps/site/src/components/InstallCard.astro` and `apps/site/src/islands/byok/ByokDemo.tsx` are not edited in this plan. The InstallCard's inner ARIA tabs (Claude Desktop / Claude Code / Cursor / Codex) continue to work because they live inside the new `<section id="panel-install">`.
6. **Manual smoke is the verification.** No new automated tests — the spec is presentation-layer. Existing `bun test` should keep passing (143 tests at the time this plan was written; if the count has drifted before you start implementing, take the new count as the baseline and verify "no regression vs baseline" rather than "still 143").
7. **Dev server is probably already running** at `http://localhost:4321/try/`. If not, start it with `cd apps/site && bun run dev`.

---

## File structure

| File | Status | Responsibility |
|------|--------|----------------|
| `apps/site/src/pages/try/index.astro` | MODIFIED | Header copy (h1 + lede + `<Base description={…}>`), markup swap (`try-hero` grid → tab nav + panels), inline CSS for tabs + panels |

That's it. One file. ~50 lines added, ~15 lines removed, net ~+35 lines.

---

## Chunk 1: `/try/` page redesign

### Task 1: Header copy revision

Smallest, lowest-risk change. Doesn't depend on tab structure. Lands first.

**Files:**
- Modify: `apps/site/src/pages/try/index.astro:31-65` (the `<Base>` opening tag and the `<header class="try-header">` block)

- [ ] **Step 1: Read the current header**

```bash
sed -n '31,65p' apps/site/src/pages/try/index.astro
```

Confirm you see:
- `<Base title="Try" description="Install Falsafa as an MCP in your daily LLM, or try it live in the browser with your own API key. The same librarian tools, the same corpus.">`
- `<h1>Run Falsafa on your terms</h1>`
- The lede starting `Install the MCP into your daily LLM, or paste an API key…`

- [ ] **Step 2: Update the `<Base description={…}>` string**

Replace the existing description (a single long string) with:

```astro
<Base
  title="Try"
  description="One npx command wires Falsafa into Claude Desktop, Claude Code, Cursor, or Codex. Or skip the install and try it live in the browser with your own API key."
>
```

- [ ] **Step 3: Update the H1 and lede**

Find the `<header class="try-header">` block. Replace the `<h1>` and `<p class="lede">` content with:

```astro
<header class="try-header">
  <p class="kicker">Try</p>
  <h1>Run Falsafa in your daily LLM</h1>
  <p class="lede">
    One <code>npx</code> command wires Falsafa into Claude Desktop,
    Claude Code, Cursor, or Codex. Or skip the install and try it
    live in the browser with your own API key.
  </p>
</header>
```

The kicker (`<p class="kicker">Try</p>`) stays unchanged.

- [ ] **Step 4: Run the build to confirm no Astro syntax errors**

Run: `cd apps/site && bun run build 2>&1 | tail -3`
Expected: clean build (no errors). If `astro check` complains about a JSX/Astro syntax issue, the most likely cause is an unescaped quote inside an attribute value — verify the description string uses straight double quotes around the attribute and no embedded quotes inside.

- [ ] **Step 5: Smoke-test the live dev server**

Open `http://localhost:4321/try/` in a browser (or `curl -s http://localhost:4321/try/ | grep -q "Run Falsafa in your daily LLM" && echo "PASS"` to verify rendered output).

Expected: the new H1 and lede render. The two-card grid below is unchanged at this point — Tasks 2 and 3 will replace it.

- [ ] **Step 6: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/site/src/pages/try/index.astro
git commit -m "feat(try): header copy leads with install path

Spec Section 3. The page is for power users who already run Claude
Desktop / Claude Code / Cursor / Codex; lead with the install path
and demote BYOK to a fallback. Updates the Base description meta
to match the new lede framing."
```

### Task 2: Replace `try-hero` grid with tab nav + panels (markup)

**Files:**
- Modify: `apps/site/src/pages/try/index.astro:67-77` (the `<div class="try-hero">…</div>` block)

The structural change. The grid disappears; the tab nav and two `<section>` panels take its place. CSS still styles the OLD class names until Task 3 — page renders unstyled tabs but DOM-correct.

- [ ] **Step 1: Read the current `try-hero` block**

```bash
sed -n '67,77p' apps/site/src/pages/try/index.astro
```

Confirm you see:

```astro
<div class="try-hero">
  <InstallCard />

  <div class="try-byok-card">
    <header class="try-byok-card-head">
      <h2>Try it now (BYOK)</h2>
      <p>Bring your own API key. Stays in the browser.</p>
    </header>
    <ByokDemo client:only="preact" chips={CHIPS} />
  </div>
</div>
```

- [ ] **Step 2: Replace with tab nav + panels**

Replace the entire block (the `<div class="try-hero">` open through its closing `</div>`) with:

```astro
<nav class="try-tabs" role="tablist" aria-label="Run Falsafa">
  <a class="try-tab try-tab--install"
     id="tab-install"
     href="#panel-install"
     role="tab"
     aria-controls="panel-install"
     aria-selected="true">
    Install
  </a>
  <a class="try-tab try-tab--byok"
     id="tab-byok"
     href="#panel-byok"
     role="tab"
     aria-controls="panel-byok"
     aria-selected="false">
    Try in browser (BYOK)
  </a>
</nav>

<section id="panel-install"
         class="try-panel try-panel--install"
         role="tabpanel"
         aria-labelledby="tab-install">
  <InstallCard />
</section>

<section id="panel-byok"
         class="try-panel try-panel--byok"
         role="tabpanel"
         aria-labelledby="tab-byok">
  <header class="try-byok-card-head">
    <p>Bring your own API key. Stays in the browser.</p>
  </header>
  <ByokDemo client:only="preact" chips={CHIPS} />
</section>
```

Three things to notice:

- The `<div class="try-hero">` wrapper and the `<div class="try-byok-card">` wrapper are both gone.
- The BYOK panel's `<h2>Try it now (BYOK)</h2>` is removed (the tab label "Try in browser (BYOK)" names the section). The surrounding `<header class="try-byok-card-head">` element STAYS with the `<p>` inside it — the wrapper class can drive any existing margin/padding. The kept `<p>` is the only child of the header now.
- The `<InstallCard />` and `<ByokDemo … chips={CHIPS} />` references are byte-identical to before. No prop changes.

- [ ] **Step 3: Build to confirm no errors**

Run: `cd apps/site && bun run build 2>&1 | tail -3`
Expected: clean build. The page renders with tabs + panels but they're unstyled until Task 3 (both panels visible simultaneously, tab nav has no background).

- [ ] **Step 4: DOM smoke**

Run: `curl -s http://localhost:4321/try/ | grep -oE "panel-install|panel-byok|tab-install|tab-byok|try-tabs|try-panel" | sort -u`
Expected output (any order, all 6 lines):

```
panel-byok
panel-install
tab-byok
tab-install
try-panel
try-tabs
```

- [ ] **Step 5: Existing tests still pass**

Run: `cd apps/site && bun test 2>&1 | tail -3`
Expected: 143 pass, 0 fail. No test touches `/try/`, so this PR doesn't regress anything.

- [ ] **Step 6: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/site/src/pages/try/index.astro
git commit -m "feat(try): swap two-card grid for tab nav + panels markup

Spec Section 1 + 2 (markup half). Adds <nav class=\"try-tabs\"> with
two anchor-based tabs and two <section> panels with matching IDs.
CSS for the visual layer lands in the next commit. Until then the
DOM is correct but visually unstyled — both panels render
simultaneously."
```

### Task 3: Add CSS for outer tabs + panels (inline `<style>`)

**Files:**
- Modify: `apps/site/src/pages/try/index.astro:131-181` (the existing `<style>` block — append to the end)

The visual layer. Tabs become pill-shaped buttons; one panel visible at a time; `body:has(#panel-byok:target)` swaps state.

- [ ] **Step 1: Locate the bottom of the `<style>` block**

```bash
sed -n '125,181p' apps/site/src/pages/try/index.astro
```

Confirm the existing `</style>` close tag is around line 181. The new rules will be inserted just before that closing tag.

- [ ] **Step 2: Append the tab CSS**

Add the following BEFORE the closing `</style>`. The order of the rules matters — defaults first, `:target` overrides second, defensive `#panel-install:target` third:

```css
  /* ── A/B-style outer tabs (CSS :target, zero JS) ─────────────── */
  .try-tabs {
    display: inline-flex;
    gap: var(--s-1);
    margin: var(--s-4) 0 var(--s-6);
    flex-wrap: wrap;
  }
  .try-tab {
    padding: var(--s-2) var(--s-4);
    border: 1px solid var(--rule);
    border-radius: 999px;
    font-family: var(--font-sans);
    font-size: var(--fs-chrome);
    color: var(--ink);
    text-decoration: none;
    line-height: 1;
  }
  .try-tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Default state — Install visible, BYOK hidden, Install tab filled. */
  .try-tab--install { background: color-mix(in oklch, var(--ink) 6%, var(--paper)); }
  .try-tab--byok    { background: transparent; }
  .try-panel--install { display: block; }
  .try-panel--byok    { display: none; }

  /* When #panel-byok is the URL fragment, swap. */
  body:has(#panel-byok:target) .try-tab--install   { background: transparent; }
  body:has(#panel-byok:target) .try-tab--byok      { background: color-mix(in oklch, var(--accent) 6%, var(--paper)); }
  body:has(#panel-byok:target) .try-panel--install { display: none; }
  body:has(#panel-byok:target) .try-panel--byok    { display: block; }

  /* Defensive: if #panel-install is explicitly targeted, force default. */
  body:has(#panel-install:target) .try-tab--install   { background: color-mix(in oklch, var(--ink) 6%, var(--paper)); }
  body:has(#panel-install:target) .try-tab--byok      { background: transparent; }
  body:has(#panel-install:target) .try-panel--install { display: block; }
  body:has(#panel-install:target) .try-panel--byok    { display: none; }
```

Tints reuse the same `color-mix(in oklch, var(--ink) 6%, var(--paper))` for Install (warm grey, matches the eval scoreboard's baseline column) and `color-mix(in oklch, var(--accent) 6%, var(--paper))` for BYOK (faint accent blue, matches the wiki column).

- [ ] **Step 3: Remove now-unused styles**

The `try-hero` grid rules and `try-byok-card` rules are now dead code. Find and DELETE these blocks from the same `<style>` (they appear in lines 131–151 of the original file; the kept `.try-byok-card-head` rules sit immediately below at lines 152–160):

```css
  .try-hero {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--s-6);
    margin-bottom: var(--s-12);
  }

  @media (min-width: 768px) {
    .try-page {
      max-width: 90ch;
    }
    .try-hero {
      grid-template-columns: 1fr 1fr;
      gap: var(--s-8);
    }
  }

  .try-byok-card {
    border: 1px solid var(--rule);
    padding: var(--s-6);
  }
```

But KEEP this `.try-byok-card-head p` rule (it styles the kept `<p>Bring your own API key. Stays in the browser.</p>` inside the kept `<header class="try-byok-card-head">`):

```css
  .try-byok-card-head p {
    color: var(--ink-muted);
    margin: 0 0 var(--s-6);
  }
```

DELETE the `.try-byok-card-head h2` rule. After Task 2 there's no `<h2>` element inside `.try-byok-card-head`, so the rule has no DOM to match. Cleaner to drop it now than to leave dead code:

```css
  /* DELETE this rule (no longer matches any DOM after Task 2): */
  .try-byok-card-head h2 {
    font-family: var(--font-display);
    font-size: var(--fs-h2);
    margin: 0 0 var(--s-2);
  }
```

The `@media (min-width: 768px)` block deletion takes the desktop max-width override with it — that's fine because the page no longer has a two-column hero that needs more horizontal room. Mobile and desktop both use the inherited `max-width: 70ch` from `.try-page` (line 95), which reads cleanly with the single-panel-at-a-time tab layout.

- [ ] **Step 4: Build + visual smoke**

Run: `cd apps/site && bun run build 2>&1 | tail -3`
Expected: clean build.

Open `http://localhost:4321/try/`. Visually confirm:
- Tab nav at top, two pill-shaped tabs.
- Install tab is filled (warm grey background); BYOK tab is outlined.
- The `<InstallCard>` renders below the tabs (with its own inner Claude Desktop / Claude Code / Cursor / Codex tabs working).
- BYOK panel is hidden.

Click the BYOK tab. Confirm:
- URL becomes `/try/#panel-byok`.
- Install panel disappears.
- BYOK panel appears (provider list + paste-key UI).
- BYOK tab is filled (faint blue); Install tab is outlined.

Click Install tab. Confirm content swaps back, URL becomes `/try/#panel-install`, Install tab fills again.

- [ ] **Step 5: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/site/src/pages/try/index.astro
git commit -m "feat(try): CSS :target outer tabs + panel visibility swap

Spec Section 2 (CSS half). Default state: Install panel visible,
Install tab filled. body:has(#panel-byok:target) swaps both panel
visibility AND tab fill. Defensive #panel-install:target rule
forces default state when the fragment is explicit.

Removes the now-unused .try-hero grid + .try-byok-card rules and
the @media min-width:768px max-width override. Mobile and desktop
both inherit max-width: 70ch from .try-page."
```

### Task 4: Manual smoke + push

The verification gate. The spec's 11 smoke items run against the deployed dev server. Any failure means the prior tasks need a fix; don't push if any fail.

**Files:** none modified in this task.

- [ ] **Step 1: Final dev-server smoke (all 11 items from spec Section Testing)**

For each item, perform the action and mark PASS / FAIL. Don't proceed to push if any fail.

1. **Default load.** Open `/try/`. **Expected:** Install panel visible, BYOK hidden, Install tab filled, BYOK tab outlined.

2. **Click BYOK tab.** **Expected:** content swaps, URL hash becomes `#panel-byok`, BYOK tab fills, Install tab outlines.

3. **Click Install tab.** **Expected:** content swaps back, URL hash becomes `#panel-install`.

4. **Direct load `/try/#panel-byok`.** **Expected:** BYOK panel visible immediately on load, BYOK tab filled.

5. **Refresh on `#panel-byok`.** **Expected:** tab state preserved across refresh.

6. **Browser back/forward.** Click BYOK → click Install → press back. **Expected:** BYOK is restored. Press forward → Install is restored. (CSS `:target` honors browser history natively in evergreen browsers; no JS hashchange listener needed.)

7. **Mobile viewport (≤320px).** Use the browser's device emulation (or just resize the window narrow). **Expected:** both tabs fit on one row OR wrap onto two rows (the `flex-wrap: wrap` rule covers narrow viewports). Panels render full-width. No horizontal scroll. One panel visible at a time.

8. **Keyboard.** Tab into the tab nav with the keyboard. **Expected:** `:focus-visible` outline appears on the focused tab. Press Enter or Space — anchor follows the link, panel swaps.

9. **InstallCard inner tabs.** Click Claude Desktop / Claude Code / Cursor / Codex inside the Install panel. **Expected:** they still work (button-based JS tabs untouched by this PR).

10. **`<details>` and caveats.** Scroll below the active tab content. **Expected:** the `<details>Or clone & develop locally</details>` and `<NonDeterminismCaveat />` and `<ReportThis />` all render below the tab content, regardless of which outer tab is active.

11. **Existing tests.** Run `cd apps/site && bun test 2>&1 | tail -3`. **Expected:** 143 pass, 0 fail.

- [ ] **Step 2: Push to main**

If all 11 smoke items pass:

```bash
cd /Users/siraj/falsafa
git push origin main
```

Expected: clean push, commit count 3 (one per Task 1/2/3) above the previous HEAD.

- [ ] **Step 3: Verify deployed page (after CDN refresh)**

Once Vercel / your deploy redeploys (or if not yet deployed, skip), open the production `/try/` URL and walk Items 1, 2, 4 from Step 1 against production. If any fail in production but pass on dev, debug — most likely cause is a stale CSS cache.

---

## Done criteria

- `apps/site/src/pages/try/index.astro` has the new H1, lede, `<Base description>`, tab nav, and two `<section>` panels.
- The page's `<style>` block has the new tab CSS appended and the dead `try-hero` / `try-byok-card` rules removed.
- All 11 manual smoke items PASS.
- `bun test` still 143/143.
- `bun run build` clean.
- 3 commits on `main` (Task 1 + Task 2 + Task 3) above the prior HEAD.
- Push succeeded.

## Out of scope

Tracked as deferrals (NOT done in this PR):

- **`aria-selected` hashchange script.** The static `aria-selected="true"` on Install is correct on default load, technically wrong when on `#panel-byok`. Same trade-off as eval case detail. Tracked in `TODOS.md` under "Eval A/B UI follow-up: aria-selected hashchange script" — when that script lands it covers `/try/` automatically because the IDs follow the same convention.
- **Inner-tab refactor.** InstallCard's button-based ARIA tabs stay as-is. Replacing them with CSS `:target` would force nested `:target` selectors and isn't worth it for a v1.
- **Three-way tab including "Develop locally".** That path keeps its `<details>` disclosure below the tabs.
