export type ReferenceStance = "endorse" | "refute" | "extend" | "authority" | "neutral";

export interface RawReference {
  citing_work_slug: string;
  citing_paragraph_id: string; // "p-xxxxxx", must exist in the citing work
  raw_target: string;          // the work or author named, as written
  target_kind: "work" | "author";
  stance: ReferenceStance;
  quote: string;               // short verbatim snippet containing the reference
}

export type ResolutionStatus =
  | "in_corpus_work"
  | "in_corpus_author"
  | "absent"
  | "ambiguous";

export interface ResolvedReference extends RawReference {
  status: ResolutionStatus;
  target_id: string | null;    // resolved work-slug / author-slug, else null
  candidates: string[];        // populated when status === "ambiguous"
}

export interface GraphNode {
  id: string;                  // work-slug | author-slug | "absent:<normalized>"
  kind: "work" | "author" | "absent";
  label: string;
  in_corpus: boolean;
  cited_by_count: number;      // inbound citations (filled by withBacklinks)
}

export interface GraphEdge {
  from: string;                // citing work-slug
  to: string;                  // target node id
  type: "cites";
  stance: ReferenceStance;
  citations: { paragraph_id: string; quote: string }[];
}

export interface CitationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AcquisitionEntry {
  normalized_target: string;
  label: string;
  citation_count: number;
  cited_by: { work_slug: string; paragraph_id: string }[];
}

export interface ManifestWork {
  slug: string;
  title: string;
  author: string;
  author_slug: string;
}
export interface Manifest {
  works: ManifestWork[];
}
