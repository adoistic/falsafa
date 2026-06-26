import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AcquisitionEntry, Manifest } from "./types";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = join(ROOT, "corpus");
const OUT = join(CORPUS, "graph");

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function main() {
  const acquisition = JSON.parse(
    readFileSync(join(OUT, "acquisition-list.json"), "utf-8"),
  ) as AcquisitionEntry[];

  const manifest = JSON.parse(
    readFileSync(join(CORPUS, "manifest.json"), "utf-8"),
  ) as Manifest;

  // work-slug → title
  const titleBySlug = new Map(manifest.works.map((w) => [w.slug, w.title]));

  // --- Build the markdown ---
  const lines: string[] = [
    "# To add to the archive",
    "",
    "Works and authors the corpus cites but does not hold, ranked by how often they are referenced, with how each was characterized.",
    "",
  ];

  const top40 = acquisition.slice(0, 40);

  for (const entry of top40) {
    const distinctCitingWorks = new Set(entry.cited_by.map((c) => c.work_slug)).size;
    lines.push(
      `## ${entry.label} — referenced ${entry.citation_count}× by ${distinctCitingWorks} distinct citing work${distinctCitingWorks !== 1 ? "s" : ""}`,
    );
    lines.push("");

    const mentionsToShow = entry.mentions.slice(0, 6);
    for (const m of mentionsToShow) {
      const title = titleBySlug.get(m.work_slug) ?? m.work_slug;
      const quote = truncate(m.quote, 200);
      lines.push(`- **${title}** _[${m.stance}]_: "${quote}"`);
    }
    lines.push("");
  }

  const md = lines.join("\n");
  writeFileSync(join(OUT, "acquisition.md"), md);

  // --- stdout summary ---
  console.log(`Total absent entries: ${acquisition.length}`);
  console.log("");
  console.log("Top 12:");
  for (const entry of acquisition.slice(0, 12)) {
    console.log(`${String(entry.citation_count).padStart(4)}×  ${entry.label}`);
  }
}

main();
