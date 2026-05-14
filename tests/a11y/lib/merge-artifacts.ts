#!/usr/bin/env bun
// After CI download-artifact with merge-multiple, reorganize the flat
// artifact dump into docs/accessibility/test-runs/<journey>/<sha>/.
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function main(): void {
  const flat = resolve("artifacts");
  const target = resolve("docs/accessibility/test-runs");
  if (!existsSync(flat)) {
    console.error(`No artifacts at ${flat}`);
    process.exit(1);
  }
  for (const name of readdirSync(flat)) {
    const src = join(flat, name);
    if (!statSync(src).isDirectory()) continue;
    for (const journey of readdirSync(src)) {
      const journeySrc = join(src, journey);
      if (!statSync(journeySrc).isDirectory()) continue;
      const journeyDst = join(target, journey);
      mkdirSync(journeyDst, { recursive: true });
      for (const sha of readdirSync(journeySrc)) {
        const shaSrc = join(journeySrc, sha);
        const shaDst = join(journeyDst, sha);
        if (!existsSync(shaDst)) mkdirSync(shaDst, { recursive: true });
        for (const file of readdirSync(shaSrc)) {
          renameSync(join(shaSrc, file), join(shaDst, file));
        }
      }
    }
  }
  console.log(`Merged artifacts into ${target}`);
}

main();
