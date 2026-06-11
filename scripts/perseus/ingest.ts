#!/usr/bin/env bun
/**
 * Perseus tranche ingester.
 *
 * For each work in tranche-1.json:
 *   1. fetch data/{group}/{work}/__cts__.xml from the PerseusDL canonical repo
 *   2. pick the English translation URN (last -engN listed; later numbers are
 *      usually the better-encoded edition) and record the translator from the
 *      catalog description
 *   3. fetch the TEI XML of that translation
 *   4. flatten it to chapters of plain markdown paragraphs:
 *      chapter boundaries at div subtype book/chapter/poem/act; works with no
 *      such division (the shorter dialogues) become a single chapter
 *   5. emit RawWork records to perseus-works.json and audit entries to
 *      perseus-audit.json, in exactly the shapes scripts/convert.ts reads
 *
 * The convert step then regenerates the corpus with these works appended.
 * Deterministic UUIDs are derived from the CTS URN, so slugs and paragraph
 * IDs are stable across re-runs.
 *
 * Licensing: the Perseus TEI encodings are CC BY-SA 4.0; the underlying
 * translations in this tranche are public-domain (Loeb-era and older).
 * Each chapter records its Scaife reader URL as source_url.
 *
 * Run: bun run scripts/perseus/ingest.ts
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  uuidFrom,
  fragmentToParagraphs,
  buildChapters,
  fetchText,
  pickEnglish,
  pickEdition,
  type BuiltChapter,
} from "./lib.ts";

const root = resolve(import.meta.dir, "..", "..");
const RAW = "https://raw.githubusercontent.com/PerseusDL";

interface TrancheAuthor {
  name: string;
  biography: string;
  birth_year: number | null;
  death_year: number | null;
  nationality: string;
}

interface TrancheWork {
  repo: string;
  group: string;
  work: string;
  title: string;
  author: TrancheAuthor;
  era: string;
  genre: string;
  language: string;
  description: string;
  difficulty: string;
  published_year: number;
  /** When the catalog description carries no usable translator credit. */
  translator_override?: string;
}

async function main() {
  // All tranche files contribute; the list grows one JSON file at a time.
  const trancheFiles = readdirSync(import.meta.dir)
    .filter((f) => /^tranche-\d+\.json$/.test(f))
    .sort();
  const tranche = { works: [] as TrancheWork[] };
  for (const f of trancheFiles) {
    const t = JSON.parse(readFileSync(resolve(import.meta.dir, f), "utf-8")) as {
      works: TrancheWork[];
    };
    tranche.works.push(...t.works);
    console.log(`${f}: ${t.works.length} works`);
  }

  const rawWorks: unknown[] = [];
  const auditedChapters: unknown[] = [];
  const skipped: string[] = [];

  for (const t of tranche.works) {
    const base = `${RAW}/${t.repo}/master/data/${t.group}/${t.work}`;
    const cts = await fetchText(`${base}/__cts__.xml`);
    if (!cts) {
      skipped.push(`${t.title}: no __cts__.xml`);
      continue;
    }
    const eng = pickEnglish(cts);
    if (!eng) {
      skipped.push(`${t.title}: no English translation in catalog`);
      continue;
    }
    if (t.translator_override) eng.translator = t.translator_override;
    const fileId = eng.urn.split(":").pop()!; // e.g. tlg0059.tlg002.perseus-eng2
    const xml = await fetchText(`${base}/${fileId}.xml`);
    if (!xml) {
      skipped.push(`${t.title}: TEI fetch failed for ${fileId}`);
      continue;
    }
    const chapters = buildChapters(xml, t.title);
    if (chapters.length === 0) {
      skipped.push(`${t.title}: no chapters extracted`);
      continue;
    }

    const workId = uuidFrom(eng.urn);
    const namespace = t.repo === "canonical-latinLit" ? "latinLit" : "greekLit";

    // The source-language original, when the catalog carries one: same
    // chapter numbers, so the reader's variant switcher pairs them.
    const srcScript = t.repo === "canonical-latinLit" ? "latin" : "greek";
    const srcLanguage = t.repo === "canonical-latinLit" ? "Latin" : "Greek";
    let origChapters: BuiltChapter[] = [];
    let origFileId = "";
    const ed = pickEdition(cts);
    if (ed) {
      origFileId = ed.urn.split(":").pop()!;
      const oxml = await fetchText(`${base}/${origFileId}.xml`);
      if (oxml) {
        origChapters = buildChapters(oxml, t.title);
        if (origChapters.length !== chapters.length && origChapters.length > 0) {
          console.log(
            `  note: ${t.title} original has ${origChapters.length} chapters vs ${chapters.length} in translation`,
          );
        }
      }
    }

    const rawChapters: any[] = chapters.map((c, i) => {
      const chapterId = uuidFrom(`${eng.urn}#${i + 1}`);
      auditedChapters.push({
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
        source_url:
          chapters.length > 1
            ? `https://scaife.perseus.org/reader/urn:cts:${namespace}:${fileId}:${i + 1}`
            : `https://scaife.perseus.org/reader/urn:cts:${namespace}:${fileId}`,
        is_generic_title: /^(Book|Chapter) /.test(c.title),
        flags: [],
      });
      return {
        id: chapterId,
        title: c.title,
        content: c.content,
        chapter_number: i + 1,
        word_count: c.words,
        is_original: false,
        translator: eng.translator,
      };
    });

    // original-language chapters share chapter_number with the translation
    for (let i = 0; i < origChapters.length; i++) {
      const c = origChapters[i]!;
      const chapterId = uuidFrom(`${ed!.urn}#${i + 1}`);
      auditedChapters.push({
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
        source_url: `https://scaife.perseus.org/reader/urn:cts:${namespace}:${origFileId}${origChapters.length > 1 ? `:${i + 1}` : ""}`,
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
    }

    rawWorks.push({
      id: workId,
      title: t.title,
      author: {
        id: uuidFrom(`author:${t.author.name}`),
        name: t.author.name,
        biography: t.author.biography,
        birth_year: t.author.birth_year,
        death_year: t.author.death_year,
        nationality: t.author.nationality,
      },
      era: { name: t.era },
      genre: { name: t.genre },
      language: { name: t.language, direction: "ltr" },
      description: `${t.description} Translated by ${eng.translator}.`,
      difficulty: t.difficulty,
      is_published: true,
      published_year: t.published_year,
      total_chapters: rawChapters.length,
      chapters: rawChapters,
    });

    const words = chapters.reduce((s, c) => s + c.words, 0);
    console.log(
      `${t.title}: ${chapters.length} chapters, ${words.toLocaleString("en-US")} words, tr. ${eng.translator} [${fileId}]`,
    );
  }

  writeFileSync(
    resolve(root, "perseus-works.json"),
    JSON.stringify(
      {
        works: rawWorks,
        source:
          "Perseus Digital Library, PerseusDL canonical repositories (TEI encodings CC BY-SA 4.0; translations in this tranche public domain)",
        exported_at: new Date().toISOString(),
      },
      null,
      1,
    ),
  );
  writeFileSync(
    resolve(root, "perseus-audit.json"),
    JSON.stringify({ audited_chapters: auditedChapters }, null, 1),
  );

  console.log(`\n${rawWorks.length} works written to perseus-works.json`);
  if (skipped.length > 0) {
    console.log(`Skipped (fix or drop from tranche, never silently):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
}

await main();
