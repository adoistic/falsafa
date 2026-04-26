#!/usr/bin/env bun
/**
 * Phase 4 — Falsafa cover imagery, agentic pipeline.
 *
 * For each work, runs a 5-stage pipeline:
 *   1. Context  — load metadata + content excerpt + series anchor (no LLM)
 *   2. Draft    — Claude Sonnet 4.6 drafts a watercolor prompt
 *   3. Critique — GPT-5.5 (cross-vendor critic) finds what's wrong
 *   4. Decide   — Claude Sonnet 4.6 accepts/rejects each suggestion
 *   5. Image    — gpt-5.4-image-2 renders the final prompt
 *
 * Every stage's I/O lives in cover.audit.json — fully reproducible.
 *
 * Usage:
 *   bun run images                      # full pipeline for all 38 works
 *   bun run images --only <work_slug>   # restrict to one work
 *   bun run images --series <id>        # restrict to one series
 *   bun run images --force              # ignore cache, regenerate
 *   bun run images --dry-run            # run stages 1-4 (LLM calls), skip image gen
 *   bun run images --stages-only        # alias for --dry-run
 *   bun run images --stage-1            # only stage 1 (context, no API calls)
 *
 * Cache: skipped if cover.audit.json exists with matching cache_key (style_version
 * + work_slug + series_id + final_prompt). Bumping style_guide.version invalidates
 * every audit and forces full re-run.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadStyleGuide,
  loadManifest,
  buildNegativePrompt,
  runStageContext,
  runStageDraft,
  runStageCritique,
  runStageDecide,
  runStageImage,
  buildAuditCacheKey,
  type StyleGuideV4,
  type FullAudit,
  type ContextStage,
  type DraftStage,
  type CritiqueStage,
  type DecideStage,
  type ImageStage,
} from "./lib/pipeline-stages.ts";
import { deriveSeriesId, type WorkMeta } from "./lib/series.ts";

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

interface CliArgs {
  only: string | null;
  series: string | null;
  force: boolean;
  dryRun: boolean;
  stage1Only: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    only: null,
    series: null,
    force: false,
    dryRun: false,
    stage1Only: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--dry-run" || a === "--stages-only") args.dryRun = true;
    else if (a === "--stage-1") args.stage1Only = true;
    else if (a === "--only") args.only = argv[++i] ?? null;
    else if (a?.startsWith("--only=")) args.only = a.slice("--only=".length);
    else if (a === "--series") args.series = argv[++i] ?? null;
    else if (a?.startsWith("--series=")) args.series = a.slice("--series=".length);
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-work pipeline
// ─────────────────────────────────────────────────────────────────────────

interface PipelineResult {
  slug: string;
  status: "skipped" | "generated" | "stages-only" | "stage-1-only" | "error";
  reason?: string;
  audit?: FullAudit;
  context?: ContextStage;
}

async function runPipelineForWork(
  work: WorkMeta & { description: string; genre: string },
  styleGuide: StyleGuideV4,
  corpusRoot: string,
  apiKey: string,
  args: CliArgs,
): Promise<PipelineResult> {
  const seriesId = deriveSeriesId(work);
  const workDir = resolve(corpusRoot, "works", work.slug);
  const auditPath = resolve(workDir, "cover.audit.json");
  const coverPath = resolve(workDir, `cover.${styleGuide.image.format}`);

  console.log(`\n[${work.slug}] series=${seriesId}`);

  // Stage 1: Context (always runs — pure I/O, no API calls)
  const ctx = runStageContext({
    workSlug: work.slug,
    seriesId,
    styleGuide,
    corpusRoot,
    manifestEntry: {
      slug: work.slug,
      title: work.title,
      author: work.author,
      era: work.era,
      genre: work.genre,
      language: work.language,
      description: work.description,
    },
  });
  console.log(`  [1/5] context: anchor='${ctx.series_anchor.label}', excerpt=${ctx.excerpt_source.chars} chars from ${ctx.excerpt_source.variant_file}`);

  if (args.stage1Only) {
    return { slug: work.slug, status: "stage-1-only", context: ctx };
  }

  // Cache check (only if we have a previous audit)
  if (!args.force && existsSync(auditPath)) {
    try {
      const prior = JSON.parse(readFileSync(auditPath, "utf-8")) as FullAudit;
      if (prior.style_guide_version === styleGuide.version && existsSync(coverPath)) {
        console.log(`  ✓ cache hit (audit v${prior.style_guide_version}, cover present), skipping`);
        return { slug: work.slug, status: "skipped", reason: "cache hit" };
      }
    } catch {
      // Continue — corrupted audit, regenerate
    }
  }

  // Stage 2: Draft
  let draft: DraftStage;
  let draftUsage: unknown;
  try {
    const r = await runStageDraft(ctx, styleGuide, apiKey);
    draft = r.output;
    draftUsage = r.usage;
    console.log(`  [2/5] draft: subject="${draft.subject.slice(0, 80)}${draft.subject.length > 80 ? "..." : ""}"`);
  } catch (err) {
    return { slug: work.slug, status: "error", reason: `stage 2 (draft) failed: ${(err as Error).message}` };
  }

  // Stage 3: Critique
  let critique: CritiqueStage;
  let critiqueUsage: unknown;
  try {
    const r = await runStageCritique(ctx, draft, styleGuide, apiKey);
    critique = r.output;
    critiqueUsage = r.usage;
    const sevCounts = { critical: 0, high: 0, medium: 0 };
    for (const i of critique.issues) sevCounts[i.severity]++;
    console.log(
      `  [3/5] critique: score=${critique.overall_score}/10 rec=${critique.recommendation} issues=[crit:${sevCounts.critical} high:${sevCounts.high} med:${sevCounts.medium}]`,
    );
  } catch (err) {
    return { slug: work.slug, status: "error", reason: `stage 3 (critique) failed: ${(err as Error).message}` };
  }

  // Stage 4: Decide
  let decide: DecideStage;
  let decideUsage: unknown;
  try {
    const r = await runStageDecide(ctx, draft, critique, styleGuide, apiKey);
    decide = r.output;
    decideUsage = r.usage;
    const accepted = decide.decisions.filter((d) => d.decision === "accept").length;
    const rejected = decide.decisions.filter((d) => d.decision === "reject").length;
    console.log(`  [4/5] decide: accepted=${accepted} rejected=${rejected}`);
  } catch (err) {
    return { slug: work.slug, status: "error", reason: `stage 4 (decide) failed: ${(err as Error).message}` };
  }

  const finalPrompt = decide.final_prompt;

  if (args.dryRun) {
    // Save audit-without-image so the user can iterate prompts before paying for image gen
    const auditPartial: Omit<FullAudit, "stages"> & { stages: Omit<FullAudit["stages"], "5_image"> & { "5_image": null } } = {
      work_slug: work.slug,
      series_id: seriesId,
      style_guide_version: styleGuide.version,
      generated_at: new Date().toISOString(),
      pipeline_models: styleGuide.models,
      stages: {
        "1_context": ctx,
        "2_draft": { output: draft, usage: draftUsage },
        "3_critique": { output: critique, usage: critiqueUsage },
        "4_decide": { output: decide, usage: decideUsage },
        "5_image": null,
      },
      final_prompt: finalPrompt,
      cache_key: buildAuditCacheKey(styleGuide.version, work.slug, seriesId, finalPrompt),
    };
    mkdirSync(workDir, { recursive: true });
    writeFileSync(resolve(workDir, "cover.audit.draft.json"), JSON.stringify(auditPartial, null, 2));
    console.log(`  [5/5] DRY RUN — final_prompt saved to cover.audit.draft.json (no image gen)`);
    return { slug: work.slug, status: "stages-only" };
  }

  // Stage 5: Image
  let imageStage: ImageStage;
  try {
    imageStage = await runStageImage(finalPrompt, buildNegativePrompt(styleGuide), coverPath, styleGuide, apiKey);
    console.log(`  [5/5] image: saved ${(imageStage.bytes / 1024).toFixed(0)}KB → cover.${styleGuide.image.format}`);
  } catch (err) {
    return { slug: work.slug, status: "error", reason: `stage 5 (image) failed: ${(err as Error).message}` };
  }

  const audit: FullAudit = {
    work_slug: work.slug,
    series_id: seriesId,
    style_guide_version: styleGuide.version,
    generated_at: new Date().toISOString(),
    pipeline_models: styleGuide.models,
    stages: {
      "1_context": ctx,
      "2_draft": { output: draft, usage: draftUsage },
      "3_critique": { output: critique, usage: critiqueUsage },
      "4_decide": { output: decide, usage: decideUsage },
      "5_image": imageStage,
    },
    final_prompt: finalPrompt,
    cache_key: buildAuditCacheKey(styleGuide.version, work.slug, seriesId, finalPrompt),
  };
  writeFileSync(auditPath, JSON.stringify(audit, null, 2));
  return { slug: work.slug, status: "generated", audit };
}

// ─────────────────────────────────────────────────────────────────────────
// Concurrency
// ─────────────────────────────────────────────────────────────────────────

class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= this.max) {
      await new Promise<void>((res) => this.queue.push(res));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const CONCURRENCY = 3; // Three works at a time to stay below OpenRouter rate limits

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(import.meta.dir, "..");
  const corpusDir = resolve(root, "corpus");
  const styleGuidePath = resolve(root, "scripts/image-prompts/style-guide.json");

  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey && !args.stage1Only) {
    console.error("Missing OPENROUTER_API_KEY in env. Set it in .env or your shell.");
    console.error("Run with --stage-1 to verify context-loading without API calls.");
    process.exit(1);
  }

  const styleGuide = loadStyleGuide(styleGuidePath);
  console.log(`Style guide v${styleGuide.version}`);
  console.log(`  draft model:    ${styleGuide.models.stage_2_draft}`);
  console.log(`  critique model: ${styleGuide.models.stage_3_critique}  (cross-vendor)`);
  console.log(`  decide model:   ${styleGuide.models.stage_4_decide}`);
  console.log(`  image model:    ${styleGuide.models.image_gen}`);
  console.log(`  aspect:         ${styleGuide.image.aspect_ratio} @ ${styleGuide.image.image_size}`);

  const manifest = loadManifest(corpusDir);
  let works = manifest.works;

  if (args.only) {
    works = works.filter((w) => w.slug === args.only);
    if (works.length === 0) {
      console.error(`No work matching slug: ${args.only}`);
      process.exit(1);
    }
  } else if (args.series) {
    works = works.filter((w) => deriveSeriesId(w as WorkMeta) === args.series);
    if (works.length === 0) {
      console.error(`No works in series: ${args.series}`);
      process.exit(1);
    }
  }

  console.log(`\nProcessing ${works.length} work${works.length === 1 ? "" : "s"} (concurrency=${CONCURRENCY})${args.dryRun ? " [DRY RUN — stages 1-4 only]" : ""}${args.stage1Only ? " [STAGE 1 ONLY]" : ""}`);

  const limiter = new Limiter(CONCURRENCY);
  const start = Date.now();
  const results = await Promise.all(
    works.map((w) =>
      limiter.run(() =>
        runPipelineForWork(
          w as WorkMeta & { description: string; genre: string },
          styleGuide,
          corpusDir,
          apiKey ?? "",
          args,
        ),
      ),
    ),
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // Summary
  const generated = results.filter((r) => r.status === "generated").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const stagesOnly = results.filter((r) => r.status === "stages-only").length;
  const stage1Only = results.filter((r) => r.status === "stage-1-only").length;
  const errors = results.filter((r) => r.status === "error");

  console.log(`\nFinished in ${elapsed}s`);
  console.log(`  generated:    ${generated}`);
  console.log(`  skipped:      ${skipped}`);
  if (stagesOnly > 0) console.log(`  stages-only:  ${stagesOnly}  (audit.draft.json saved, no image)`);
  if (stage1Only > 0) console.log(`  stage-1-only: ${stage1Only}  (context only)`);
  if (errors.length > 0) {
    console.log(`  errors:       ${errors.length}`);
    for (const e of errors) console.log(`    - ${e.slug}: ${e.reason}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
