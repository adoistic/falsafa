#!/usr/bin/env bash
#
# Deploy falsafa.ai — build the static site and sync it to Cloudflare R2.
# The `falsafaai` Worker (apps/worker/) serves the bucket; it only needs a
# separate `wrangler deploy` when the worker code itself changes.
#
# See DEPLOY.md for the full architecture and rationale. There is no Netlify.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$REPO/apps/site/dist"
BUCKET="falsafaai"
ENV_FILE="${FALSAFA_DEPLOY_ENV:-$HOME/.config/falsafa-deploy.env}"

# R2 S3 credentials + the rclone `r2:` remote live outside git, chmod 600.
[ -f "$ENV_FILE" ] || { echo "FATAL: $ENV_FILE not found (R2 S3 creds — see DEPLOY.md)"; exit 1; }
set -a; . "$ENV_FILE"; set +a

command -v rclone >/dev/null 2>&1 || { echo "FATAL: rclone not installed (brew install rclone)"; exit 1; }

# 1. Build the static site locally (heap pinned in apps/site/package.json).
echo "[$(date +%T)] building apps/site ..."
( cd "$REPO/apps/site" && bun run build )

# 2. Sync dist -> R2 over the S3 data plane (parallel; no mgmt-API rate limit).
rclone lsd "r2:$BUCKET" >/dev/null 2>&1 || { echo "FATAL: cannot reach r2:$BUCKET (check creds)"; exit 1; }
echo "[$(date +%T)] syncing $(find "$DIST" -type f | wc -l | tr -d ' ') files -> r2:$BUCKET ..."
rclone sync "$DIST" "r2:$BUCKET" \
  --transfers 64 --checkers 64 \
  --s3-no-check-bucket --s3-chunk-size 16M \
  --retries 3 --low-level-retries 10 \
  --stats 20s --stats-one-line --stats-log-level NOTICE

echo "[$(date +%T)] done. Worker 'falsafaai' serves it at https://falsafa.ai"
echo "    (Redeploy the worker only if apps/worker changed: cd apps/worker && bunx wrangler deploy)"
