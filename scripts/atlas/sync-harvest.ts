/**
 * atlas/sync-harvest — pull the ontology harvest's latest state from R2.
 *
 * The harvest's progress-of-record lives on public R2 (the harvester runs
 * independently and write-backs there); the local windows/ dir is only a
 * mirror. This script closes the gap before an atlas build:
 *
 *   1. Fetch the freshness beacon (production-run-summary.json) — the
 *      count-of-record for how far the harvest has advanced.
 *   2. Fetch responses-manifest.txt — the per-window index of finalized
 *      windows (the bucket exposes no ListObjects; the manifest IS the index).
 *   3. Download any window's .enriched.json we don't have locally.
 *   4. Refresh window-manifest.json (the 12,797-window denominator).
 *   5. Write sync-state.json recording what happened.
 *
 * Fail-soft by design: offline or partial failures leave the local mirror
 * untouched and the atlas build proceeds with what's on disk. Additive only —
 * never deletes local windows.
 *
 * Usage: bun run scripts/atlas/sync-harvest.ts [--dry-run] [--concurrency N]
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const RUN_DIR = join(
  import.meta.dir,
  "../../corpus/graph/ontology-runs/2026-07-02-sonnet-benchmark",
);
const WINDOWS_DIR = join(RUN_DIR, "windows");
const R2_BASE =
  process.env.FALSAFA_R2_BASE ??
  "https://pub-88ffad6f37754be2b0e33466951a5135.r2.dev/2026-07-02-sonnet-benchmark";

const DRY_RUN = process.argv.includes("--dry-run");
const concIdx = process.argv.indexOf("--concurrency");
const CONCURRENCY = concIdx > -1 ? Number(process.argv[concIdx + 1]) || 12 : 12;

interface Beacon {
  generated_at?: string;
  total_archive_windows?: number;
  responses_finalized?: number;
  fully_valid?: number;
  extraction_volume?: Record<string, number>;
}

async function fetchText(url: string, timeoutMs = 60_000): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(WINDOWS_DIR, { recursive: true });

  // 1. Beacon
  const beaconRaw = await fetchText(`${R2_BASE}/production-run-summary.json`);
  let beacon: Beacon | null = null;
  if (beaconRaw) {
    try {
      beacon = JSON.parse(beaconRaw) as Beacon;
    } catch {
      console.warn("beacon: unparseable JSON — continuing without");
    }
  }
  if (beacon) {
    console.log(
      `beacon: ${beacon.responses_finalized}/${beacon.total_archive_windows} windows finalized (generated ${beacon.generated_at})`,
    );
  } else {
    console.warn("beacon: unreachable — offline? Proceeding with local mirror only.");
  }

  // 2. Window index
  const manifestRaw = await fetchText(`${R2_BASE}/responses-manifest.txt`);
  const remoteWindows: string[] = manifestRaw
    ? manifestRaw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(/^responses\//, "").replace(/\.response\.txt$/, ""))
    : [];
  console.log(`remote index: ${remoteWindows.length} windows listed`);

  // 3. Diff against local mirror
  const localGlob = new Bun.Glob("*.enriched.json");
  const local = new Set<string>();
  for await (const f of localGlob.scan(WINDOWS_DIR)) {
    local.add(f.replace(/\.enriched\.json$/, ""));
  }
  const missing = remoteWindows.filter((w) => !local.has(w));
  console.log(`local mirror: ${local.size} enriched · missing: ${missing.length}`);

  let downloaded = 0;
  let failed = 0;
  if (!DRY_RUN && missing.length > 0) {
    // Simple promise-pool download, additive only.
    let i = 0;
    async function worker() {
      while (i < missing.length) {
        const w = missing[i++];
        const body = await fetchText(`${R2_BASE}/windows/${w}.enriched.json`, 120_000);
        if (body === null) {
          failed++; // manifest can outrun uploads; a 404 here is not fatal
          continue;
        }
        try {
          JSON.parse(body); // never write a corrupt window into the mirror
        } catch {
          failed++;
          continue;
        }
        await Bun.write(join(WINDOWS_DIR, `${w}.enriched.json`), body);
        downloaded++;
        if (downloaded % 100 === 0)
          console.log(`  …${downloaded}/${missing.length} downloaded`);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker),
    );
    console.log(`downloaded ${downloaded} · failed/skipped ${failed}`);
  }

  // 4. Refresh the denominator (window-manifest.json) when available.
  if (!DRY_RUN) {
    const wm = await fetchText(`${R2_BASE}/window-manifest.json`, 120_000);
    if (wm) {
      try {
        JSON.parse(wm);
        await Bun.write(join(RUN_DIR, "window-manifest.json"), wm);
        console.log("window-manifest.json refreshed from R2");
      } catch {
        console.warn("window-manifest.json from R2 unparseable — kept local copy");
      }
    }
  }

  // 5. Record the sync.
  const state = {
    synced_at: new Date().toISOString(),
    r2_base: R2_BASE,
    beacon: beacon
      ? {
          generated_at: beacon.generated_at,
          responses_finalized: beacon.responses_finalized,
          total_archive_windows: beacon.total_archive_windows,
          extraction_volume: beacon.extraction_volume ?? null,
        }
      : null,
    remote_listed: remoteWindows.length,
    local_before: local.size,
    downloaded,
    failed,
    dry_run: DRY_RUN,
  };
  if (!DRY_RUN) {
    await Bun.write(
      join(RUN_DIR, "sync-state.json"),
      JSON.stringify(state, null, 2) + "\n",
    );
  }
  console.log(
    `sync complete: ${local.size + downloaded} enriched windows on disk${beacon ? ` (beacon says ${beacon.responses_finalized})` : ""}`,
  );
}

await main();
