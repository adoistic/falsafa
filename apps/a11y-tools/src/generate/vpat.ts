import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConformanceDoc } from "../parse.js";
import type { ConformanceDoc, Evidence } from "../types.js";

const TPL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");

function statusClass(status: string): string {
  return `status-${status}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function renderEvidence(ev: Evidence[]): string {
  if (ev.length === 0) return "<em>(no evidence)</em>";
  return ev
    .map((e) => {
      const ref = e.lines
        ? `${e.path}:${e.lines}`
        : e.anchor
          ? `${e.path} (anchor: ${e.anchor})`
          : e.path;
      return `<div class="evidence">${e.kind}: ${escapeHtml(ref)}</div>`;
    })
    .join("\n      ");
}

function renderWcagRows(doc: ConformanceDoc): string {
  return doc.criteria
    .map(
      (c) =>
        `      <tr>
        <td>${c.id}</td>
        <td>${escapeHtml(c.name)}</td>
        <td>${c.level}</td>
        <td class="${statusClass(c.status)}">${c.status}${c.exception ? ` (${c.exception})` : ""}</td>
        <td>${escapeHtml(c.notes)}${c.evidence.length > 0 ? "<br>" + renderEvidence(c.evidence) : ""}</td>
      </tr>`,
    )
    .join("\n");
}

function renderSection508Rows(doc: ConformanceDoc): string {
  return doc.section_508
    .map(
      (e) =>
        `      <tr>
        <td>${e.id}</td>
        <td>${escapeHtml(e.name)}</td>
        <td class="${statusClass(e.status)}">${e.status}</td>
        <td>${escapeHtml(e.notes ?? "")}</td>
      </tr>`,
    )
    .join("\n");
}

function renderEnRows(doc: ConformanceDoc): string {
  return doc.en_301_549
    .map(
      (e) =>
        `      <tr>
        <td>${e.clause}</td>
        <td>${escapeHtml(e.name)}</td>
        <td class="${statusClass(e.status)}">${e.status}</td>
        <td>${escapeHtml(e.notes ?? "")}</td>
      </tr>`,
    )
    .join("\n");
}

function renderExceptionsBlock(doc: ConformanceDoc): string {
  const exceptions = doc.criteria.filter((c) => c.status === "not-applicable" && c.exception);
  if (exceptions.length === 0) return "<p>(none)</p>";
  return exceptions
    .map(
      (c) =>
        `<div class="exception">
  <strong>WCAG ${c.id} ${escapeHtml(c.name)} (${c.level})</strong> — Exception: ${escapeHtml(c.exception!)}<br>
  ${escapeHtml(c.notes)}
</div>`,
    )
    .join("\n");
}

export function renderVpat(doc: ConformanceDoc, productName: string, now: Date): string {
  const template = readFileSync(resolve(TPL_DIR, "vpat-2.5-int.html.tmpl"), "utf8");
  const subs: Record<string, string> = {
    productName: escapeHtml(productName),
    generatedAt: now.toISOString().slice(0, 10),
    standard: doc.meta.standard,
    conformanceLevel: doc.meta.conformance_level,
    contact: escapeHtml(doc.meta.contact),
    lastReview: doc.meta.last_review,
    nextReview: doc.meta.next_review,
    criteriaCount: String(doc.criteria.length),
    wcagRows: renderWcagRows(doc),
    section508Rows: renderSection508Rows(doc),
    enRows: renderEnRows(doc),
    exceptionsBlock: renderExceptionsBlock(doc),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => subs[key] ?? "");
}

export async function generate(): Promise<void> {
  const root = process.cwd();
  const doc = await parseConformanceDoc(resolve(root, "docs/accessibility/conformance.yaml"));
  const html = renderVpat(doc, "Falsafa", new Date());
  const htmlPath = resolve(root, "docs/accessibility/vpat-v1.0.html");
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html);
  console.log(`Generated ${htmlPath}`);
}
