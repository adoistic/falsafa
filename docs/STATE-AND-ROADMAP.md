# Falsafa — state and roadmap

> Orientation for any session picking this up. Written 2026-06-11.

## What Falsafa is

An open-source project by Thothica. A reading library for the world's
philosophical, classical, and economic texts, paired with an MCP server that
makes the same corpus callable by any AI agent with real citations. The design
principle is "librarian, not LLM": no vector database, no embeddings,
no hallucinated passages. The agent asks the librarian for a real chapter or a
real search hit and gets back verbatim text with a stable id. Modeled on
Karpathy's "MCP as librarian" idea.

It is the flagship open-source pitch for Thothica (NLnet and similar). Public
one-liner: the world's philosophy made callable by any AI agent via MCP, with
full citations and no vector-DB hallucination.

- Site: Astro 5 static, `apps/site`, reads the corpus at the repo root.
- MCP: `apps/mcp` (`@falsafa/mcp`), code-only npm package that downloads the
  corpus snapshot from a GitHub Release on first run and builds an FTS index.
- Corpus: `corpus/` at repo root. Ingesters under `scripts/` (perseus, oll,
  hart, gutenberg, archive). Apply additively with
  `scripts/perseus/apply.ts <works.json> <audit.json>` — never a bare convert.

## Where we are right now (2026-06-11)

### Corpus
- **1,148 works**, 290 authors, 9 languages.
- **18,945 logical chapters**, **26,254 variant entries** (original + translation).
- Languages: Greek 636, English 289, Latin 183, Sanskrit 10, Kawi 9, French 9,
  Urdu 5, Old English 4, German 3.
- Eras: Imperial 364, Classical 313, 19th C 140, Hellenistic 120,
  Enlightenment 76, 20th C 51, Renaissance 28, Late Antiquity 26, Medieval 20,
  Ancient 10.
- Genres: **Classics 805**, Philosophy 89, Economics 75, Political Theory 68,
  Indic 20, History 19, Law 19, then a long tail.

The corpus grew from a small curated set (~38 works) to 1,148 by ingesting
Perseus (Greek + Latin), Project Gutenberg (English philosophy), David M. Hart's
site, and the Online Library of Liberty classical-liberal canon. The result is
**heavily skewed to ancient Greek/Latin classics** (805 of 1,148 are genre
"Classics"). A site built for ~38 hand-picked philosophy works now has to
present 1,148 works of very uneven shape. This is the root of the "looks odd"
problem.

### Hosting
- The full 1,148-work build is live at **falsafaai.netlify.app**, served by
  Netlify free tier.
- It is built by **GitHub Actions** (16 GB runner) and deployed prebuilt to
  Netlify via the CLI — workflow `.github/workflows/deploy-netlify.yml`, manual
  `workflow_dispatch`. Build is ~5 min; the deploy uploads ~51k assets (125k
  files deduped by content hash, 2.6 GB dist).
- Why this path: the site is **2.6 GB / ~125k files**. That exceeds Vercel
  Hobby (build resource limits), Cloudflare Pages (hard 20k-file cap), and
  GitHub Pages (1 GB cap). Netlify free has no hard file/size cap on serving,
  but its native builder hits a 15-min timeout, so we build in Actions and let
  Netlify only serve.
- Secrets set on the repo: `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`.

### Done (2026-06-12)
1. **DNS cut over.** falsafa.ai now serves the 1,148-work Netlify site over
   HTTPS. GoDaddy DNS: apex A `@` → `75.2.60.5`, CNAME `www` →
   `falsafaai.netlify.app`; Let's Encrypt cert; www 301→apex. Vercel is out of
   the path. (A separate `evchangelog.falsafa.ai` Replit subdomain shares the
   zone — leave its A/TXT alone.)
2. **Sitemap fixed.** `@astrojs/sitemap` added; `/sitemap-index.xml` →
   `/sitemap-0.xml` with 29,015 URLs canonical to falsafa.ai.

### Open items
3. **No llms.txt** (optional; on-brand for the agent-callable story).
4. **Frontend not designed for scale.** Homepage stats and browse views were
   built for tens of works, not 1,148. Numbers and layout read oddly.

### Verified healthy (QA sweep 2026-06-11)
All 1,148 work pages return 200. Search (pagefind), eras index, chapter pages
(`/works/<slug>/<chapter>/translation/`), and cover assets all work.

## What we want to achieve next

Four workstreams. The first is a 5-minute action; the rest are session-sized.

### 0. DNS cutover (Adnan, ~5 min + propagation)
Make falsafa.ai serve the 1,148-work Netlify site. Gated on us being happy with
the site. Recommend doing this after the redesign so the public domain only ever
shows the polished version, OR now if we want the larger corpus public sooner.

### 1. Sitemap fix (small, ~1 build)
Add `@astrojs/sitemap`, set `site: 'https://falsafa.ai'` in astro.config,
rebuild + redeploy. Generates a sitemap index over all ~28k pages. Self-contained.

### 2. marxists.org ingest (large, ~2-3 sessions)
Pull all works **philosophical, economic, or sociological** in nature from the
Marxists Internet Archive (marxists.org/english.htm). This is the thesis-fit
content: it rebalances the corpus away from pure Greek classics toward the
19th-20th century social-thought canon.
- Sources within MIA: the Marxist writers archive (Marx, Engels, Lenin,
  Luxemburg, Trotsky, Gramsci, Lukács, Kautsky, Plekhanov, Mao, etc. — their
  philosophical/economic/sociological works, not every political pamphlet) and
  the **Reference archive** of non-Marxist thinkers MIA hosts (Hegel, Feuerbach,
  Kant, Spinoza, Adam Smith, Ricardo, Darwin, and others).
- **Licensing is the gate.** MIA mixes public-domain originals with copyrighted
  translations and "non-commercial only" texts. Same discipline as OLL: a
  license scan first, ingest only public-domain / clearly-permissible works,
  credit MIA, neutral historical framing.
- Format: MIA is HTML (some ePub/PDF). Needs an HTML ingester
  (`scripts/marxists/`) that crawls the index, classifies by subject, runs the
  license scan, then chapterizes the same way the others do.
- Phases: (a) crawl + classify + license-scan → worklist; (b) build + test the
  ingester on a tranche; (c) full ingest, apply, rebuild, redeploy, QA.

### 3. Frontend redesign (large, ~2-3 sessions)
The site must present 1,148+ works of uneven composition gracefully, and scale
to whatever the corpus becomes. Build for scale, not for the current counts.
- Process skill first: `superpowers:brainstorming` to nail intent and
  requirements before any code.
- Design skills to draw on: `frontend-design`, `ui-ux-pro-max`,
  `design-consultation`, `taste-skill`, `web-design-guidelines`,
  `ux-design:refactoring-ui`, then `design-review` / `design-auditor` to QA.
- Likely scope: a homepage that doesn't lean on raw counts; faceted browse
  (by era / genre / language / author) that survives a lopsided distribution;
  search-first discovery; a work and chapter view that reads well; covers used
  consistently.

## Suggested order

1. **Sitemap** now (he asked; tiny; helps SEO for ~28k pages).
2. **marxists.org ingest** (mechanical, we have the pipeline; grows the corpus
   to its intended fuller shape).
3. **Frontend redesign** last, against the fuller corpus, built to scale.
4. **DNS cutover** when the public version is one we're proud of.

This order is flexible. The redesign could come before the ingest if the "looks
odd" pain is the priority; just build it to scale so new works land cleanly.
