import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

type Stance = "endorse" | "refute" | "extend" | "authority" | "neutral";
type AnchorType = "paragraph_ids" | "paragraph_range";

interface ManifestWork {
  slug: string;
  title: string;
  author: string;
  era?: string;
  genre?: string;
  genre_slug?: string;
  language?: string;
  language_slug?: string;
  description?: string;
  thothica_role?: string;
}

interface Manifest {
  works: ManifestWork[];
}

export interface SourceParagraph {
  id: string;
  offset?: number;
  text: string;
  chapter: string;
}

interface Evidence {
  anchor_type: AnchorType;
  paragraph_ids?: string[];
  paragraph_range?: { start: string; end: string };
  evidence_hint: string;
  role: string;
  expanded_paragraph_ids?: string[];
  quotes?: EvidenceQuote[];
}

interface EvidenceQuote {
  paragraph_id: string;
  quote: string;
  selection_method: "terms_sentence" | "paragraph_fallback";
  selection_score: number;
}

interface Entity {
  canonical_name: string;
  surface_names: string[];
  kind: "figure" | "animal" | "place" | "group" | "idea" | "object" | "event";
  figure_kind?: "historical" | "mythological" | "deity";
  evidence: Evidence[];
  description: string;
  justification: string;
}

interface Theme {
  topic: string;
  implicit: boolean;
  evidence: Evidence[];
  justification: string;
}

interface Citation {
  cited_work: string;
  cited_author: string;
  stance: Stance;
  evidence: Evidence[];
  justification: string;
}

interface QuoteEvent {
  kind: "direct_quote" | "reported_speech" | "citation_quote";
  speaker?: string;
  quoted_person?: string;
  quoted_work?: string;
  quoted_author?: string;
  stance?: Stance;
  source: "manual";
  evidence: Evidence[];
  justification: string;
}

export interface OntologyOutput {
  work_slug: string;
  extracted_at: string;
  ontology_version: "anchor-range-v1";
  window_chapters: string[];
  entities: Entity[];
  themes: Theme[];
  citations: Citation[];
  quote_events: QuoteEvent[];
}

export interface WorkWindow {
  window_id: string;
  work_slug: string;
  title: string;
  author: string;
  genre: string;
  language: string;
  chapter_tokens: string[];
  paragraphs: SourceParagraph[];
  prompt: string;
  anchor_path: string;
  enriched_path: string;
  meta_path: string;
}

export interface AttemptMeta {
  started_at: string;
  finished_at: string;
  latency_ms: number;
  status: "valid" | "failed";
  reason?: string;
  usage: Usage | null;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface WindowMeta {
  window_id: string;
  work_slug: string;
  chapter_tokens: string[];
  prompt_version: "anchor-range-v1";
  prompt_path: string;
  model: string;
  base_url: string;
  server_config: Record<string, unknown>;
  started_at: string;
  finished_at: string;
  latency_ms: number;
  attempts: AttemptMeta[];
  validation: ValidationResult;
  enrichment: EnrichmentResult;
  usage: Usage | null;
}

export interface ValidationResult {
  valid_json: boolean;
  schema_valid: boolean;
  paragraph_anchor_valid: boolean;
  errors: string[];
}

export interface EnrichmentResult {
  success: boolean;
  evidence_objects: number;
  quotes_attached: number;
  paragraph_fallbacks: number;
  errors: string[];
}

interface SegmentSummary {
  concurrency: number;
  attempted: number;
  completed: number;
  valid_json: number;
  schema_valid: number;
  paragraph_anchor_valid: number;
  enriched: number;
  valid: number;
  retries: number;
  failures_by_reason: Record<string, number>;
  wall_clock_seconds: number;
  windows_per_minute: number;
  valid_windows_per_hour: number;
  prompt_tokens_per_window: number | null;
  completion_tokens_per_window: number | null;
  output_tokens_per_second: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  max_latency_ms: number | null;
  gpu_cost_hour: number;
  approx_gpu_cost: number;
  cost_per_valid_window: number | null;
  decision: string;
}

export const ROOT = resolve(import.meta.dir, "..", "..");
export const CORPUS = join(ROOT, "corpus");
export const PROMPT_PATH = join(ROOT, "scripts", "graph", "prompts", "ontology-anchor-range-v1.md");
const DEFAULT_RUN_ID = "2026-07-01-glm52-runpod";
const MAX_WINDOW_CHARS = 40_000;
const DEFAULT_MAX_TOKENS = 32_768;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const RETRIES = 1;

function argValue(name: string, fallback?: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i >= 0) return process.argv[i + 1] ?? fallback;
  return fallback;
}

function hasArg(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseList(value: string | undefined, fallback: number[]): number[] {
  if (!value) return fallback;
  return value.split(",").map((x) => Number.parseInt(x.trim(), 10)).filter((x) => Number.isFinite(x));
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function priorityScore(w: ManifestWork): number {
  let score = 0;
  if (w.genre === "Law" || w.genre_slug === "indic") score += 100;
  if (w.language === "Sanskrit" || w.language === "Kawi") score += 90;
  if ((w.language === "Greek" || w.language === "Latin") && w.genre === "Philosophy") score += 80;
  if (w.language === "Greek" || w.language === "Latin") score += 50;
  if (w.language === "English" && (w.genre === "Philosophy" || w.genre === "Political Theory")) score += 40;
  if (w.language === "English" && w.genre === "Poetry") score += 30;
  if (w.era === "Ancient" || w.era === "Classical") score += 20;
  if (w.era === "Hellenistic" || w.era === "Imperial") score += 10;
  return score;
}

function paragraphFile(slug: string, chapter: string): string | null {
  const base = join(CORPUS, "works", slug, "chapters", chapter);
  for (const file of ["translation.paragraphs.json", "original.paragraphs.json", "transliteration.paragraphs.json"]) {
    const path = join(base, file);
    if (existsSync(path)) return path;
  }
  return null;
}

function markdownParagraphs(slug: string, chapter: string): SourceParagraph[] {
  const path = join(CORPUS, "works", slug, "chapters", chapter, "original.md");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf-8");
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#"))
    .map((text, i) => ({
      id: `p-md-${chapter}-${String(i + 1).padStart(4, "0")}`,
      text,
      chapter,
    }));
}

function loadChapterParagraphs(slug: string, chapter: string): SourceParagraph[] {
  const pf = paragraphFile(slug, chapter);
  if (!pf) return markdownParagraphs(slug, chapter);
  const rows = readJson<Array<{ id: string; offset?: number; text: string }>>(pf);
  return rows.filter((p) => p.id && p.text).map((p) => ({ ...p, chapter }));
}

function parseChapterToken(token: string): { chapter: string; start?: number; end?: number } {
  const match = /^(.+):(\d+)-(\d+|end)$/.exec(token);
  if (!match) return { chapter: token };
  const parsed: { chapter: string; start?: number; end?: number } = {
    chapter: match[1]!,
    start: Number.parseInt(match[2]!, 10),
  };
  if (match[3] !== "end") parsed.end = Number.parseInt(match[3]!, 10);
  return parsed;
}

function loadTokenParagraphs(slug: string, token: string): SourceParagraph[] {
  const parsed = parseChapterToken(token);
  const paragraphs = loadChapterParagraphs(slug, parsed.chapter);
  if (parsed.start === undefined) return paragraphs;
  return paragraphs.slice(parsed.start, parsed.end === undefined ? undefined : parsed.end + 1);
}

function chapterChars(slug: string, chapter: string): number {
  return loadChapterParagraphs(slug, chapter).reduce((sum, p) => sum + p.text.length, 0);
}

function subwindowChapter(slug: string, chapter: string): { token: string; chars: number }[] {
  const paragraphs = loadChapterParagraphs(slug, chapter);
  const chunks: { token: string; chars: number }[] = [];
  let start = 0;
  let chars = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    chars += paragraphs[i]!.text.length;
    if (chars > MAX_WINDOW_CHARS && i > start) {
      chunks.push({ token: `${chapter}:${start}-${i - 1}`, chars: chars - paragraphs[i]!.text.length });
      start = i;
      chars = paragraphs[i]!.text.length;
    }
  }
  if (paragraphs.length > 0) chunks.push({ token: `${chapter}:${start}-${paragraphs.length - 1}`, chars });
  return chunks;
}

function buildChapterWindows(slug: string, chapterDirs: string[]): string[][] {
  const expanded: { token: string; chars: number }[] = [];
  for (const chapter of chapterDirs) {
    const chars = chapterChars(slug, chapter);
    if (chars === 0) continue;
    if (chars > MAX_WINDOW_CHARS && paragraphFile(slug, chapter)) {
      expanded.push(...subwindowChapter(slug, chapter));
    } else {
      expanded.push({ token: chapter, chars });
    }
  }

  const windows: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const item of expanded) {
    if (current.length > 0 && currentChars + item.chars > MAX_WINDOW_CHARS) {
      windows.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item.token);
    currentChars += item.chars;
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

function promptTemplate(): string {
  const markdown = readFileSync(PROMPT_PATH, "utf-8");
  const match = /```text\n([\s\S]*?)\n```/.exec(markdown);
  if (!match) throw new Error(`Could not find text prompt template in ${PROMPT_PATH}`);
  return match[1]!;
}

function renderPrompt(work: ManifestWork, chapterTokens: string[], paragraphs: SourceParagraph[]): string {
  const source = paragraphs.map((p) => `${p.id}\t${p.text}`).join("\n\n");
  const allowed = paragraphs.map((p) => p.id).join("\n");
  const language = [
    work.language ?? "",
    work.language_slug ? `(${work.language_slug})` : "",
  ].filter(Boolean).join(" ");
  return promptTemplate()
    .replaceAll("<WORK_TITLE>", work.title)
    .replaceAll("<AUTHOR_OR_ATTRIBUTION>", work.author || "Unknown")
    .replaceAll("<GENRE_OR_TRADITION_IF_KNOWN>", work.genre || work.thothica_role || "")
    .replaceAll("<LANGUAGE_OR_TRANSLATION_INFO_IF_KNOWN>", language)
    .replaceAll("<SECTION_OR_WINDOW_LABEL>", chapterTokens.join(","))
    .replaceAll("<WORK_SLUG>", work.slug)
    .replace("<ALLOWED_PARAGRAPH_IDS>", allowed)
    .replace("<PARAGRAPH_ID>\t<PARAGRAPH_TEXT>\n\n<PARAGRAPH_ID>\t<PARAGRAPH_TEXT>", source);
}

function windowPaths(runDir: string, windowId: string): Pick<WorkWindow, "anchor_path" | "enriched_path" | "meta_path"> {
  const dir = join(runDir, "windows");
  return {
    anchor_path: join(dir, `${windowId}.anchor.json`),
    enriched_path: join(dir, `${windowId}.enriched.json`),
    meta_path: join(dir, `${windowId}.meta.json`),
  };
}

export function buildWindows(runDir: string): WorkWindow[] {
  const manifest = readJson<Manifest>(join(CORPUS, "manifest.json"));
  const sorted = [...manifest.works].sort((a, b) => priorityScore(b) - priorityScore(a));
  const windows: WorkWindow[] = [];
  for (const work of sorted) {
    if (work.slug === "mahabharata") continue;
    const chaptersDir = join(CORPUS, "works", work.slug, "chapters");
    if (!existsSync(chaptersDir)) continue;
    const chapterDirs = readdirSync(chaptersDir).sort();
    const chapterWindows = buildChapterWindows(work.slug, chapterDirs);
    chapterWindows.forEach((chapterTokens, index) => {
      const paragraphs = chapterTokens.flatMap((token) => loadTokenParagraphs(work.slug, token));
      if (paragraphs.length === 0) return;
      const suffix = chapterWindows.length > 1 ? `part${String(index + 1).padStart(3, "0")}` : "part001";
      const windowId = safeId(`${work.slug}-${suffix}`);
      windows.push({
        window_id: windowId,
        work_slug: work.slug,
        title: work.title,
        author: work.author,
        genre: work.genre ?? "",
        language: work.language ?? "",
        chapter_tokens: chapterTokens,
        paragraphs,
        prompt: renderPrompt(work, chapterTokens, paragraphs),
        ...windowPaths(runDir, windowId),
      });
    });
  }
  return windows;
}

export function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("response is not JSON");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateEvidence(path: string, evidence: unknown, ids: Set<string>, order: Map<string, number>, errors: string[]): void {
  if (!isObject(evidence)) {
    errors.push(`${path}: evidence is not an object`);
    return;
  }
  const anchorType = evidence["anchor_type"];
  if (anchorType !== "paragraph_ids" && anchorType !== "paragraph_range") {
    errors.push(`${path}: invalid anchor_type`);
    return;
  }
  if (typeof evidence["evidence_hint"] !== "string" || evidence["evidence_hint"].length === 0) {
    errors.push(`${path}: missing evidence_hint`);
  }
  if (typeof evidence["role"] !== "string" || evidence["role"].length === 0) {
    errors.push(`${path}: missing role`);
  }
  if (anchorType === "paragraph_ids") {
    if ("paragraph_range" in evidence) errors.push(`${path}: paragraph_ids evidence includes paragraph_range`);
    const paragraphIds = evidence["paragraph_ids"];
    if (!Array.isArray(paragraphIds) || paragraphIds.length === 0) {
      errors.push(`${path}: missing paragraph_ids`);
      return;
    }
    for (const id of paragraphIds) {
      if (typeof id !== "string" || !ids.has(id)) errors.push(`${path}: invalid paragraph id ${String(id)}`);
    }
    return;
  }
  if ("paragraph_ids" in evidence) errors.push(`${path}: paragraph_range evidence includes paragraph_ids`);
  const range = evidence["paragraph_range"];
  if (!isObject(range) || typeof range["start"] !== "string" || typeof range["end"] !== "string") {
    errors.push(`${path}: missing paragraph_range start/end`);
    return;
  }
  const start = range["start"];
  const end = range["end"];
  if (!ids.has(start)) errors.push(`${path}: invalid range start ${start}`);
  if (!ids.has(end)) errors.push(`${path}: invalid range end ${end}`);
  const startIndex = order.get(start);
  const endIndex = order.get(end);
  if (startIndex !== undefined && endIndex !== undefined && startIndex > endIndex) {
    errors.push(`${path}: paragraph_range start comes after end`);
  }
}

export function validateOntology(value: unknown, window: WorkWindow): ValidationResult {
  const errors: string[] = [];
  const ids = new Set(window.paragraphs.map((p) => p.id));
  const order = new Map(window.paragraphs.map((p, i) => [p.id, i]));
  if (!isObject(value)) {
    return { valid_json: true, schema_valid: false, paragraph_anchor_valid: false, errors: ["top-level value is not an object"] };
  }
  const required = ["work_slug", "extracted_at", "ontology_version", "window_chapters", "entities", "themes", "citations", "quote_events"];
  for (const key of required) {
    if (!(key in value)) errors.push(`missing top-level ${key}`);
  }
  if (value["work_slug"] !== window.work_slug) errors.push("work_slug does not match window");
  if (value["ontology_version"] !== "anchor-range-v1") errors.push("ontology_version must be anchor-range-v1");
  for (const key of ["entities", "themes", "citations", "quote_events"]) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
  }
  const entities = Array.isArray(value["entities"]) ? value["entities"] : [];
  entities.forEach((entity, i) => {
    if (!isObject(entity)) {
      errors.push(`entities.${i}: not an object`);
      return;
    }
    for (const key of ["canonical_name", "surface_names", "kind", "evidence", "description", "justification"]) {
      if (!(key in entity)) errors.push(`entities.${i}: missing ${key}`);
    }
    if (entity["kind"] === "figure" && !("figure_kind" in entity)) errors.push(`entities.${i}: figure missing figure_kind`);
    if (entity["kind"] !== "figure" && "figure_kind" in entity) errors.push(`entities.${i}: non-figure has figure_kind`);
    if (Array.isArray(entity["evidence"])) {
      entity["evidence"].forEach((e, j) => validateEvidence(`entities.${i}.evidence.${j}`, e, ids, order, errors));
    }
  });
  const themes = Array.isArray(value["themes"]) ? value["themes"] : [];
  themes.forEach((theme, i) => {
    if (!isObject(theme)) {
      errors.push(`themes.${i}: not an object`);
      return;
    }
    for (const key of ["topic", "implicit", "evidence", "justification"]) {
      if (!(key in theme)) errors.push(`themes.${i}: missing ${key}`);
    }
    if (Array.isArray(theme["evidence"])) {
      theme["evidence"].forEach((e, j) => validateEvidence(`themes.${i}.evidence.${j}`, e, ids, order, errors));
    }
  });
  const citations = Array.isArray(value["citations"]) ? value["citations"] : [];
  citations.forEach((citation, i) => {
    if (!isObject(citation)) {
      errors.push(`citations.${i}: not an object`);
      return;
    }
    for (const key of ["cited_work", "cited_author", "stance", "evidence", "justification"]) {
      if (!(key in citation)) errors.push(`citations.${i}: missing ${key}`);
    }
    if (!citation["cited_work"] && !citation["cited_author"]) errors.push(`citations.${i}: needs cited_work or cited_author`);
    if (Array.isArray(citation["evidence"])) {
      citation["evidence"].forEach((e, j) => validateEvidence(`citations.${i}.evidence.${j}`, e, ids, order, errors));
    }
  });
  const quoteEvents = Array.isArray(value["quote_events"]) ? value["quote_events"] : [];
  quoteEvents.forEach((event, i) => {
    if (!isObject(event)) {
      errors.push(`quote_events.${i}: not an object`);
      return;
    }
    for (const key of ["kind", "source", "evidence", "justification"]) {
      if (!(key in event)) errors.push(`quote_events.${i}: missing ${key}`);
    }
    if (event["source"] !== "manual") errors.push(`quote_events.${i}: source must be manual`);
    if (Array.isArray(event["evidence"])) {
      event["evidence"].forEach((e, j) => validateEvidence(`quote_events.${i}.evidence.${j}`, e, ids, order, errors));
    }
  });
  return {
    valid_json: true,
    schema_valid: errors.length === 0,
    paragraph_anchor_valid: errors.filter((e) => e.includes("invalid paragraph") || e.includes("invalid range") || e.includes("start comes after end")).length === 0,
    errors,
  };
}

function termsForItem(item: Record<string, unknown>, evidence: Evidence): string[] {
  const values: string[] = [];
  for (const key of ["canonical_name", "topic", "cited_work", "cited_author", "speaker", "quoted_person", "quoted_work", "quoted_author"]) {
    const value = item[key];
    if (typeof value === "string") values.push(value);
  }
  const surfaceNames = item["surface_names"];
  if (Array.isArray(surfaceNames)) values.push(...surfaceNames.filter((v): v is string => typeof v === "string"));
  values.push(evidence.evidence_hint, evidence.role);
  return values
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i))
    .filter((term) => term.length >= 4);
}

function sentences(text: string): string[] {
  const parts = text.match(/[^.!?;:]+[.!?;:]?/g) ?? [text];
  return parts.map((p) => p.trim()).filter(Boolean);
}

function selectQuote(paragraph: SourceParagraph, terms: string[]): EvidenceQuote {
  let best = "";
  let bestScore = 0;
  for (const sentence of sentences(paragraph.text)) {
    const lower = sentence.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  if (best && bestScore > 0) {
    return { paragraph_id: paragraph.id, quote: best, selection_method: "terms_sentence", selection_score: bestScore };
  }
  return {
    paragraph_id: paragraph.id,
    quote: paragraph.text,
    selection_method: "paragraph_fallback",
    selection_score: 0,
  };
}

function expandEvidence(evidence: Evidence, order: Map<string, number>, paragraphs: SourceParagraph[]): string[] {
  if (evidence.anchor_type === "paragraph_ids") {
    return [...new Set(evidence.paragraph_ids ?? [])];
  }
  const start = order.get(evidence.paragraph_range?.start ?? "");
  const end = order.get(evidence.paragraph_range?.end ?? "");
  if (start === undefined || end === undefined || start > end) return [];
  return paragraphs.slice(start, end + 1).map((p) => p.id);
}

export function enrichOntology(output: OntologyOutput, window: WorkWindow): { output: OntologyOutput; result: EnrichmentResult } {
  const errors: string[] = [];
  const order = new Map(window.paragraphs.map((p, i) => [p.id, i]));
  const byId = new Map(window.paragraphs.map((p) => [p.id, p]));
  let evidenceObjects = 0;
  let quotesAttached = 0;
  let paragraphFallbacks = 0;

  const enrichEvidence = (item: Record<string, unknown>, evidence: Evidence) => {
    evidenceObjects++;
    const expanded = expandEvidence(evidence, order, window.paragraphs);
    evidence.expanded_paragraph_ids = expanded;
    const terms = termsForItem(item, evidence);
    evidence.quotes = expanded.flatMap((id) => {
      const paragraph = byId.get(id);
      if (!paragraph) {
        errors.push(`missing paragraph during enrichment: ${id}`);
        return [];
      }
      const quote = selectQuote(paragraph, terms);
      if (quote.selection_method === "paragraph_fallback") paragraphFallbacks++;
      quotesAttached++;
      return [quote];
    });
  };

  for (const entity of output.entities) entity.evidence.forEach((e) => enrichEvidence(entity as unknown as Record<string, unknown>, e));
  for (const theme of output.themes) theme.evidence.forEach((e) => enrichEvidence(theme as unknown as Record<string, unknown>, e));
  for (const citation of output.citations) citation.evidence.forEach((e) => enrichEvidence(citation as unknown as Record<string, unknown>, e));
  for (const event of output.quote_events) event.evidence.forEach((e) => enrichEvidence(event as unknown as Record<string, unknown>, e));

  return {
    output,
    result: {
      success: errors.length === 0,
      evidence_objects: evidenceObjects,
      quotes_attached: quotesAttached,
      paragraph_fallbacks: paragraphFallbacks,
      errors,
    },
  };
}

async function chatCompletion(window: WorkWindow, model: string, baseUrl: string, apiKey: string, timeoutMs: number): Promise<{ content: string; usage: Usage | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: window.prompt }],
        temperature: 0,
        max_tokens: Number.parseInt(process.env["ONTOLOGY_MAX_TOKENS"] ?? String(DEFAULT_MAX_TOKENS), 10),
        chat_template_kwargs: {
          enable_thinking: process.env["ONTOLOGY_ENABLE_THINKING"] !== "0",
        },
      }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    const data = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("empty assistant content");
    return { content, usage: data.usage ?? null };
  } finally {
    clearTimeout(timeout);
  }
}

async function runOne(window: WorkWindow, model: string, baseUrl: string, apiKey: string, serverConfig: Record<string, unknown>, timeoutMs: number): Promise<WindowMeta> {
  mkdirSync(dirname(window.anchor_path), { recursive: true });
  const startedAt = new Date().toISOString();
  const attempts: AttemptMeta[] = [];
  let parsed: OntologyOutput | null = null;
  let usage: Usage | null = null;
  let validation: ValidationResult = { valid_json: false, schema_valid: false, paragraph_anchor_valid: false, errors: [] };

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const attemptStart = Date.now();
    const attemptStartedAt = new Date(attemptStart).toISOString();
    try {
      const result = await chatCompletion(window, model, baseUrl, apiKey, timeoutMs);
      usage = result.usage;
      const unknownParsed = extractJson(result.content);
      parsed = unknownParsed as OntologyOutput;
      validation = validateOntology(parsed, window);
      const attemptFinishedAt = new Date().toISOString();
      attempts.push({
        started_at: attemptStartedAt,
        finished_at: attemptFinishedAt,
        latency_ms: Date.now() - attemptStart,
        status: validation.schema_valid && validation.paragraph_anchor_valid ? "valid" : "failed",
        reason: validation.errors[0],
        usage,
      });
      if (validation.schema_valid && validation.paragraph_anchor_valid) break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      validation = {
        valid_json: !message.includes("JSON"),
        schema_valid: false,
        paragraph_anchor_valid: false,
        errors: [message],
      };
      attempts.push({
        started_at: attemptStartedAt,
        finished_at: new Date().toISOString(),
        latency_ms: Date.now() - attemptStart,
        status: "failed",
        reason: message,
        usage,
      });
    }
  }

  let enrichment: EnrichmentResult = {
    success: false,
    evidence_objects: 0,
    quotes_attached: 0,
    paragraph_fallbacks: 0,
    errors: ["validation failed"],
  };
  if (parsed && validation.schema_valid && validation.paragraph_anchor_valid) {
    writeFileSync(window.anchor_path, JSON.stringify(parsed, null, 2));
    const enriched = enrichOntology(parsed, window);
    enrichment = enriched.result;
    if (enrichment.success) writeFileSync(window.enriched_path, JSON.stringify(enriched.output, null, 2));
  }

  const finishedAt = new Date().toISOString();
  const meta: WindowMeta = {
    window_id: window.window_id,
    work_slug: window.work_slug,
    chapter_tokens: window.chapter_tokens,
    prompt_version: "anchor-range-v1",
    prompt_path: PROMPT_PATH,
    model,
    base_url: baseUrl,
    server_config: serverConfig,
    started_at: startedAt,
    finished_at: finishedAt,
    latency_ms: Date.parse(finishedAt) - Date.parse(startedAt),
    attempts,
    validation,
    enrichment,
    usage,
  };
  writeFileSync(window.meta_path, JSON.stringify(meta, null, 2));
  return meta;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index]!;
}

function summarizeSegment(concurrency: number, metas: WindowMeta[], wallClockSeconds: number, gpuCostHour: number): SegmentSummary {
  const failures: Record<string, number> = {};
  let promptTokens = 0;
  let completionTokens = 0;
  let usageCount = 0;
  let retries = 0;
  for (const meta of metas) {
    retries += Math.max(0, meta.attempts.length - 1);
    if (meta.usage?.prompt_tokens !== undefined || meta.usage?.completion_tokens !== undefined) {
      promptTokens += meta.usage.prompt_tokens ?? 0;
      completionTokens += meta.usage.completion_tokens ?? 0;
      usageCount++;
    }
    if (!(meta.validation.schema_valid && meta.validation.paragraph_anchor_valid && meta.enrichment.success)) {
      const reason = meta.validation.errors[0] ?? meta.enrichment.errors[0] ?? "unknown";
      failures[reason] = (failures[reason] ?? 0) + 1;
    }
  }
  const validJson = metas.filter((m) => m.validation.valid_json).length;
  const schemaValid = metas.filter((m) => m.validation.schema_valid).length;
  const anchorValid = metas.filter((m) => m.validation.paragraph_anchor_valid).length;
  const enriched = metas.filter((m) => m.enrichment.success).length;
  const valid = metas.filter((m) => m.validation.schema_valid && m.validation.paragraph_anchor_valid && m.enrichment.success).length;
  const latencies = metas.map((m) => m.latency_ms).filter((n) => Number.isFinite(n));
  const validPerHour = wallClockSeconds > 0 ? valid / (wallClockSeconds / 3600) : 0;
  const approxGpuCost = gpuCostHour * (wallClockSeconds / 3600);
  const validJsonRate = metas.length ? validJson / metas.length : 0;
  const anchorRate = metas.length ? anchorValid / metas.length : 0;
  const retryRate = metas.length ? retries / metas.length : 0;
  const decision = validJsonRate < 0.95
    ? "step down: JSON below 95%"
    : anchorRate < 0.99
      ? "step down: anchors below 99%"
      : retryRate > 0.2
        ? "step down: retries above 20%"
        : "healthy";
  return {
    concurrency,
    attempted: metas.length,
    completed: metas.length,
    valid_json: validJson,
    schema_valid: schemaValid,
    paragraph_anchor_valid: anchorValid,
    enriched,
    valid,
    retries,
    failures_by_reason: failures,
    wall_clock_seconds: wallClockSeconds,
    windows_per_minute: wallClockSeconds > 0 ? metas.length / (wallClockSeconds / 60) : 0,
    valid_windows_per_hour: validPerHour,
    prompt_tokens_per_window: usageCount ? promptTokens / usageCount : null,
    completion_tokens_per_window: usageCount ? completionTokens / usageCount : null,
    output_tokens_per_second: wallClockSeconds > 0 && completionTokens > 0 ? completionTokens / wallClockSeconds : null,
    p50_latency_ms: percentile(latencies, 50),
    p95_latency_ms: percentile(latencies, 95),
    max_latency_ms: latencies.length ? Math.max(...latencies) : null,
    gpu_cost_hour: gpuCostHour,
    approx_gpu_cost: approxGpuCost,
    cost_per_valid_window: valid > 0 ? approxGpuCost / valid : null,
    decision,
  };
}

function alreadyValid(window: WorkWindow): boolean {
  if (!existsSync(window.enriched_path) || !existsSync(window.meta_path)) return false;
  try {
    const meta = readJson<WindowMeta>(window.meta_path);
    return meta.validation.schema_valid && meta.validation.paragraph_anchor_valid && meta.enrichment.success;
  } catch {
    return false;
  }
}

function writeSummary(runDir: string, summaries: SegmentSummary[], windows: WorkWindow[]): void {
  const validPerHour = summaries.at(-1)?.valid_windows_per_hour ?? 0;
  const expectedHours = validPerHour > 0 ? 12_929 / validPerHour : null;
  const gpuCostHour = summaries.at(-1)?.gpu_cost_hour ?? 0;
  const expectedBurn = expectedHours === null ? null : expectedHours * gpuCostHour;
  const summary = {
    generated_at: new Date().toISOString(),
    run_dir: runDir,
    prompt_path: PROMPT_PATH,
    prompt_version: "anchor-range-v1",
    total_discoverable_windows: windows.length,
    segments: summaries,
    recommendation_basis: {
      expected_hours_for_12929_windows: expectedHours,
      expected_runpod_credit_burn: expectedBurn,
    },
  };
  writeFileSync(join(runDir, "run-summary.json"), JSON.stringify(summary, null, 2));
  const lines = [
    "# Ontology Run Summary",
    "",
    `Generated: ${summary.generated_at}`,
    `Prompt: \`${PROMPT_PATH}\``,
    "",
    "| concurrency | attempted | valid | valid % | retries | p95 latency | valid windows/hour | GPU cost/hour | cost/valid window | decision |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...summaries.map((s) => {
      const validPct = s.attempted ? `${((s.valid / s.attempted) * 100).toFixed(1)}%` : "0.0%";
      const p95 = s.p95_latency_ms === null ? "" : `${(s.p95_latency_ms / 1000).toFixed(1)}s`;
      const cost = s.cost_per_valid_window === null ? "" : `$${s.cost_per_valid_window.toFixed(4)}`;
      return `| ${s.concurrency} | ${s.attempted} | ${s.valid} | ${validPct} | ${s.retries} | ${p95} | ${s.valid_windows_per_hour.toFixed(1)} | $${s.gpu_cost_hour.toFixed(2)} | ${cost} | ${s.decision} |`;
    }),
    "",
  ];
  if (expectedHours !== null && expectedBurn !== null) {
    lines.push(`Expected full-run duration at final measured rate: ${expectedHours.toFixed(2)} hours.`);
    lines.push(`Expected RunPod burn at final configured GPU price: $${expectedBurn.toFixed(2)}.`);
  }
  writeFileSync(join(runDir, "run-summary.md"), `${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const runId = argValue("run-id", DEFAULT_RUN_ID)!;
  const runDir = resolve(argValue("run-dir", join(CORPUS, "graph", "ontology-runs", runId))!);
  const model = process.env["ONTOLOGY_MODEL"] ?? "zai-org/GLM-5.2-FP8";
  const baseUrl = process.env["ONTOLOGY_OPENAI_BASE_URL"] ?? "http://127.0.0.1:8000/v1";
  const apiKey = process.env["ONTOLOGY_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "";
  const timeoutMs = Number.parseInt(process.env["ONTOLOGY_TIMEOUT_MS"] ?? String(DEFAULT_TIMEOUT_MS), 10);
  const gpuCostHour = Number.parseFloat(process.env["RUNPOD_GPU_COST_PER_HOUR"] ?? "35.12");
  const levels = parseList(argValue("levels"), [32]);
  const windowsPerLevel = Number.parseInt(argValue("windows-per-level", "32")!, 10);
  const limit = Number.parseInt(argValue("limit", String(Number.MAX_SAFE_INTEGER))!, 10);
  const dryRun = hasArg("dry-run");
  const smoke = hasArg("smoke");
  const serverConfig = {
    tensor_parallel_size: 8,
    kv_cache_dtype: "fp8",
    max_model_len: Number.parseInt(process.env["ONTOLOGY_MAX_MODEL_LEN"] ?? "32768", 10),
    target_server_concurrency: process.env["ONTOLOGY_SERVER_CONCURRENCY"] ?? null,
    speculative_decoding: process.env["ONTOLOGY_SPECULATIVE_DECODING"] ?? "glm-official-mtp-if-supported",
  };

  mkdirSync(join(runDir, "windows"), { recursive: true });
  const windows = buildWindows(runDir).slice(0, limit);
  writeFileSync(join(runDir, "window-manifest.json"), JSON.stringify(windows.map((w) => ({
    window_id: w.window_id,
    work_slug: w.work_slug,
    title: w.title,
    author: w.author,
    genre: w.genre,
    language: w.language,
    chapter_tokens: w.chapter_tokens,
    paragraph_count: w.paragraphs.length,
    prompt_chars: w.prompt.length,
    anchor_path: w.anchor_path,
    enriched_path: w.enriched_path,
    meta_path: w.meta_path,
  })), null, 2));

  if (dryRun) {
    console.log(JSON.stringify({
      run_dir: runDir,
      windows: windows.length,
      first_window: windows[0] ? {
        window_id: windows[0].window_id,
        work_slug: windows[0].work_slug,
        chapter_tokens: windows[0].chapter_tokens,
        paragraphs: windows[0].paragraphs.length,
        prompt_chars: windows[0].prompt.length,
      } : null,
    }, null, 2));
    return;
  }

  const summaries: SegmentSummary[] = [];
  let cursor = 0;
  const activeLevels = smoke ? [1] : levels;
  for (const concurrency of activeLevels) {
    const candidates = windows.slice(cursor).filter((w) => !alreadyValid(w)).slice(0, smoke ? 1 : windowsPerLevel);
    cursor += candidates.length;
    const segmentStart = Date.now();
    const metas = await mapPool(candidates, concurrency, (window) => runOne(window, model, baseUrl, apiKey, serverConfig, timeoutMs));
    const wallClockSeconds = (Date.now() - segmentStart) / 1000;
    const summary = summarizeSegment(concurrency, metas, wallClockSeconds, gpuCostHour);
    summaries.push(summary);
    writeSummary(runDir, summaries, windows);
    console.log(JSON.stringify(summary, null, 2));
    if (summary.decision !== "healthy") break;
  }
}

if (import.meta.main) {
  main().catch((err) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`${basename(import.meta.path)} failed:\n${message}`);
    process.exit(1);
  });
}
