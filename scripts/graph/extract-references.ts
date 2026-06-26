import { readFileSync } from "node:fs";
import { join } from "node:path";
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

export const EXTRACTION_PROMPT = `You are extracting EXPLICIT references from one work in a philosophy corpus.
A reference is where the text names another work or author (cites, quotes, invokes as authority, rebuts, extends).
For each, return: citing_paragraph_id (the p-xxxxxx it appears in), raw_target (the work/author named, as written),
target_kind ("work"|"author"), stance ("endorse"|"refute"|"extend"|"authority"|"neutral"), quote (a short verbatim
snippet containing the reference). Cite only real p-ids from the provided paragraphs; quotes must be verbatim.
Return JSON: { "references": RawReference[] }.`;

export async function extractReferences(
  corpusRoot: string, slug: string, chapterDirs: string[],
): Promise<RawReference[]> {
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
  const model = process.env["OPENROUTER_MODEL"] ?? "anthropic/claude-sonnet-4-6";

  const realIds = paragraphIdsFor(corpusRoot, slug, chapterDirs);
  const paragraphs = chapterDirs.flatMap((dir) =>
    JSON.parse(readFileSync(join(corpusRoot, "works", slug, "chapters", dir, "translation.paragraphs.json"), "utf-8")) as { id: string; text: string }[]);

  const result = await chat<{ references: RawReference[] }>({
    apiKey,
    model,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: JSON.stringify({ slug, paragraphs }) },
    ],
    json_schema: {
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
    },
    temperature: 0,
  });

  const refs = (result.parsed?.references ?? []).map((r) => ({ ...r, citing_work_slug: slug }));
  return validateRawReferences(refs, realIds).kept;
}
