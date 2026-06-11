#!/usr/bin/env bun
/**
 * Hart Digital Library ingester, public-domain texts only.
 *
 * David M. Hart's Digital Library of Liberty and Power (davidmhart.com)
 * hosts two kinds of English text: public-domain editions he curates, and
 * his own modern translations (Pittwater Free Press, 2025-26). The site
 * carries NO license grant, so Hart's own translations are all rights
 * reserved by default and are NOT ingested here. Only works whose English
 * is itself public domain belong in works-1.json. If Hart grants
 * permission later, his translations get their own tranche file.
 *
 * Page model (verified against the Society of Tomorrow): one HTML file per
 * book, chapters under <h3> headings, prose in <p> elements. The site's TLS
 * chain is incomplete, so fetches go through curl -sk.
 *
 * Emits hart-works.json + hart-audit.json in the RawWork/audit shapes;
 * apply with: bun run scripts/perseus/apply.ts hart-works.json hart-audit.json
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..");

interface HartWork {
  url: string;
  title: string;
  author: {
    name: string;
    biography: string;
    birth_year: number | null;
    death_year: number | null;
    nationality: string;
  };
  era: string;
  genre: string;
  language: string;
  description: string;
  difficulty: string;
  published_year: number;
  translator: string;
  /** h3 headings to skip (site chrome, not chapters) */
  skip_headings: string[];
}

function uuidFrom(input: string): string {
  const h = createHash("sha1").update(input).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "5" + h.slice(13, 16),
    ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/↩/g, "") // the back-arrow anchors on headings
    .replace(/\s+/g, " ")
    .trim();
}

const works = JSON.parse(
  readFileSync(resolve(import.meta.dir, "works-1.json"), "utf-8"),
) as { works: HartWork[] };

const rawWorks: unknown[] = [];
const audited: unknown[] = [];

for (const w of works.works) {
  const html = execFileSync("curl", ["-skL", "--max-time", "60", w.url], {
    maxBuffer: 32 * 1024 * 1024,
  }).toString("utf-8");

  // chapters = h3 sections; paragraphs = <p> within each section
  const parts = html.split(/<h3\b[^>]*>/).slice(1);
  const chapters: { title: string; paragraphs: string[] }[] = [];
  for (const part of parts) {
    const endTitle = part.indexOf("</h3>");
    const title = textOf(part.slice(0, endTitle));
    if (!title || w.skip_headings.some((sk) => title.toLowerCase().startsWith(sk.toLowerCase())))
      continue;
    const bodyHtml = part.slice(endTitle + 5);
    const paragraphs = [...bodyHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
      .map((m) => textOf(m[1]!))
      .filter((p) => p.length > 0 && /[A-Za-z]/.test(p));
    if (paragraphs.join(" ").split(/\s+/).length < 80) continue; // chrome scraps
    chapters.push({ title, paragraphs });
  }

  if (chapters.length === 0) {
    console.error(`${w.title}: no chapters extracted, skipping`);
    continue;
  }

  const workId = uuidFrom(w.url);
  const rawChapters = chapters.map((c, i) => {
    const chapterId = uuidFrom(`${w.url}#${i + 1}`);
    const content = c.paragraphs.join("\n\n");
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    audited.push({
      work_id: workId,
      chapter_id: chapterId,
      chapter_number: i + 1,
      chapter_title: c.title,
      content_type: "translation",
      layout: "prose",
      language_name: "English",
      script: "latin",
      word_count_actual: wordCount,
      has_image: false,
      has_source_url: true,
      source_url: w.url,
      is_generic_title: /^(Chapter|Part) /i.test(c.title),
      flags: [],
    });
    return {
      id: chapterId,
      title: c.title,
      content,
      chapter_number: i + 1,
      word_count: wordCount,
      is_original: false,
    };
  });

  rawWorks.push({
    id: workId,
    title: w.title,
    author: {
      id: uuidFrom(`author:${w.author.name}`),
      name: w.author.name,
      biography: w.author.biography,
      birth_year: w.author.birth_year,
      death_year: w.author.death_year,
      nationality: w.author.nationality,
    },
    era: { name: w.era },
    genre: { name: w.genre },
    language: { name: w.language, direction: "ltr" },
    description: `${w.description} Translated by ${w.translator}.`,
    difficulty: w.difficulty,
    is_published: true,
    published_year: w.published_year,
    total_chapters: rawChapters.length,
    chapters: rawChapters,
  });

  const words = chapters.reduce((s, c) => s + c.paragraphs.join(" ").split(/\s+/).length, 0);
  console.log(`${w.title}: ${chapters.length} chapters, ${words.toLocaleString("en-US")} words`);
}

writeFileSync(
  resolve(root, "hart-works.json"),
  JSON.stringify(
    {
      works: rawWorks,
      source:
        "Public-domain English editions hosted by David M. Hart's Digital Library of Liberty and Power (davidmhart.com)",
      exported_at: new Date().toISOString(),
    },
    null,
    1,
  ),
);
writeFileSync(resolve(root, "hart-audit.json"), JSON.stringify({ audited_chapters: audited }, null, 1));
console.log(`\n${rawWorks.length} works written to hart-works.json`);
