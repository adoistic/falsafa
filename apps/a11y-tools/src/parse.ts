import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { ConformanceDocSchema, type ConformanceDoc } from "./types.js";

export function parseConformanceDocText(text: string): ConformanceDoc {
  const raw = parseYaml(text);
  if (raw === null || typeof raw !== "object") {
    throw new Error("conformance.yaml: expected top-level object");
  }
  return ConformanceDocSchema.parse(raw);
}

export async function parseConformanceDoc(path: string): Promise<ConformanceDoc> {
  const text = await readFile(path, "utf8");
  return parseConformanceDocText(text);
}
