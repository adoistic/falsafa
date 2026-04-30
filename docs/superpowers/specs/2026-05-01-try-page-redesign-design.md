# `/try/` Page Redesign — Design

**Status:** Spec, awaiting implementation plan.
**Author:** Adnan + Claude (brainstorming session 2026-05-01).
**Goal:** Stop the two-cards-side-by-side layout on `/try/`. The Install path and the BYOK demo currently compete for attention as equal peers; the page reads dense and unfriendly. Replace with a tabbed layout that defaults to Install (the power-user path, which is the actual primary audience right now) and demotes BYOK to a one-click-away secondary tab.

## Why

Today's `/try/` page (`apps/site/src/pages/try/index.astro`) renders two cards in a two-column grid above 768px:

- **Left:** `<InstallCard>` — "Install in your daily LLM" with its own inner ARIA tabs (Claude Desktop / Claude Code / Cursor / Codex), shipping config snippets per client.
- **Right:** `<ByokDemo>` Preact island — "Try it now (BYOK)" with provider list (OpenRouter / Anthropic / Google / OpenAI), paste-an-API-key field, and a live demo against the corpus.

Two issues:

1. **Visual density.** Two dense workflows side-by-side, each with their own internal navigation (InstallCard has 4 sub-tabs; BYOK has 4 providers). The reader's eye doesn't know where to land.
2. **Audience mismatch.** Falsafa doesn't yet ship consumer surfaces (no Claude.ai/ChatGPT integration). The realistic visitor right now is a developer who already runs Claude Desktop / Cursor / Codex / Claude Code and wants to add Falsafa as an MCP. A "curious newcomer" can't actually use the BYOK demo without first acquiring an OpenRouter / Anthropic / etc. API key — a non-trivial commitment. So presenting BYOK as a co-equal entry point sells against the actual user's path.

## Non-Goals

- **Replacing the InstallCard's inner ARIA tabs with CSS `:target`.** The inner tabs (Claude Desktop / Claude Code / Cursor / Codex) stay button-based with their existing inline JS. Two different tab implementations live on the page, but at different scopes — no user notices the inconsistency because the inner tabs only render inside the active outer Install tab.
- **Adding analytics or visit tracking** to the tab switch. YAGNI.
- **A third "Develop locally" tab.** That path keeps its existing `<details>` disclosure below the tabs — it's tertiary, not a peer.
- **Fixing the static `aria-selected` mismatch on `:target` tabs.** Same trade-off the eval case detail page has — `aria-selected="true"` is correct on default load, technically wrong when on `#byok`. Tracked separately as a single follow-up that fixes both surfaces at once with a small hashchange script.
- **Restructuring the BYOK demo internals.** The `<ByokDemo>` Preact island stays as-is; only its container/wrapper changes.

## Architecture overview

One file modified, two CSS class groups added. No data-model changes, no new components.

### `apps/site/src/pages/try/index.astro`

- Replace the existing `<div class="try-hero">…</div>` two-column grid with:
  - A `<nav class="try-tabs">` containing two `<a>` tab buttons.
  - Two `<section>` panels (`#panel-install`, `#panel-byok`) wrapping the existing `<InstallCard>` and the existing BYOK card body verbatim.
- Update the page header lede to lead with Install and demote BYOK.
- Keep the trailing `<details>Or clone & develop locally</details>`, `<NonDeterminismCaveat />`, and `<ReportThis />` blocks unchanged below the tabs.

### `apps/site/src/styles/byok.css` (or a new dedicated `try-tabs.css` block within the existing `<style>` block on `/try/index.astro`)

- New rules for `.try-tabs`, `.try-tab`, `.try-panel`, plus the `body:has(#panel-byok:target)` swap that flips visibility and tab fills.

No changes to `<InstallCard>`, `<ByokDemo>`, or any other component.

---

## Section 1 — Page structure

Replace the `try-hero` two-column grid with a tab nav + two stacked panels. Default state shows the Install panel; `#panel-byok` in the URL hash swaps to the BYOK panel.

```
Header
  kicker   "Try"
  h1       "Run Falsafa in your daily LLM"  ← rewritten (see Section 3)
  lede     ONE-LINE rewrite leading with install

Tab nav   [Install] [Try in browser (BYOK)]    ← outer CSS-:target tabs

Tab content (one visible at a time)
  ┌─────────────────────────────────────────────────┐
  │ Install panel — default visible                 │
  │   <InstallCard />                               │
  │     inner tabs:                                 │
  │       Claude Desktop / Claude Code / Cursor /   │
  │       Codex                                     │
  │     snippet under each inner tab                │
  └─────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────┐
  │ BYOK panel — hidden by default; visible on      │
  │ #panel-byok                                     │
  │   header line: "Bring your own API key. Stays   │
  │                 in the browser."                │
  │   <ByokDemo client:only="preact" chips={…} />   │
  └─────────────────────────────────────────────────┘

<details>Or clone & develop locally</details>   ← stays, below tabs
<NonDeterminismCaveat />                         ← stays
<ReportThis />                                   ← stays
```

The two cards stop competing for attention. Install is the default; BYOK is one click (or `/try/#panel-byok`) away. URL `/try/#panel-byok` is shareable and refresh-stable.

---

## Section 2 — Tab implementation (CSS `:target`)

Two anchor links + two sections + a CSS rule. Zero JS for the outer tabs. Same pattern as `/eval/<id>/`.

### Markup

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

Notes for the implementer:

- `chips={CHIPS}` refers to the existing `const CHIPS = […]` already declared in the frontmatter of `try/index.astro` (12 hand-picked question chips). No new constant is introduced; the markup just keeps the existing prop pass-through.
- The BYOK card-head's existing `<h2>Try it now (BYOK)</h2>` is removed (the outer tab label "Try in browser (BYOK)" names the section). The surrounding `<header class="try-byok-card-head">` wrapper element is kept — only the `<h2>` is dropped, and the explanatory `<p>Bring your own API key. Stays in the browser.</p>` stays inside it. The wrapper class can drive any existing margin/padding the BYOK card needs.

### CSS

```css
/* Tab nav */
.try-tabs {
  display: inline-flex;
  gap: var(--s-1);
  margin: var(--s-4) 0 var(--s-6);
}
.try-tab {
  padding: var(--s-2) var(--s-4);
  border: 1px solid var(--rule);
  border-radius: 999px;
  font-family: var(--font-sans);
  font-size: var(--fs-chrome);
  color: var(--ink);
  text-decoration: none;
}
.try-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Default state — Install visible, BYOK hidden. */
.try-tab--install { background: color-mix(in oklch, var(--ink) 6%, var(--paper)); }
.try-tab--byok    { background: transparent; }
.try-panel--install { display: block; }
.try-panel--byok    { display: none; }

/* Active state — when #panel-byok is the URL fragment, swap. */
body:has(#panel-byok:target) .try-tab--install { background: transparent; }
body:has(#panel-byok:target) .try-tab--byok    { background: color-mix(in oklch, var(--accent) 6%, var(--paper)); }
body:has(#panel-byok:target) .try-panel--install { display: none; }
body:has(#panel-byok:target) .try-panel--byok    { display: block; }

/* Defensive: if `#panel-install` is explicitly targeted, force default state */
body:has(#panel-install:target) .try-tab--install { background: color-mix(in oklch, var(--ink) 6%, var(--paper)); }
body:has(#panel-install:target) .try-tab--byok    { background: transparent; }
body:has(#panel-install:target) .try-panel--install { display: block; }
body:has(#panel-install:target) .try-panel--byok    { display: none; }
```

Tints reuse the same color-mix tokens we use on the eval scoreboard (Install tab uses the same warm grey, BYOK uses the faint accent blue), keeping the visual language consistent across the redesign.

### `aria-selected` trade-off

Static markup ships `aria-selected="true"` on Install (the default-load tab). When the user is on `#panel-byok`, that markup is technically wrong — sighted users see the correct tab fill via the `:has()` swap, but a screen reader hears the stale attribute.

This is the same trade-off the eval case detail tabs ship with. The follow-up to fix it (a small hashchange script that flips `aria-selected` on both surfaces) is already tracked in `TODOS.md` under "Eval A/B UI follow-up: aria-selected hashchange script". When that script lands it will cover this page automatically since the IDs follow the same convention.

### Edge case — first-load with no hash

The browser loads `/try/` with no hash. Both default rules win: Install panel visible, BYOK hidden, Install tab filled. No flicker.

### Edge case — `/try/#panel-byok` direct load

Browser scrolls to `#panel-byok` (which is below the tab nav). The natural scroll-to-anchor lands the BYOK panel near the top of the viewport, with the tab nav still visible above. Acceptable.

To suppress the scroll if undesirable: `scroll-behavior: auto` on `html` is already the default. We can add `scroll-margin-top: 0` to `.try-panel` if a future styling change introduces unwanted scroll jumps. Not needed for v1.

### Edge case — `/try/#install`, `/try/#byok` (without the `panel-` prefix)

Wouldn't match — falls through to default state (Install visible). Harmless. We don't need to alias these unless we observe traffic landing on them in production.

---

## Section 3 — Header copy revision

### Current

> **Run Falsafa on your terms**
> *Install the MCP into your daily LLM, or paste an API key to try it live in the browser. The same librarian tools, the same corpus.*

### Proposed

> **Run Falsafa in your daily LLM**
> *One `npx` command wires Falsafa into Claude Desktop, Claude Code, Cursor, or Codex. Or skip the install and try it live in the browser with your own API key.*

The new H1 names the primary path explicitly. The lede leads with Install (concrete clients named, the `npx` mechanic teased) and demotes BYOK to a fallback ("or skip the install"). Same length as before.

The page-meta `<Base description={…}>` also gets updated to match. Replace today's:

```astro
<Base
  title="Try"
  description="Install Falsafa as an MCP in your daily LLM, or try it live in the browser with your own API key. The same librarian tools, the same corpus."
>
```

with:

```astro
<Base
  title="Try"
  description="One npx command wires Falsafa into Claude Desktop, Claude Code, Cursor, or Codex. Or skip the install and try it live in the browser with your own API key."
>
```

Both header and meta-description land in the same PR.

---

## Section 4 — Mobile

Current mobile (<768px): the `try-hero` grid stacks the two cards vertically. Both Install and BYOK render in full, scrollable.

Post-redesign mobile: tab nav at top (single row, comfortably fits two pill-shaped tabs even on a 320px-wide screen). One panel visible at a time. Tapping the tab swaps. URL hash sync works the same as desktop.

If the labels ever grow long enough that two tabs don't fit on one line at 320px, `flex-wrap: wrap` on `.try-tabs` keeps them legible — they'll just stack into two rows. Not an issue with current labels ("Install" + "Try in browser (BYOK)" easily fit).

The mobile layout is strictly lighter than today: less content visible at any given moment, clearer cognitive boundary between the two paths.

---

## Section 5 — `<details>` and trailing components

Below the tabs, the existing trailing structure stays unchanged:

```astro
<details class="try-clone">
  <summary>Or clone & develop locally</summary>
  <pre><code>git clone https://github.com/adoistic/falsafa
cd falsafa && bun install
cd apps/site && bun run dev          # reading site
cd apps/mcp  && bun run dev          # MCP server (stdio)</code></pre>
  <p>See the <a href="…">README</a> for the full eval / convert / image-gen scripts.</p>
</details>

<NonDeterminismCaveat />
<ReportThis />
```

These render below the tab content regardless of which tab is active. The `<details>` stays collapsed by default — tertiary disclosure, not a peer to the two main paths. The caveats are unchanged.

---

## Data flow

No data flow changes. The only state is the URL hash (`/try/`, `/try/#panel-byok`, or `/try/#panel-install`), read implicitly by CSS `:target`. No JavaScript for the outer tabs.

The `<InstallCard>` continues to manage its own inner-tab state via its existing inline script + `data-target` attributes (button-based ARIA tabs). The `<ByokDemo>` continues to manage its own state inside the Preact island.

---

## Out-of-scope follow-ups

- **`aria-selected` hashchange script** — tracked in `TODOS.md` under "Eval A/B UI follow-up". When it lands it will cover this page automatically (same selector convention).
- **Replace InstallCard's inner JS tabs with CSS `:target`** — would let the InstallCard match the outer tabs' implementation. Doable but pushes nested `:target` complexity. YAGNI for v1.
- **Three-way tab including "Develop locally"** — promotes a tertiary path; the `<details>` is the right disclosure level for it.
- **Per-client install snippet OG-image previews** for sharing `/try/#install` to social media. Future polish.

---

## Testing

Manual smoke (presentation-layer change, no logic):

1. **Default load.** Open `/try/`. Confirm Install panel visible, BYOK hidden, Install tab filled, BYOK tab outlined.
2. **Click BYOK tab.** Confirm content swaps, URL hash becomes `/try/#panel-byok`, BYOK tab fills, Install tab outlines.
3. **Click Install tab.** Confirm content swaps back, URL hash becomes `/try/#panel-install`.
4. **Direct load `/try/#panel-byok`.** Confirm BYOK panel visible immediately on load, BYOK tab filled.
5. **Refresh on `#panel-byok`.** Confirm tab state preserved.
6. **Browser back/forward.** Click BYOK → click Install → press back. Confirm BYOK is restored. Press forward, Install is restored. (CSS `:target` honors browser history natively in all evergreen browsers — no JS hashchange listener needed for history navigation.)
7. **Mobile (≤320px).** Confirm both tabs fit on one row, panels render full-width, no horizontal scroll.
8. **Keyboard.** Tab into the tab nav, confirm `:focus-visible` outline. Activate with Enter/Space — anchor follows the link, panel swaps.
9. **InstallCard inner tabs** (Claude Desktop / Claude Code / Cursor / Codex) — confirm they still work inside the Install panel. The outer tab's content is the entire `<InstallCard>`; the inner tabs are unaffected.
10. **`<details>` and caveats** — confirm both render below the tab content regardless of which outer tab is active.
11. **Existing tests** — `bun test` should still pass (no test currently covers `/try/`; this PR doesn't add one because the page is presentation-layer).

No unit tests added. The single-arm regression test pattern from the eval explorer doesn't apply here because there's no "single-mode-vs-A/B-mode" branching — `/try/` just has tabs, full stop.
