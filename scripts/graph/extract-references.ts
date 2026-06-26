import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chat } from "../lib/openrouter-chat";
import type { RawReference } from "./types";

export function validateRawReferences(
  records: RawReference[],
  realParagraphIds: Set<string>,
): { kept: RawReference[]; dropped: RawReference[] } {
  const kept: RawReference[] = [];
  const dropped: RawReference[] = [];
  for (const r of records) (realParagraphIds.has(r.citing_paragraph_id) ? kept : dropped).push(r);
  return { kept, dropped };
}

export function paragraphIdsFor(corpusRoot: string, slug: string, chapterDirs: string[]): Set<string> {
  const ids = new Set<string>();
  for (const dir of chapterDirs) {
    const file = join(corpusRoot, "works", slug, "chapters", dir, "translation.paragraphs.json");
    for (const p of JSON.parse(readFileSync(file, "utf-8")) as { id: string }[]) ids.add(p.id);
  }
  return ids;
}

export const MAX_WINDOW_CHARS = 40000; // ~12k tokens per call, leaves room for output

export function chunkByCharBudget<T extends { text: string }>(items: T[], maxChars: number): T[][] {
  const windows: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const it of items) {
    const len = it.text.length;
    if (cur.length > 0 && size + len > maxChars) { windows.push(cur); cur = []; size = 0; }
    cur.push(it);
    size += len;
  }
  if (cur.length > 0) windows.push(cur);
  return windows;
}

export const EXTRACT_VERSION = "v2";

export const EXTRACTION_PROMPT = `You are extracting EXPLICIT CITATIONS from one work in a philosophy/history corpus.
A CITATION is where the text invokes ANOTHER WORK or AUTHOR as a source or authority: it quotes them,
names their book, attributes a view to them, defers to them, argues against them, or builds on them
(e.g. "as Aristotle says", "in the Wealth of Nations", "contrary to Hume").
Do NOT extract:
- bare mentions of historical persons, rulers, characters, places, or figures the text merely narrates
  about, describes, or lists (a history naming emperors and senators is NOT citing them);
- the work citing its own author or itself.
When unsure whether a named person is invoked as an authority/source vs merely mentioned, EXCLUDE it.
For each citation return: citing_paragraph_id (the p-xxxxxx it appears in), raw_target (the work or author
as written), target_kind ("work"|"author"), stance ("endorse"|"refute"|"extend"|"authority"|"neutral"),
quote (a short verbatim snippet). Cite only real p-ids from the provided paragraphs; quotes verbatim.
Return JSON: { "references": [...] }.`;

export const EXTRACT_CONCURRENCY = 6;

export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]!, idx);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return results;
}

const JSON_SCHEMA = {
  name: "extract_references",
  strict: true,
  schema: {
    type: "object",
    properties: {
      references: {
        type: "array",
        items: {
          type: "object",
          properties: {
            citing_paragraph_id: { type: "string" },
            raw_target: { type: "string" },
            target_kind: { type: "string", enum: ["work", "author"] },
            stance: { type: "string", enum: ["endorse", "refute", "extend", "authority", "neutral"] },
            quote: { type: "string" },
          },
          required: ["citing_paragraph_id", "raw_target", "target_kind", "stance", "quote"],
          additionalProperties: false,
        },
      },
    },
    required: ["references"],
    additionalProperties: false,
  },
} as const;

export async function extractReferences(
  corpusRoot: string, slug: string, chapterDirs: string[],
): Promise<RawReference[]> {
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
  const model = process.env["OPENROUTER_MODEL"] ?? "anthropic/claude-sonnet-4-6";

  const realIds = paragraphIdsFor(corpusRoot, slug, chapterDirs);
  const allParagraphs = chapterDirs.flatMap((dir) =>
    JSON.parse(readFileSync(join(corpusRoot, "works", slug, "chapters", dir, "translation.paragraphs.json"), "utf-8")) as { id: string; text: string }[]);

  const windows = chunkByCharBudget(allParagraphs, MAX_WINDOW_CHARS);

  const perWindow = await mapWithConcurrency(windows, EXTRACT_CONCURRENCY, async (paragraphs) => {
    const result = await chat<{ references: RawReference[] }>({
      apiKey,
      model,
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: JSON.stringify({ slug, paragraphs }) },
      ],
      json_schema: JSON_SCHEMA,
      temperature: 0,
    });
    return (result.parsed?.references ?? []).map((r) => ({ ...r, citing_work_slug: slug }));
  });

  const accumulated = perWindow.flat();
  return validateRawReferences(accumulated, realIds).kept;
}

export async function getReferences(corpusRoot: string, slug: string, chapterDirs: string[]): Promise<RawReference[]> {
  const cachePath = join(corpusRoot, "graph", "raw", EXTRACT_VERSION, `${slug}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf-8")) as RawReference[];
  }
  const refs = await extractReferences(corpusRoot, slug, chapterDirs);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(refs, null, 2));
  return refs;
}
