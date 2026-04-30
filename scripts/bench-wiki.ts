#!/usr/bin/env bun
/**
 * Performance bench for the wiki build per design D7.
 *
 * Asserts: full-corpus wiki rebuild completes in <5 min (300_000ms).
 * If the budget is exceeded, exit non-zero — CI fails the PR.
 *
 * Use the `--budget <ms>` flag to override the default for local
 * experimentation. CI never overrides; use the default 300_000.
 *
 * The bench builds against a TEMP corpus root copy in production CI to
 * avoid mutating the real corpus, but for the Falsafa repo CI we run it
 * against the real corpus/ — every chapter is regenerated atomically by
 * build-wiki.ts, drift is normal between PRs, and the --check gate in
 * the wiki-ci.yml workflow handles the staleness check separately.
 */

import { resolve } from "node:path";
import { buildWiki } from "./build-wiki";

const DEFAULT_BUDGET_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let budget = DEFAULT_BUDGET_MS;
  let corpus = resolve(import.meta.dir, "..", "corpus");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--budget") budget = parseInt(argv[++i] ?? `${DEFAULT_BUDGET_MS}`, 10);
    else if (a === "--corpus") corpus = resolve(argv[++i] ?? corpus);
  }
  console.log(`[bench-wiki] budget: ${(budget / 1000).toFixed(0)}s`);
  console.log(`[bench-wiki] corpus: ${corpus}`);
  const t0 = performance.now();
  const result = await buildWiki(corpus, { quiet: true });
  const elapsed = performance.now() - t0;
  const elapsedSec = (elapsed / 1000).toFixed(1);
  console.log(
    `[bench-wiki] full corpus rebuild: ${elapsedSec}s · wrote=${result.wrote} unchanged=${result.unchanged}`,
  );
  if (elapsed > budget) {
    console.error(
      `[bench-wiki] PERF BUDGET EXCEEDED: ${elapsedSec}s > ${(budget / 1000).toFixed(0)}s`,
    );
    process.exit(1);
  }
  console.log(`[bench-wiki] ✓ within budget`);
}

if (import.meta.main) {
  main();
}
