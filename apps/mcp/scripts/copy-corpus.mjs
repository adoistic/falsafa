// Copy ../../corpus into ./corpus before npm pack/publish.
// Cross-platform via fs.cpSync (node 16+). Replaces `cp -r`,
// which fails on Windows when contributors run `npm pack` locally.
//
// Runs from apps/mcp/ (npm sets cwd to package dir on lifecycle scripts,
// regardless of which directory the developer ran `npm` from).
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));   // apps/mcp/scripts/
const src = resolve(here, "..", "..", "..", "corpus");   // /falsafa/corpus
const dst = resolve(here, "..", "corpus");               // apps/mcp/corpus

if (!existsSync(src)) {
  console.error(`[copy-corpus] source not found: ${src}`);
  process.exit(1);
}

// Clean dst first so removed files in src don't linger in old copies.
if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });

cpSync(src, dst, { recursive: true });
console.error(`[copy-corpus] copied ${src} → ${dst}`);
