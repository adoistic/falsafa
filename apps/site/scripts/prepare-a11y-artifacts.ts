#!/usr/bin/env bun
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
