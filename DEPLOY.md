# Deploying falsafa.ai

**falsafa.ai is hosted entirely on Cloudflare. There is no Netlify, Vercel, or
PaaS build step.** This is the single source of truth for how the site ships.

## Architecture

The site is a fully-static Astro build (`apps/site`, `output: "static"`) — one
HTML page per chapter, currently ~28k pages / ~143k files / ~3.9 GB.

```
bun run build  ──▶  apps/site/dist/  ──rclone sync──▶  R2 bucket: falsafaai
                                                              │
                                          falsafa.ai ──▶  Worker: falsafaai  (apps/worker/)
                                                          serves objects from R2
```

1. **Build** the static site locally (`apps/site` → `dist/`). The build is done
   on a real machine, not in CI, because the heap is pinned to 7680 MB
   (`apps/site/package.json`) for the page scale.
2. **Upload** `dist/` to the R2 bucket `falsafaai` with **rclone** over R2's
   **S3 data-plane** endpoint.
3. The **`falsafaai` Worker** ([apps/worker/](apps/worker/)) serves the bucket:
   it maps request paths to R2 keys (directory `index.html` resolution, content
   types, cache headers, conditional GETs). It is bound to the bucket via
   `[[r2_buckets]] binding = "ASSETS"`. The custom domain `falsafa.ai` /
   `www.falsafa.ai` is attached to this Worker.

### Why this shape (so nobody re-litigates it)

- **Not Netlify/Vercel:** their build environments OOM/time-out on the corpus
  scale, and per-file CLI upload of 143k files stalls.
- **Not Cloudflare Pages / Workers Static Assets:** both cap at ~20k files; we
  have ~143k.
- **R2:** no object-count limit, $0 egress, Worker free tier = 100k req/day.
- **rclone, not `wrangler r2 object put` or the bearer REST API:** those upload
  one object per request and the management API rate-limits (~1200 req / 5 min →
  mass HTTP 429). rclone uses the S3 data-plane (parallel, no mgmt-API limit) and
  is the only thing that uploads 143k files in reasonable time.
- The corpus is finite (Perseus → GRETIL → Liberty Fund → Islamic → done), so the
  asset count is bounded; a D1/SSR rewrite would be over-engineering. Stay static.

## Credentials

R2 S3 credentials live **outside git** in `~/.config/falsafa-deploy.env`
(chmod 600). The file exports the rclone `r2:` remote and the S3 keys:

```
CF_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_ACCESS_KEY_ID=...
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=...
RCLONE_CONFIG_R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
```

The **Worker** is deployed with wrangler's OAuth login (`bunx wrangler whoami`
→ `adnan@thothica.com`); no token to paste.

## Deploy

One command:

```bash
bun run deploy          # = scripts/deploy.sh : build + rclone sync to R2
```

**The atlas refreshes itself on every build.** `apps/site` `prebuild` runs, in
order: prepare-covers → prepare-corpus → build-paragraph-index →
**`scripts/atlas/sync-harvest.ts`** (pulls newly finalized ontology windows
from the public R2 harvest bucket; fail-soft when offline) →
**`scripts/atlas/synthesize.ts`** (re-aggregates the whole atlas from the
mirror, ~5s) → build-llms. So every `bun run build` / `bun run deploy` picks
up whatever the harvester has finished and whatever new works entered the
corpus — no manual step, nothing hardwired. To refresh the atlas without
building, run `bun run atlas:sync && bun run atlas:build` at the repo root.

Or step by step:

```bash
cd apps/site && bun run build          # -> apps/site/dist (incl. pagefind index)
set -a; . ~/.config/falsafa-deploy.env; set +a
rclone sync apps/site/dist r2:falsafaai \
  --transfers 64 --checkers 64 --s3-no-check-bucket --s3-chunk-size 16M \
  --retries 3 --low-level-retries 10 --stats 20s --stats-one-line
```

`rclone sync` mirrors `dist/` into the bucket (it deletes bucket objects no
longer in `dist/`). That is safe: R2 only ever holds a **derived serving copy** —
the corpus source of truth is the markdown in git.

### Redeploying the Worker

Only needed when **`apps/worker/` code changes** (not on content updates):

```bash
cd apps/worker && bunx wrangler deploy
```

## Verify (required before calling a deploy done)

```bash
# a brand-new work URL returns 200 (not 404)
curl -sI "https://falsafa.ai/works/<a-new-work-slug>/" | head -1     # HTTP/2 200

# homepage shows the current work count (matches corpus/manifest.json counts.works)
curl -s "https://falsafa.ai/" | grep -o '[0-9,]\+ works' | head -1
```
