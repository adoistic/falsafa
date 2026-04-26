/**
 * Falsafa cover-image agentic pipeline.
 *
 * Five stages per work, with cross-model critique:
 *   1. Context  — load work metadata + content excerpt + series anchor
 *   2. Draft    — Claude Sonnet 4.6 drafts a watercolor prompt (json_schema)
 *   3. Critique — GPT-5.5 (different model, fresh perspective) critiques it (json_schema)
 *   4. Decide   — Claude Sonnet 4.6 accepts/rejects each suggestion, emits final prompt (json_schema)
 *   5. Image    — gpt-5.4-image-2 renders the final prompt
 *
 * The cross-model critique pattern is taken from gstack's /codex review skill —
 * a different vendor's model produces strictly better signal than self-review.
 * When the drafter (Anthropic) and critic (OpenAI) agree something is wrong,
 * the issue is real, not a model artifact.
 *
 * Every stage's input + output is recorded in cover.audit.json for full
 * reproducibility. Anyone can replay any stage.
 */

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chat, type ChatMessage } from "./openrouter-chat.ts";
import { generateImage, withRetry, saveImage } from "./openrouter-image.ts";

// ─────────────────────────────────────────────────────────────────────────
// Style-guide types (v0.4.0)
// ─────────────────────────────────────────────────────────────────────────

export interface StyleGuideV4 {
  version: string;
  models: {
    stage_2_draft: string;
    stage_3_critique: string;
    stage_4_decide: string;
    image_gen: string;
  };
  image: {
    aspect_ratio: string;
    image_size: string;
    format: string;
  };
  master_aesthetic: {
    medium: string;
    watercolor_specifics: string;
    composition: string;
    palette_grammar: string;
    subject_grammar: string;
  };
  negative_directives: string[];
  series_anchors: Record<string, SeriesAnchor>;
  pipeline: {
    stage_2_draft_system: string;
    stage_3_critique_system: string;
    stage_4_decide_system: string;
  };
}

export interface SeriesAnchor {
  label: string;
  palette: string;
  mood: string;
  watercolor_treatment: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Stage outputs
// ─────────────────────────────────────────────────────────────────────────

export interface ContextStage {
  work_slug: string;
  series_id: string;
  series_anchor: SeriesAnchor;
  work_metadata: {
    title: string;
    author: string;
    era: string;
    language: string;
    genre: string;
    description: string;
  };
  content_excerpt: string;
  excerpt_source: { variant_file: string; chars: number };
}

export interface DraftStage {
  reasoning: string;
  subject: string;
  palette: string;
  composition: string;
  watercolor_treatment: string;
  prompt: string;
}

export interface CritiqueIssue {
  severity: "critical" | "high" | "medium";
  category: string;
  problematic_phrase: string;
  suggestion: string;
}

export interface CritiqueStage {
  reasoning: string;
  issues: CritiqueIssue[];
  overall_score: number;
  recommendation: "ship" | "revise" | "regenerate";
}

export interface DecideAction {
  issue_index: number;
  decision: "accept" | "reject";
  reason: string;
}

export interface DecideStage {
  reasoning: string;
  decisions: DecideAction[];
  final_prompt: string;
  changes_summary: string;
}

export interface ImageStage {
  cover_path: string;
  bytes: number;
  generated_at: string;
  model: string;
  aspect_ratio: string;
  image_size: string;
}

// ─────────────────────────────────────────────────────────────────────────
// JSON Schemas (OpenRouter-compatible — strict mode requires every
// property to be in `required` and `additionalProperties: false`)
// ─────────────────────────────────────────────────────────────────────────

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reasoning: { type: "string", description: "1-2 sentences on why this subject was chosen and how it evokes the work's spirit." },
    subject: { type: "string", description: "ONE concrete object phrase, no figure or scene." },
    palette: { type: "string", description: "Three or fewer named pigments. Use real watercolor pigment names." },
    composition: { type: "string", description: "Where the subject sits, asymmetry, negative-space proportion." },
    watercolor_treatment: { type: "string", description: "Specific paint behavior: wet-on-wet pooling, dry brush, dilution, paper grain." },
    prompt: { type: "string", description: "Full single-paragraph prompt (80-150 words) the image model will render." },
  },
  required: ["reasoning", "subject", "palette", "composition", "watercolor_treatment", "prompt"],
} as const;

const CRITIQUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reasoning: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium"] },
          category: { type: "string" },
          problematic_phrase: { type: "string", description: "Exact quote from the prompt that triggered this finding." },
          suggestion: { type: "string", description: "Concrete replacement phrase or rewrite." },
        },
        required: ["severity", "category", "problematic_phrase", "suggestion"],
      },
    },
    overall_score: { type: "number", minimum: 0, maximum: 10 },
    recommendation: { type: "string", enum: ["ship", "revise", "regenerate"] },
  },
  required: ["reasoning", "issues", "overall_score", "recommendation"],
} as const;

const DECIDE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reasoning: { type: "string", description: "Brief synthesis of which suggestions are valid and which are over-corrections." },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          issue_index: { type: "integer", description: "0-indexed position in the critique's issues array." },
          decision: { type: "string", enum: ["accept", "reject"] },
          reason: { type: "string", description: "One sentence on WHY this suggestion was accepted or rejected." },
        },
        required: ["issue_index", "decision", "reason"],
      },
    },
    final_prompt: { type: "string", description: "The revised single-paragraph prompt incorporating accepted suggestions." },
    changes_summary: { type: "string", description: "1-2 sentences on what changed from the original prompt." },
  },
  required: ["reasoning", "decisions", "final_prompt", "changes_summary"],
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Stage 1: Context (no LLM call — pure I/O)
// ─────────────────────────────────────────────────────────────────────────

export interface ContextInput {
  workSlug: string;
  seriesId: string;
  styleGuide: StyleGuideV4;
  corpusRoot: string;
  manifestEntry: {
    slug: string;
    title: string;
    author: string;
    era: string;
    genre: string;
    language: string;
    description: string;
  };
}

export function runStageContext(input: ContextInput): ContextStage {
  const { workSlug, seriesId, styleGuide, corpusRoot, manifestEntry } = input;
  const seriesAnchor = styleGuide.series_anchors[seriesId] ?? styleGuide.series_anchors["solo-default"];
  if (!seriesAnchor) {
    throw new Error(`No series anchor found for ${seriesId} or solo-default. Add to style-guide.json.`);
  }

  // Read the work's first chapter excerpt — prefer translation if present, else first variant
  const workDir = join(corpusRoot, "works", workSlug);
  let excerpt = "";
  let excerptSource = { variant_file: "(none)", chars: 0 };
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const chaptersDir = join(workDir, "chapters");
    if (fs.existsSync(chaptersDir)) {
      const firstChapterDir = fs.readdirSync(chaptersDir).sort()[0];
      if (firstChapterDir) {
        const firstChapterPath = join(chaptersDir, firstChapterDir);
        const variants = ["translation.md", "original.md", "transliteration.md"];
        for (const v of variants) {
          const filePath = join(firstChapterPath, v);
          if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, "utf-8");
            // Skip frontmatter, take first ~600 chars of body
            const bodyStart = raw.indexOf("\n---") + 4;
            const body = raw.slice(bodyStart).replace(/^\n+/, "");
            excerpt = body.slice(0, 600).trim();
            excerptSource = { variant_file: v, chars: excerpt.length };
            break;
          }
        }
      }
    }
  } catch {
    // Excerpt is optional — pipeline still works without it
  }

  return {
    work_slug: workSlug,
    series_id: seriesId,
    series_anchor: seriesAnchor,
    work_metadata: {
      title: manifestEntry.title,
      author: manifestEntry.author,
      era: manifestEntry.era,
      language: manifestEntry.language,
      genre: manifestEntry.genre,
      description: manifestEntry.description,
    },
    content_excerpt: excerpt,
    excerpt_source: excerptSource,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Stage 2: Draft (Claude Sonnet 4.6 with json_schema)
// ─────────────────────────────────────────────────────────────────────────

function buildDraftUserMessage(ctx: ContextStage, styleGuide: StyleGuideV4): string {
  const a = styleGuide.master_aesthetic;
  return [
    "MASTER AESTHETIC (apply uniformly):",
    `- Medium: ${a.medium}`,
    `- Watercolor specifics: ${a.watercolor_specifics}`,
    `- Composition: ${a.composition}`,
    `- Palette grammar: ${a.palette_grammar}`,
    `- Subject grammar: ${a.subject_grammar}`,
    "",
    "NEGATIVE DIRECTIVES (must avoid):",
    styleGuide.negative_directives.map((d) => `- ${d}`).join("\n"),
    "",
    "SERIES ANCHOR (use these palette + mood — siblings in this series share these):",
    `- Series: ${ctx.series_anchor.label}`,
    `- Palette: ${ctx.series_anchor.palette}`,
    `- Mood: ${ctx.series_anchor.mood}`,
    `- Watercolor treatment: ${ctx.series_anchor.watercolor_treatment}`,
    "",
    "THIS WORK:",
    `- Title: ${ctx.work_metadata.title}`,
    `- Author: ${ctx.work_metadata.author}`,
    `- Era: ${ctx.work_metadata.era}`,
    `- Language: ${ctx.work_metadata.language}`,
    `- Genre: ${ctx.work_metadata.genre}`,
    `- Description: ${ctx.work_metadata.description}`,
    ctx.content_excerpt
      ? `\nCONTENT EXCERPT (first ~600 chars of opening chapter):\n${ctx.content_excerpt}`
      : "\nCONTENT EXCERPT: (none available)",
    "",
    "OUTPUT JSON matching the schema. Compose a watercolor cover prompt for this work.",
  ].join("\n");
}

export async function runStageDraft(
  ctx: ContextStage,
  styleGuide: StyleGuideV4,
  apiKey: string,
): Promise<{ output: DraftStage; usage: unknown; raw: unknown }> {
  const messages: ChatMessage[] = [
    { role: "system", content: styleGuide.pipeline.stage_2_draft_system },
    { role: "user", content: buildDraftUserMessage(ctx, styleGuide) },
  ];
  const result = await chat<DraftStage>({
    apiKey,
    model: styleGuide.models.stage_2_draft,
    messages,
    json_schema: { name: "watercolor_cover_draft", schema: DRAFT_SCHEMA, strict: true },
    temperature: 0.7,
    max_tokens: 2000,
  });
  return { output: result.parsed, usage: result.usage, raw: result.raw_response };
}

// ─────────────────────────────────────────────────────────────────────────
// Stage 3: Critique (GPT-5.5 — different model — with json_schema)
// ─────────────────────────────────────────────────────────────────────────

function buildCritiqueUserMessage(ctx: ContextStage, draft: DraftStage, styleGuide: StyleGuideV4): string {
  return [
    "SERIES ANCHOR (the prompt was supposed to honor this — flag drift):",
    `- Series: ${ctx.series_anchor.label}`,
    `- Palette: ${ctx.series_anchor.palette}`,
    `- Mood: ${ctx.series_anchor.mood}`,
    `- Watercolor treatment: ${ctx.series_anchor.watercolor_treatment}`,
    "",
    "WORK CONTEXT (for subject-alignment check only — do NOT propose new subjects):",
    `- Title: ${ctx.work_metadata.title}`,
    `- Author: ${ctx.work_metadata.author}`,
    `- Era / language: ${ctx.work_metadata.era}, ${ctx.work_metadata.language}`,
    "",
    "MASTER AESTHETIC (the prompt was supposed to embody this):",
    styleGuide.master_aesthetic.watercolor_specifics,
    "",
    "NEGATIVE DIRECTIVES (the prompt was supposed to avoid these):",
    styleGuide.negative_directives.map((d) => `- ${d}`).join("\n"),
    "",
    "DRAFTED PROMPT (critique this, verbatim — every word counts):",
    "```",
    draft.prompt,
    "```",
    "",
    "DRAFTER'S DECLARED REASONING (do not repeat — find what they missed):",
    draft.reasoning,
    "",
    "OUTPUT JSON matching the schema. Apply the gate logic deterministically.",
  ].join("\n");
}

export async function runStageCritique(
  ctx: ContextStage,
  draft: DraftStage,
  styleGuide: StyleGuideV4,
  apiKey: string,
): Promise<{ output: CritiqueStage; usage: unknown; raw: unknown }> {
  const messages: ChatMessage[] = [
    { role: "system", content: styleGuide.pipeline.stage_3_critique_system },
    { role: "user", content: buildCritiqueUserMessage(ctx, draft, styleGuide) },
  ];
  const result = await chat<CritiqueStage>({
    apiKey,
    model: styleGuide.models.stage_3_critique,
    messages,
    json_schema: { name: "watercolor_prompt_critique", schema: CRITIQUE_SCHEMA, strict: true },
    temperature: 0.4, // Critic is colder than the drafter
    // GPT-5.5 emits reasoning trace before the structured output. With strict
    // schemas + dense critique categories, 2500 was occasionally too tight and
    // caused finish_reason='length' silent failures. 8000 leaves comfortable headroom.
    max_tokens: 8000,
  });
  return { output: result.parsed, usage: result.usage, raw: result.raw_response };
}

// ─────────────────────────────────────────────────────────────────────────
// Stage 4: Decide (Claude Sonnet 4.6 with json_schema)
// ─────────────────────────────────────────────────────────────────────────

function buildDecideUserMessage(
  ctx: ContextStage,
  draft: DraftStage,
  critique: CritiqueStage,
  styleGuide: StyleGuideV4,
): string {
  return [
    "SERIES ANCHOR (the final prompt must still honor this):",
    `- Palette: ${ctx.series_anchor.palette}`,
    `- Mood: ${ctx.series_anchor.mood}`,
    `- Watercolor treatment: ${ctx.series_anchor.watercolor_treatment}`,
    "",
    "ORIGINAL PROMPT (drafted by Stage 2):",
    "```",
    draft.prompt,
    "```",
    "",
    "CRITIC'S OVERALL ASSESSMENT:",
    `- Score: ${critique.overall_score}/10`,
    `- Recommendation: ${critique.recommendation}`,
    `- Critic reasoning: ${critique.reasoning}`,
    "",
    "CRITIC'S ISSUES (decide accept/reject for each, by index):",
    critique.issues.length === 0
      ? "(no issues — the critic recommends ship as-is)"
      : critique.issues
          .map(
            (issue, i) =>
              `[${i}] severity=${issue.severity} category=${issue.category}\n    problematic_phrase: ${JSON.stringify(issue.problematic_phrase)}\n    suggestion: ${issue.suggestion}`,
          )
          .join("\n"),
    "",
    "OUTPUT JSON matching the schema. Emit a single revised final_prompt incorporating accepted suggestions. Do not introduce new ideas the critic did not propose.",
    styleGuide.negative_directives.length > 0
      ? `\nReminder of negative directives:\n${styleGuide.negative_directives.slice(0, 6).map((d) => `- ${d}`).join("\n")}`
      : "",
  ].join("\n");
}

export async function runStageDecide(
  ctx: ContextStage,
  draft: DraftStage,
  critique: CritiqueStage,
  styleGuide: StyleGuideV4,
  apiKey: string,
): Promise<{ output: DecideStage; usage: unknown; raw: unknown }> {
  const messages: ChatMessage[] = [
    { role: "system", content: styleGuide.pipeline.stage_4_decide_system },
    { role: "user", content: buildDecideUserMessage(ctx, draft, critique, styleGuide) },
  ];
  const result = await chat<DecideStage>({
    apiKey,
    model: styleGuide.models.stage_4_decide,
    messages,
    json_schema: { name: "watercolor_prompt_decision", schema: DECIDE_SCHEMA, strict: true },
    temperature: 0.5,
    max_tokens: 2000,
  });
  return { output: result.parsed, usage: result.usage, raw: result.raw_response };
}

// ─────────────────────────────────────────────────────────────────────────
// Stage 5: Image (gpt-5.4-image-2)
// ─────────────────────────────────────────────────────────────────────────

export async function runStageImage(
  finalPrompt: string,
  negative: string,
  outputPath: string,
  styleGuide: StyleGuideV4,
  apiKey: string,
): Promise<ImageStage> {
  const result = await withRetry(
    () =>
      generateImage({
        apiKey,
        model: styleGuide.models.image_gen,
        prompt: finalPrompt,
        negative,
        aspect_ratio: styleGuide.image.aspect_ratio,
        image_size: styleGuide.image.image_size,
      }),
    "image",
  );
  const bytes = await saveImage(result, outputPath);
  return {
    cover_path: outputPath,
    bytes,
    generated_at: new Date().toISOString(),
    model: styleGuide.models.image_gen,
    aspect_ratio: styleGuide.image.aspect_ratio,
    image_size: styleGuide.image.image_size,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Audit
// ─────────────────────────────────────────────────────────────────────────

export interface FullAudit {
  work_slug: string;
  series_id: string;
  style_guide_version: string;
  generated_at: string;
  pipeline_models: StyleGuideV4["models"];
  stages: {
    "1_context": ContextStage;
    "2_draft": { output: DraftStage; usage: unknown };
    "3_critique": { output: CritiqueStage; usage: unknown };
    "4_decide": { output: DecideStage; usage: unknown };
    "5_image": ImageStage;
  };
  /** Final canonical prompt used for image generation. */
  final_prompt: string;
  /** Cache key derived from style version + work slug + series anchor + final prompt. */
  cache_key: string;
}

import { createHash } from "node:crypto";

export function buildAuditCacheKey(
  styleVersion: string,
  workSlug: string,
  seriesId: string,
  finalPrompt: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ styleVersion, workSlug, seriesId, finalPrompt }))
    .digest("hex")
    .slice(0, 16);
}

export function loadStyleGuide(path: string): StyleGuideV4 {
  return JSON.parse(readFileSync(path, "utf-8")) as StyleGuideV4;
}

export function buildNegativePrompt(styleGuide: StyleGuideV4): string {
  return styleGuide.negative_directives.join(", ");
}

export function loadManifest(corpusRoot: string): {
  works: Array<{
    slug: string;
    title: string;
    author: string;
    era: string;
    genre: string;
    language: string;
    description: string;
  }>;
} {
  const path = resolve(corpusRoot, "manifest.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}
