#!/usr/bin/env bun
/**
 * Programmatic scorer for blind sub-agent runs.
 *
 * For each case:
 *   factual_correctness  (0-3): how many of expected_answer_contains substrings appear (case-insensitive)
 *   hallucination_avoid (0-3): 3 if NO must_not_hallucinate strings appear, else 0
 *   citation_present     (0-3): 3 if expects_citation && answer contains a work_slug pattern, else 3 if !expects_citation
 *
 * Output: a per-case score table + category aggregates + headline pass rate (≥ 2/3 mean = pass).
 *
 * Run:  bun run apps/mcp/eval/score-subagent-runs.ts <run-dir>
 *   e.g. bun run apps/mcp/eval/score-subagent-runs.ts apps/mcp/eval/runs/haiku-20260427-093322
 */

import fs from "fs";
import path from "path";

interface Case {
  id: string;
  category: string;
  prompt: string;
  expected_answer_contains: string[];
  expects_citation: boolean;
  must_not_hallucinate?: string[];
}

interface Result {
  answer: string;
  tool_calls?: unknown[];
  citations?: Array<{ work_slug?: string; chapter_number?: number }>;
}

interface Scored {
  id: string;
  category: string;
  factual: number;
  hallucination: number;
  citation: number;
  total: number;
  max: number;
  pass: boolean;
  missing: string[];
  hallucinated: string[];
  notes: string;
}

const runDir = process.argv[2];
if (!runDir) {
  console.error("Usage: bun run score-subagent-runs.ts <run-dir>");
  process.exit(2);
}

const casesData = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, "cases.json"), "utf8"),
);
const cases: Case[] = casesData.cases;

function scoreOne(c: Case): Scored {
  const fp = path.join(runDir, `${c.id}.json`);
  if (!fs.existsSync(fp)) {
    return {
      id: c.id, category: c.category,
      factual: 0, hallucination: 0, citation: 0,
      total: 0, max: 9, pass: false,
      missing: c.expected_answer_contains, hallucinated: [],
      notes: "MISSING_RESULT_FILE",
    };
  }

  let r: Result;
  try { r = JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch (err) {
    return {
      id: c.id, category: c.category,
      factual: 0, hallucination: 0, citation: 0,
      total: 0, max: 9, pass: false,
      missing: [], hallucinated: [],
      notes: `INVALID_JSON: ${(err as Error).message}`,
    };
  }

  const ans = (r.answer || "").toLowerCase();
  const expected = c.expected_answer_contains.map(s => s.toLowerCase());
  const hits = expected.filter(s => ans.includes(s));
  const missing = c.expected_answer_contains.filter((s, i) => !ans.includes(expected[i]!));

  const factual = expected.length === 0
    ? 3
    : Math.round(3 * hits.length / expected.length);

  const halluList = (c.must_not_hallucinate || []).map(s => s.toLowerCase());
  const hallucinated = (c.must_not_hallucinate || []).filter((s, i) => ans.includes(halluList[i]!));
  const hallucination = hallucinated.length === 0 ? 3 : 0;

  let citation = 3;
  if (c.expects_citation) {
    const hasSlugInAnswer = /[a-z0-9-]+-[a-f0-9]{6}/.test(r.answer || "");
    const hasCitObject = !!(r.citations && r.citations.length > 0 && r.citations.some(x => x.work_slug));
    citation = (hasSlugInAnswer || hasCitObject) ? 3 : 1;
  }

  const total = factual + hallucination + citation;
  return {
    id: c.id, category: c.category,
    factual, hallucination, citation,
    total, max: 9, pass: total >= 6,
    missing, hallucinated,
    notes: total === 9 ? "PERFECT" : total >= 6 ? "PASS" : "FAIL",
  };
}

const scored = cases.map(scoreOne);

const byCat: Record<string, { pass: number; total: number; pts: number; maxPts: number }> = {};
for (const s of scored) {
  byCat[s.category] ??= { pass: 0, total: 0, pts: 0, maxPts: 0 };
  byCat[s.category]!.pass += s.pass ? 1 : 0;
  byCat[s.category]!.total += 1;
  byCat[s.category]!.pts += s.total;
  byCat[s.category]!.maxPts += s.max;
}

const totalPass = scored.filter(s => s.pass).length;
const totalPts = scored.reduce((a, s) => a + s.total, 0);
const totalMax = scored.reduce((a, s) => a + s.max, 0);

console.log("# Eval Score Summary");
console.log(`Run dir: ${runDir}`);
console.log(`Cases: ${scored.length}`);
console.log(`Pass (≥ 6/9): ${totalPass} (${Math.round(100 * totalPass / scored.length)}%)`);
console.log(`Points: ${totalPts} / ${totalMax} (${Math.round(100 * totalPts / totalMax)}%)`);
console.log("");
console.log("## Per-category");
for (const [cat, c] of Object.entries(byCat).sort()) {
  console.log(`- ${cat}: ${c.pass}/${c.total} pass, ${c.pts}/${c.maxPts} pts`);
}
console.log("");
console.log("## Per-case");
for (const s of scored) {
  const flag = s.pass ? (s.total === 9 ? "✓✓" : "✓ ") : "✗ ";
  let extra = "";
  if (s.missing.length) extra += ` missing=${JSON.stringify(s.missing)}`;
  if (s.hallucinated.length) extra += ` HALLUCINATED=${JSON.stringify(s.hallucinated)}`;
  console.log(`${flag} ${s.id.padEnd(50)} ${s.factual}+${s.hallucination}+${s.citation}=${s.total}/9${extra}`);
}

const outFile = path.join(runDir, "_score-summary.json");
fs.writeFileSync(outFile, JSON.stringify({
  run_dir: runDir,
  total_cases: scored.length,
  total_pass: totalPass,
  total_points: totalPts,
  total_max: totalMax,
  by_category: byCat,
  per_case: scored,
}, null, 2));
console.log(`\nWrote ${outFile}`);
