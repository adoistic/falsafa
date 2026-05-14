import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConformanceDoc } from "../parse.js";
import type { ConformanceDoc } from "../types.js";

const TPL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function renderExceptionsBlock(doc: ConformanceDoc): string {
  const exceptions = doc.criteria.filter((c) => c.status === "not-applicable" && c.exception);
  if (exceptions.length === 0) return "<p>(none)</p>";
  return (
    "<ul>" +
    exceptions
      .map(
        (c) =>
          `<li><strong>WCAG ${c.id} ${escapeHtml(c.name)} (${c.level})</strong> — ${escapeHtml(c.notes)}</li>`,
      )
      .join("\n") +
    "</ul>"
  );
}

export function renderAnnexF(doc: ConformanceDoc, now: Date): string {
  const template = readFileSync(resolve(TPL_DIR, "annex-f.html.tmpl"), "utf8");
  const subs: Record<string, string> = {
    generatedAt: now.toISOString().slice(0, 10),
    standard: doc.meta.standard,
    conformanceLevel: doc.meta.conformance_level,
    contact: escapeHtml(doc.meta.contact),
    lastReview: doc.meta.last_review,
    nextReview: doc.meta.next_review,
    exceptionsBlock: renderExceptionsBlock(doc),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => subs[key] ?? "");
}

export async function generate(): Promise<void> {
  const root = process.cwd();
  const doc = await parseConformanceDoc(resolve(root, "docs/accessibility/conformance.yaml"));
  const html = renderAnnexF(doc, new Date());
  const htmlPath = resolve(root, "docs/accessibility/statement-en301549.html");
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html);
  console.log(`Generated ${htmlPath}`);
}
