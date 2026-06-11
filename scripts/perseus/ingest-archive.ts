#!/usr/bin/env bun
/**
 * Full-archive Perseus ingester: every work in archive-worklist.json, English
 * translation plus source-language original where the catalog carries one,
 * chapterized through the same TEI flattening as the curated tranches.
 *
 * Operates in batches of 25 works: each batch is written to a temp pair and
 * applied to the corpus immediately (scripts/perseus/apply.ts), so progress
 * survives interruption. A disk watermark stops ingestion cleanly when free
 * space on the data volume drops below 2.5 GB; the unprocessed remainder is
 * written to archive-remaining.json and the run can be resumed with:
 *
 *   bun run scripts/perseus/ingest-archive.ts archive-remaining.json
 *
 * Metadata at archive scale is generated, not curated: author from the
 * textgroup catalog, genre 'Classics', era 'Ancient', description from the
 * catalog's edition label and translator credit. The curated tranches keep
 * their hand-written records.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  uuidFrom,
  buildChapters,
  fetchText,
  pickEnglish,
  pickEdition,
  type BuiltChapter,
} from "./lib.ts";

const root = resolve(import.meta.dir, "..", "..");
const RAW = "https://raw.githubusercontent.com/PerseusDL";
const BATCH = 25;
const WATERMARK_KB = 2.5 * 1024 * 1024;

interface Entry {
  repo: string;
  group: string;
  work: string;
  eng_files: string[];
}

const inputFile = process.argv[2] ?? "archive-worklist.json";
const worklist = JSON.parse(
  readFileSync(resolve(import.meta.dir, inputFile), "utf-8"),
) as { works: Entry[] };

function freeKb(): number {
  const out = execFileSync("df", ["-k", "/System/Volumes/Data"]).toString("utf-8");
  const line = out.trim().split("\n").pop()!;
  return parseInt(line.split(/\s+/)[3]!, 10);
}

const groupNames = new Map<string, string>();
async function groupName(repo: string, group: string): Promise<string> {
  const key = `${repo}/${group}`;
  if (groupNames.has(key)) return groupNames.get(key)!;
  const xml = await fetchText(`${RAW}/${repo}/master/data/${group}/__cts__.xml`);
  const name =
    (xml && /<(?:ti:)?groupname[^>]*>([\s\S]*?)<\/(?:ti:)?groupname>/.exec(xml)?.[1]?.trim()) || "Unknown";
  groupNames.set(key, name);
  return name;
}

interface Built {
  raw: unknown;
  audits: unknown[];
  line: string;
}

async function buildWork(e: Entry): Promise<Built | { skip: string }> {
  const base = `${RAW}/${e.repo}/master/data/${e.group}/${e.work}`;
  const cts = await fetchText(`${base}/__cts__.xml`);
  const author = await groupName(e.repo, e.group);
  const namespace = e.repo === "canonical-latinLit" ? "latinLit" : "greekLit";
  const srcScript = e.repo === "canonical-latinLit" ? "latin" : "greek";
  const srcLanguage = e.repo === "canonical-latinLit" ? "Latin" : "Greek";

  let engUrnTail: string | null = null;
  let translator = "Perseus Digital Library";
  let title = "";
  if (cts) {
    title = /<(?:ti:)?title[^>]*>([\s\S]*?)<\/(?:ti:)?title>/.exec(cts)?.[1]?.trim() ?? "";
    const eng = pickEnglish(cts);
    if (eng) {
      engUrnTail = eng.urn.split(":").pop()!;
      translator = eng.translator;
    }
  }
  if (!engUrnTail) {
    // catalog-less: take the highest-numbered eng file from the worklist
    const f = [...e.eng_files].sort().pop();
    if (!f) return { skip: `${e.group}/${e.work}: no English file` };
    engUrnTail = f.replace(/\.xml$/, "");
  }
  let xml = await fetchText(`${base}/${engUrnTail}.xml`);
  if (!xml) {
    // catalog URN points at a missing file; fall back to the file the
    // enumeration actually saw on disk
    const alt = [...e.eng_files].sort().pop()?.replace(/\.xml$/, "");
    if (alt && alt !== engUrnTail) {
      xml = await fetchText(`${base}/${alt}.xml`);
      if (xml) engUrnTail = alt;
    }
  }
  if (!xml) return { skip: `${e.group}/${e.work}: fetch failed ${engUrnTail}` };
  if (!title) {
    title =
      /<title[^>]*>([\s\S]*?)<\/title>/.exec(xml)?.[1]?.trim().replace(/\s*\(English\).*$/i, "") ??
      `${e.group}.${e.work}`;
  }
  title = title.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const chapters = buildChapters(xml, title);
  if (chapters.length === 0) return { skip: `${e.group}/${e.work}: no chapters extracted` };

  // source-language original; when the canonical repo has no edition,
  // Greek works often live in OpenGreekAndLatin/First1KGreek instead
  let origChapters: BuiltChapter[] = [];
  let origTail = "";
  if (cts) {
    const ed = pickEdition(cts);
    if (ed) {
      origTail = ed.urn.split(":").pop()!;
      const oxml = await fetchText(`${base}/${origTail}.xml`);
      if (oxml) origChapters = buildChapters(oxml, title);
    }
  }
  if (origChapters.length === 0 && namespace === "greekLit") {
    const f1kBase = `https://raw.githubusercontent.com/OpenGreekAndLatin/First1KGreek/master/data/${e.group}/${e.work}`;
    const f1kCts = await fetchText(`${f1kBase}/__cts__.xml`);
    if (f1kCts) {
      const ed = pickEdition(f1kCts);
      if (ed) {
        origTail = ed.urn.split(":").pop()!;
        const oxml = await fetchText(`${f1kBase}/${origTail}.xml`);
        if (oxml) origChapters = buildChapters(oxml, title);
      }
    }
  }

  const workUrn = `${namespace}:${e.group}.${e.work}:${engUrnTail}`;
  const workId = uuidFrom(workUrn);
  const audits: unknown[] = [];
  const rawChapters: unknown[] = [];

  chapters.forEach((c, i) => {
    const chapterId = uuidFrom(`${workUrn}#t${i + 1}`);
    audits.push({
      work_id: workId,
      chapter_id: chapterId,
      chapter_number: i + 1,
      chapter_title: c.title,
      content_type: "translation",
      layout: c.layout,
      language_name: "English",
      script: "latin",
      word_count_actual: c.words,
      has_image: false,
      has_source_url: true,
      source_url: `https://scaife.perseus.org/reader/urn:cts:${namespace}:${engUrnTail}${chapters.length > 1 ? `:${i + 1}` : ""}`,
      is_generic_title: /^(Book|Chapter) /.test(c.title),
      flags: [],
    });
    rawChapters.push({
      id: chapterId,
      title: c.title,
      content: c.content,
      chapter_number: i + 1,
      word_count: c.words,
      is_original: false,
      translator,
    });
  });
  origChapters.forEach((c, i) => {
    if (i >= chapters.length && origChapters.length !== chapters.length) return;
    const chapterId = uuidFrom(`${workUrn}#o${i + 1}`);
    audits.push({
      work_id: workId,
      chapter_id: chapterId,
      chapter_number: i + 1,
      chapter_title: chapters[i]?.title ?? c.title,
      content_type: "original",
      layout: c.layout,
      language_name: srcLanguage,
      script: srcScript,
      word_count_actual: c.words,
      has_image: false,
      has_source_url: true,
      source_url: `https://scaife.perseus.org/reader/urn:cts:${namespace}:${origTail}${origChapters.length > 1 ? `:${i + 1}` : ""}`,
      is_generic_title: /^(Book|Chapter) /.test(chapters[i]?.title ?? c.title),
      flags: [],
    });
    rawChapters.push({
      id: chapterId,
      title: chapters[i]?.title ?? c.title,
      content: c.content,
      chapter_number: i + 1,
      word_count: c.words,
      is_original: true,
    });
  });

  const words = chapters.reduce((s, c) => s + c.words, 0);
  const raw = {
    id: workId,
    title,
    author: {
      id: uuidFrom(`author:${author}`),
      name: author,
      biography: `Author record from the Perseus Digital Library canonical catalogs.`,
      birth_year: null,
      death_year: null,
      nationality: null,
    },
    era: { name: "Ancient" },
    genre: { name: "Classics" },
    language: { name: srcLanguage, direction: "ltr" },
    description: `${title}, in English translation from the Perseus Digital Library (tr. ${translator})${origChapters.length > 0 ? ", with the " + srcLanguage + " original" : ""}.`,
    difficulty: "Intermediate",
    is_published: true,
    published_year: null,
    total_chapters: chapters.length,
    chapters: rawChapters,
  };
  return {
    raw,
    audits,
    line: `${author}: ${title} — ${chapters.length} ch, ${words.toLocaleString("en-US")} w${origChapters.length ? `, +${srcLanguage} original` : ""} [tr. ${translator}]`,
  };
}

async function main() {
  const entries = worklist.works;
  let done = 0;
  let skipped = 0;
  let applied = 0;

  for (let b = 0; b * BATCH < entries.length; b++) {
    if (freeKb() < WATERMARK_KB) {
      const remaining = entries.slice(b * BATCH);
      writeFileSync(
        resolve(import.meta.dir, "archive-remaining.json"),
        JSON.stringify({ count: remaining.length, works: remaining }, null, 1),
      );
      console.log(
        `\nDISK WATERMARK: stopped with ${remaining.length} works unprocessed; resume with ingest-archive.ts archive-remaining.json after freeing space.`,
      );
      break;
    }
    const slice = entries.slice(b * BATCH, (b + 1) * BATCH);
    const rawWorks: unknown[] = [];
    const audits: unknown[] = [];
    // modest parallelism: 5 works at a time within the batch
    for (let i = 0; i < slice.length; i += 5) {
      const results = await Promise.all(slice.slice(i, i + 5).map(buildWork));
      for (const r of results) {
        if ("skip" in r) {
          console.log(`  skip: ${r.skip}`);
          skipped++;
        } else {
          rawWorks.push(r.raw);
          audits.push(...r.audits);
          console.log(`  ${r.line}`);
          done++;
        }
      }
    }
    if (rawWorks.length === 0) continue;
    writeFileSync(
      resolve(root, "archive-batch-works.json"),
      JSON.stringify({ works: rawWorks, source: "Perseus Digital Library canonical repos (full archive ingest)" }, null, 0),
    );
    writeFileSync(
      resolve(root, "archive-batch-audit.json"),
      JSON.stringify({ audited_chapters: audits }, null, 0),
    );
    execFileSync(
      "bun",
      ["run", resolve(import.meta.dir, "apply.ts"), "archive-batch-works.json", "archive-batch-audit.json"],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    applied += rawWorks.length;
    console.log(`batch ${b + 1}: applied ${rawWorks.length} (total ${applied}, skipped ${skipped})`);
  }
  rmSync(resolve(root, "archive-batch-works.json"), { force: true });
  rmSync(resolve(root, "archive-batch-audit.json"), { force: true });
  console.log(`\narchive ingest: ${applied} works applied, ${skipped} skipped.`);
}

await main();
