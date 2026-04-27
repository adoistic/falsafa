#!/usr/bin/env bun
/**
 * Aggregate Sonnet judge verdicts written to <run-dir>/_judge/<case-id>.json
 * into a single summary printed to stdout + saved as _judge/_summary.json.
 *
 * Run: bun run apps/mcp/eval/aggregate-judge.ts <run-dir>
 */
import fs from "fs";
import path from "path";

const runDir = process.argv[2];
if (!runDir) { console.error("Usage: aggregate-judge.ts <run-dir>"); process.exit(2); }
const judgeDir = path.join(runDir, "_judge");

interface Verdict {
  case_id: string;
  category: string;
  factual_correctness: number;
  citation_grounding: number;
  hallucination_avoidance: number;
  reasoning_quality: number;
  total: number;
  max: number;
  pass: boolean;
  verdict: string;
  rationale: string;
}

const files = fs.readdirSync(judgeDir).filter(f => f.endsWith(".json") && !f.startsWith("_"));
const verdicts: Verdict[] = files.map(f => JSON.parse(fs.readFileSync(path.join(judgeDir, f), "utf8")));

const byCat: Record<string, { pass: number; total: number; pts: number; maxPts: number }> = {};
for (const v of verdicts) {
  byCat[v.category] ??= { pass: 0, total: 0, pts: 0, maxPts: 0 };
  byCat[v.category]!.pass += v.pass ? 1 : 0;
  byCat[v.category]!.total += 1;
  byCat[v.category]!.pts += v.total;
  byCat[v.category]!.maxPts += v.max;
}

const totalPass = verdicts.filter(v => v.pass).length;
const totalPts = verdicts.reduce((a, v) => a + v.total, 0);
const totalMax = verdicts.reduce((a, v) => a + v.max, 0);
const perfect = verdicts.filter(v => v.total === 12).length;

console.log(`# Sonnet Judge Aggregate — ${runDir}\n`);
console.log(`Cases judged: ${verdicts.length} / 44`);
console.log(`Pass (≥ 8/12, no axis = 0): ${totalPass} (${Math.round(100 * totalPass / verdicts.length)}%)`);
console.log(`Perfect (12/12): ${perfect}`);
console.log(`Points: ${totalPts} / ${totalMax} (${Math.round(100 * totalPts / totalMax)}%)\n`);

console.log("## Per-category");
for (const [cat, c] of Object.entries(byCat).sort()) {
  console.log(`- ${cat}: ${c.pass}/${c.total} pass, ${c.pts}/${c.maxPts} pts`);
}
console.log("");
console.log("## Cases scoring < 12/12");
for (const v of verdicts.filter(v => v.total < 12).sort((a, b) => a.total - b.total)) {
  console.log(`- [${v.total}/12 ${v.verdict}] ${v.case_id}`);
  console.log(`    factual=${v.factual_correctness} cite=${v.citation_grounding} halluc=${v.hallucination_avoidance} reasoning=${v.reasoning_quality}`);
  console.log(`    ${v.rationale.slice(0, 200)}${v.rationale.length > 200 ? "..." : ""}`);
}

const summary = {
  run_dir: runDir,
  cases_judged: verdicts.length,
  pass: totalPass,
  perfect: perfect,
  points: totalPts,
  max: totalMax,
  by_category: byCat,
  per_case: verdicts.map(v => ({
    id: v.case_id,
    cat: v.category,
    factual: v.factual_correctness,
    cite: v.citation_grounding,
    halluc: v.hallucination_avoidance,
    reasoning: v.reasoning_quality,
    total: v.total,
    verdict: v.verdict,
  })).sort((a, b) => a.total - b.total),
};
fs.writeFileSync(path.join(judgeDir, "_summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nWrote ${path.join(judgeDir, "_summary.json")}`);
