import { slugify } from "../lib/slug";
import type { AcquisitionEntry, ResolvedReference } from "./types";

export function buildAcquisitionList(resolved: ResolvedReference[]): AcquisitionEntry[] {
  const byTarget = new Map<string, AcquisitionEntry>();
  for (const ref of resolved) {
    if (ref.status !== "absent") continue;
    const key = slugify(ref.raw_target);
    const entry = byTarget.get(key) ?? { normalized_target: key, label: ref.raw_target, citation_count: 0, cited_by: [] };
    entry.citation_count += 1;
    entry.cited_by.push({ work_slug: ref.citing_work_slug, paragraph_id: ref.citing_paragraph_id });
    byTarget.set(key, entry);
  }
  return [...byTarget.values()].sort(
    (a, b) => b.citation_count - a.citation_count || a.normalized_target.localeCompare(b.normalized_target),
  );
}
