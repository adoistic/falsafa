import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildFoundingTextList, indexWorks, mergeFigures } from "./figures";
import type { FigureNode, FigureRaw, FoundingTextEntry, Manifest } from "./types";

const ROOT = resolve(import.meta.dir, "..", "..");
const CORPUS = join(ROOT, "corpus");
const FIG_DIR = join(CORPUS, "graph", "figures", "v1");
const OUT = join(CORPUS, "graph");

function loadFigures(): FigureRaw[] {
  if (!existsSync(FIG_DIR)) return [];
  const all: FigureRaw[] = [];
  for (const f of readdirSync(FIG_DIR)) {
    if (!f.endsWith(".json")) continue;
    const arr = JSON.parse(readFileSync(join(FIG_DIR, f), "utf-8")) as FigureRaw[];
    all.push(...arr);
  }
  return all;
}

function mdFiguresAcrossCorpus(nodes: FigureNode[]): string {
  const cross = nodes.filter((n) => n.work_count >= 2);
  const lines: string[] = [
    "# Figures across the corpus",
    "",
    `${nodes.length} distinct figures · ${cross.length} appear in 2+ works.`,
    "",
  ];
  for (const n of cross.slice(0, 50)) {
    lines.push(`## ${n.canonical_name}  _(${n.kind}, ${n.work_count} works, ${n.total_mentions} mentions)_`);
    const others = n.aliases.filter((a) => a !== n.canonical_name);
    if (others.length) lines.push(`*also named:* ${others.join(", ")}`);
    for (const w of n.works) lines.push(`- **${w.work_slug}** — named “${w.named_as}”, ${w.mention_count} mentions`);
    if (n.founding_texts.length) lines.push(`- *founding:* ${n.founding_texts.join("; ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

function mdFoundingTexts(list: FoundingTextEntry[]): string {
  const held = list.filter((e) => e.status !== "absent");
  const absent = list.filter((e) => e.status === "absent");
  const lines: string[] = [
    "# Founding texts",
    "",
    "Where the corpus's mythological and historical figures come from. Internal links are the texts we",
    "already hold; the acquisition list is ranked by how many distinct figures point at a missing source.",
    "",
    `## Already in the archive — internal founding links (${held.length})`,
    "",
  ];
  for (const e of held) {
    lines.push(`- **${e.label}** → \`${e.target_id}\`  _(${e.figure_count} figures · ${e.status.replace("in_corpus_", "")})_`);
  }
  lines.push("", `## To add to the archive — founding texts, ranked (${absent.length})`, "");
  for (const e of absent) {
    const rel = e.related_in_corpus.length ? `  — we hold a same-titled work: ${e.related_in_corpus.join(", ")}` : "";
    lines.push(`- **${e.label}** — ${e.figure_count} figures${rel}`);
  }
  return lines.join("\n");
}

async function main() {
  const manifest = JSON.parse(await Bun.file(join(CORPUS, "manifest.json")).text()) as Manifest;
  const indexed = indexWorks(manifest.works);
  const raws = loadFigures();
  const nodes = mergeFigures(raws);
  const founding = buildFoundingTextList(nodes, indexed);

  const stats = {
    figure_files: existsSync(FIG_DIR) ? readdirSync(FIG_DIR).filter((f) => f.endsWith(".json")).length : 0,
    raw_figures: raws.length,
    distinct_figures: nodes.length,
    cross_work_figures: nodes.filter((n) => n.work_count >= 2).length,
    founding_texts: founding.length,
    founding_in_corpus: founding.filter((e) => e.status !== "absent").length,
    founding_absent: founding.filter((e) => e.status === "absent").length,
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "figure-index.json"), JSON.stringify({ stats, figures: nodes, founding_texts: founding }, null, 2));
  writeFileSync(join(OUT, "figures.md"), mdFiguresAcrossCorpus(nodes));
  writeFileSync(join(OUT, "founding-texts.md"), mdFoundingTexts(founding));
  console.log(stats);
}
main();
