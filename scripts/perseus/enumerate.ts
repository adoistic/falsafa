#!/usr/bin/env bun
/**
 * Enumerate every work in the PerseusDL canonical repos that carries an
 * English translation TEI file, from blobless clones at /tmp/perseus-enum.
 *
 * Clones (once, ~50 MB of trees, no blobs):
 *   git clone --depth 1 --filter=blob:none https://github.com/PerseusDL/canonical-greekLit.git
 *   git clone --depth 1 --filter=blob:none https://github.com/PerseusDL/canonical-latinLit.git
 *
 * Emits scripts/perseus/archive-worklist.json, excluding works already in
 * the corpus manifest (the curated tranches).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");
const ENUM = "/tmp/perseus-enum";

const repos = ["canonical-greekLit", "canonical-latinLit"] as const;

// works already in corpus: by (group, work) from the curated tranche files
const curated = new Set<string>();
for (const f of ["tranche-1.json", "tranche-2.json"]) {
  const t = JSON.parse(readFileSync(resolve(import.meta.dir, f), "utf-8")) as {
    works: { group: string; work: string }[];
  };
  for (const w of t.works) curated.add(`${w.group}/${w.work}`);
}

interface Entry {
  repo: string;
  group: string;
  work: string;
  eng_files: string[];
}

const byWork = new Map<string, Entry>();

for (const repo of repos) {
  const dir = `${ENUM}/${repo}`;
  if (!existsSync(dir)) {
    console.error(`missing clone: ${dir}`);
    process.exit(1);
  }
  const paths = execFileSync("git", ["-C", dir, "ls-tree", "-r", "--name-only", "HEAD"], {
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString("utf-8")
    .split("\n");
  for (const p of paths) {
    // data/tlg0085/tlg001/tlg0085.tlg001.perseus-eng2.xml (also 1st1K-eng)
    const m = /^data\/([^/]+)\/([^/]+)\/\2?\.?.*?((?:perseus|1st1K)-eng\d*)\.xml$/.exec(p);
    const m2 = /^data\/([^/]+)\/([^/]+)\/[^/]*-eng\d*\.xml$/.exec(p);
    const mm = m2;
    if (!mm) continue;
    const [, group, work] = mm;
    if (curated.has(`${group}/${work}`)) continue;
    const key = `${repo}:${group}/${work}`;
    if (!byWork.has(key)) byWork.set(key, { repo, group, work: work!, eng_files: [] });
    byWork.get(key)!.eng_files.push(p.split("/").pop()!);
  }
}

const list = [...byWork.values()].sort((a, b) =>
  `${a.repo}/${a.group}/${a.work}`.localeCompare(`${b.repo}/${b.group}/${b.work}`),
);

writeFileSync(
  resolve(import.meta.dir, "archive-worklist.json"),
  JSON.stringify({ count: list.length, works: list }, null, 1),
);
console.log(`${list.length} works with English TEI (curated tranches excluded)`);
console.log(
  `greekLit: ${list.filter((w) => w.repo === "canonical-greekLit").length}, latinLit: ${list.filter((w) => w.repo === "canonical-latinLit").length}`,
);
