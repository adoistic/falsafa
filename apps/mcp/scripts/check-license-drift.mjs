// Fail-the-publish check: ensure apps/mcp/LICENSE is byte-identical to the
// repo-root LICENSE. Runs on `npm publish` (via prepublishOnly), not on
// `npm pack --dry-run`, so local sanity tests aren't blocked by drift.
//
// Cross-platform via Node, NOT `cmp`/`diff` (Windows contributors running
// the publish flow locally would hit a tooling mismatch).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));   // apps/mcp/scripts/
const rootLicensePath = resolve(here, "..", "..", "..", "LICENSE");  // repo root
const pkgLicensePath = resolve(here, "..", "LICENSE");               // apps/mcp/

const root = readFileSync(rootLicensePath, "utf8");
const pkg = readFileSync(pkgLicensePath, "utf8");

if (root !== pkg) {
  console.error("[mcp] LICENSE drift vs repo root — sync before publish");
  console.error(`  repo root: ${rootLicensePath}`);
  console.error(`  package:   ${pkgLicensePath}`);
  console.error("Fix: cp ../../LICENSE LICENSE  (from apps/mcp/)");
  process.exit(1);
}
