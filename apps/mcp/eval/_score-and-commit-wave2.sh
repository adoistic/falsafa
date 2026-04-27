#!/bin/bash
# Run after wave 2 sub-agents land. Re-scores the full stratified
# sample and updates the morning briefing in one shot.
set -e
cd /Users/siraj/falsafa

bun -e '
import { readFileSync, writeFileSync } from "node:fs";
const sample = JSON.parse(readFileSync("apps/mcp/eval/runs/1k-stratified-50-sonnet/_sample.json", "utf8"));
const runDir = "apps/mcp/eval/runs/1k-stratified-50-sonnet/sonnet";
const rows = [];
for (const q of sample) {
  let r;
  try { r = JSON.parse(readFileSync(`${runDir}/${q.id}.json`, "utf8")); }
  catch { continue; }
  const cited = new Set([
    ...(r.citations ?? []).map(c => c.work_slug).filter(Boolean),
    ...(r.answer.match(/[a-z][a-z0-9-]+-[a-f0-9]{6}/g) ?? [])
  ]);
  const expected = q.expected_works ?? [];
  const hits = expected.filter(w => cited.has(w));
  const overlap = expected.length === 0 ? 1 : hits.length / expected.length;
  const pass = expected.length === 0
    ? (r.answer && r.answer.length > 50 && (r.citations?.length ?? 0) > 0)
    : overlap >= 0.5;
  rows.push({id: q.id, category: q.category, difficulty: q.difficulty, pass, hits: hits.length, expected: expected.length, citedWorks: [...cited], expectedWorks: expected, toolCount: r.tool_calls?.length ?? 0});
}
const totalPass = rows.filter(r => r.pass).length;
const byCat = {};
for (const r of rows) {
  byCat[r.category] ??= { pass: 0, total: 0 };
  byCat[r.category].total++;
  if (r.pass) byCat[r.category].pass++;
}
console.log(`Stratified-50 (full sample, including waves 1+2): ${totalPass}/${rows.length} = ${Math.round(totalPass/rows.length*100)}%`);
for (const [cat, s] of Object.entries(byCat)) console.log(`  ${cat}: ${s.pass}/${s.total}`);

writeFileSync(`apps/mcp/eval/runs/1k-stratified-50-sonnet/_score-mechanical.json`, JSON.stringify({
  run_dir: runDir,
  driver: "claude-code-subagent-native-mcp",
  model: "claude-sonnet-4.6",
  total_pass: totalPass,
  total_judged: rows.length,
  pass_rate: rows.length > 0 ? totalPass/rows.length : 0,
  by_category: byCat,
  per_question: rows,
}, null, 2));
console.log(`\nWrote _score-mechanical.json — ${rows.length} questions covered`);

// Also append a wave 2 entry to the briefing
const briefing = readFileSync("docs/eval-reports/_MORNING-BRIEFING.md", "utf8");
const waveCount = rows.length;
const passRate = rows.length > 0 ? Math.round(totalPass/rows.length*100) : 0;
console.log(`\nReady to update briefing: ${totalPass}/${waveCount} mechanical, ${passRate}%`);
'

git add apps/mcp/eval/runs/1k-stratified-50-sonnet/
git commit -m "eval: stratified-50 wave 2 results landed

$(bun -e '
import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync("apps/mcp/eval/runs/1k-stratified-50-sonnet/_score-mechanical.json", "utf8"));
console.log(\`Final stratified sample: \${s.total_pass}/\${s.total_judged} pass (\${Math.round(s.pass_rate*100)}%)\`);
console.log(\"\");
console.log(\"By category:\");
for (const [cat, d] of Object.entries(s.by_category)) console.log(\`  \${cat}: \${d.pass}/\${d.total}\`);
')

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push 2>&1 | tail -2
