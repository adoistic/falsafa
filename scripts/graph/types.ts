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
  mentions: { work_slug: string; paragraph_id: string; stance: ReferenceStance; quote: string }[];
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

// --- figure layer (people / characters / deities portrayed in works) ---

export type FigureKind = "mythological" | "deity" | "historical";

// --- entity layer (full 7-category taxonomy) ---

/**
 * Seven-category entity taxonomy.
 *
 * figure  — persons/deities/heroes INCLUDING theriomorphic ones (Hanumān, Garuḍa, nāga-kings).
 *           Test = personhood/agency/divinity, NOT body.
 * animal  — creatures-AS-creatures only (the cow as wealth/symbol, the sacrificial horse,
 *           generic serpents). NEVER classify a worshipped/agentive theriomorphic being here.
 * place   — cities, kingdoms, rivers, mountains, forests, sacred sites, cosmic worlds,
 *           and the *idea* of place (home, homeland, exile).
 * group   — clans, peoples, castes, sects, dynasties (Bharadvājas, Ārya/Dāsa, Kurus, varṇas).
 * idea    — dharma, ṛta, karma, mokṣa, liberty, virtue, fate, kāla.
 * object  — vajra, soma, great bows/weapons, mantras (Gāyatrī), ritual implements.
 * event   — Vṛtra-slaying, churning of the ocean, the great wars, sacrifices (Aśvamedha).
 */
export type EntityKind = "figure" | "animal" | "place" | "group" | "idea" | "object" | "event";

export interface EntityRaw {
  work_slug: string;
  canonical_name: string;
  surface_names: string[];
  kind: EntityKind;
  /** For kind="figure": sub-classification mirroring FigureKind. Absent for other kinds. */
  figure_kind?: FigureKind;
  mentions: { paragraph_id: string; quote: string; role: string }[];
  /** Short description of how this entity is portrayed in this work. */
  description: string;
  /** For kind="figure" only: other works that originate or define this figure. */
  founding_texts?: string[];
}

export interface EntityWorkAppearance {
  work_slug: string;
  named_as: string;
  mention_count: number;
  description: string;
}

export interface EntityNode {
  id: string;
  canonical_name: string;
  kind: EntityKind;
  figure_kind?: FigureKind;   // only for kind="figure"
  aliases: string[];
  works: EntityWorkAppearance[];
  work_count: number;
  total_mentions: number;
  founding_texts?: string[];  // only for kind="figure"
}

export interface FigureRaw {
  work_slug: string;
  canonical_name: string;
  surface_names: string[];
  figure_kind: FigureKind;
  mentions: { paragraph_id: string; quote: string; role: string }[];
  portrayal: string;
  founding_texts: string[];
}

export interface FigureWorkAppearance {
  work_slug: string;
  named_as: string;       // the canonical_name this work used for the figure
  mention_count: number;
  portrayal: string;
}

export interface FigureNode {
  id: string;             // canonical figure slug (after theonym/alias merge)
  canonical_name: string; // display name
  kind: FigureKind;
  aliases: string[];      // every surface/canonical name seen across works
  works: FigureWorkAppearance[];
  work_count: number;
  total_mentions: number;
  founding_texts: string[];
}

export type FoundingStatus = "in_corpus_work" | "in_corpus_author" | "absent";

export interface FoundingTextEntry {
  label: string;
  normalized: string;
  status: FoundingStatus;
  target_id: string | null;       // work-slug or author-slug when held
  related_in_corpus: string[];    // same-title works we hold under a different author
  figure_count: number;           // distinct figures pointing at this text
  figures: string[];
  recurrence: number;             // summed mentions of those figures (rank tiebreak)
}
