import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseConformanceDoc } from "./parse.js";
import type { Evidence } from "./types.js";

export async function verifyEvidence(ev: Evidence, repoRoot: string): Promise<string[]> {
  const errors: string[] = [];
  if (ev.kind === "artifact") return errors;

  const abs = resolve(repoRoot, ev.path);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch (e: any) {
    errors.push(`${ev.path}: ${e.code === "ENOENT" ? "not found" : e.message}`);
    return errors;
  }

  if (ev.lines) {
    const lineCount = text.split(/\r?\n/).length;
    for (const range of ev.lines.split(",")) {
      const [a, b] = range.split("-").map(Number);
      const start = a;
      const end = b ?? a;
      if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < start) {
        errors.push(`${ev.path}: malformed lines range "${range}"`);
        continue;
      }
      if (end > lineCount) {
        errors.push(`${ev.path}: lines "${range}" exceeds file length (${lineCount} lines)`);
      }
    }
  }

  if (ev.anchor) {
    if (!text.includes(ev.anchor)) {
      errors.push(`${ev.path}: anchor "${ev.anchor}" not found in file`);
    }
  }

  return errors;
}

export async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const yamlPath = resolve(repoRoot, "docs/accessibility/conformance.yaml");
  const doc = await parseConformanceDoc(yamlPath);

  const allErrors: string[] = [];

  for (const c of doc.criteria) {
    for (const ev of c.evidence) {
      const errs = await verifyEvidence(ev, repoRoot);
      for (const e of errs) allErrors.push(`SC ${c.id} (${c.name}): ${e}`);
    }
  }
  for (const e of doc.section_508) {
    for (const ev of e.evidence) {
      const errs = await verifyEvidence(ev, repoRoot);
      for (const m of errs) allErrors.push(`Section 508 ${e.id} (${e.name}): ${m}`);
    }
  }
  for (const e of doc.en_301_549) {
    for (const ev of e.evidence) {
      const errs = await verifyEvidence(ev, repoRoot);
      for (const m of errs) allErrors.push(`EN 301 549 ${e.clause} (${e.name}): ${m}`);
    }
  }

  if (allErrors.length > 0) {
    console.error("Conformance YAML verification FAILED:");
    for (const e of allErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `Conformance YAML verification PASSED (${doc.criteria.length} criteria, ${doc.section_508.length} 508, ${doc.en_301_549.length} EN 301 549 checked).`,
  );
}
