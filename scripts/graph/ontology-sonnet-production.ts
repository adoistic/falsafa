/**
 * Sonnet subagent PRODUCTION driver for the ontology anchor-range-v1 pipeline.
 *
 * This is the production-pass sibling of `ontology-sonnet-benchmark.ts`. The
 * benchmark selected a diverse 16-window subset to prove the pipeline; this
 * driver walks the FULL archive in deterministic priority order, skips windows
 * that already have a valid enriched output (idempotent resume), and prepares
 * the next N undone windows for extraction. Like the benchmark, it calls NO
 * model itself: Claude Code Sonnet subagents are the extraction engine because
 * no metered API endpoint is available (RunPod/ModelScope GLM never reached a
 * healthy server; no external API key in-env).
 *
 *   prepare  --count N   Build all archive windows, skip already-valid ones,
 *                        take the next N in order, write each rendered canonical
 *                        prompt to <run>/prompts/<window_id>.prompt.txt, and
 *                        append the batch to <run>/production-batches.json. A
 *                        subagent is then dispatched per window; its raw JSON is
 *                        saved to <run>/responses/<window_id>.response.txt.
 *   finalize             Read every saved response that lacks a valid meta, run
 *                        the SAME canonical validation + deterministic quote
 *                        enrichment used in production, write per-window
 *                        anchor/enriched/meta, and emit an aggregate production
 *                        run summary + failure queue over ALL done windows.
 *
 * The model is never asked to write quotes; it returns paragraph anchors only.
 * Enrichment attaches quote arrays deterministically from the source window.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  buildWindows,
  CORPUS,
  enrichOntology,
  extractJson,
  type OntologyOutput,
  PROMPT_PATH,
  percentile,
  validateOntology,
  type WindowMeta,
  type WorkWindow,
} from "./ontology-production-run.ts";

const MODEL = process.env["ONTOLOGY_MODEL"] ?? "claude-sonnet-4-6";
const PRICE_IN = Number.parseFloat(process.env["SONNET_PRICE_IN"] ?? "3.0");
const PRICE_OUT = Number.parseFloat(process.env["SONNET_PRICE_OUT"] ?? "15.0");
const TOTAL_WINDOWS_HINT = 12_797;

function argValue(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1] ?? fallback;
  return fallback;
}

function estTokens(chars: number): number {
  return Math.round(chars / 4);
}

function runDirArg(): string {
  return resolve(
    argValue("run-dir", join(CORPUS, "graph", "ontology-runs", "2026-07-02-sonnet-benchmark"))!,
  );
}

/** True when a window already has a valid enriched output + meta (idempotent skip). */
function isWindowDone(window: WorkWindow): boolean {
  if (!existsSync(window.enriched_path) || !existsSync(window.meta_path)) return false;
  try {
    const meta = JSON.parse(readFileSync(window.meta_path, "utf-8")) as WindowMeta;
    return meta.validation.schema_valid && meta.validation.paragraph_anchor_valid && meta.enrichment.success;
  } catch {
    return false;
  }
}

/**
 * Lossless deterministic schema repair, identical to the benchmark driver. Only
 * touches const-valued fields, so no model information is altered. Returns the
 * number of fields repaired.
 */
function normalizeOntology(value: unknown): number {
  let repaired = 0;
  if (!value || typeof value !== "object") return 0;
  const root = value as Record<string, unknown>;
  const events = root["quote_events"];
  if (Array.isArray(events)) {
    for (const ev of events) {
      if (ev && typeof ev === "object" && (ev as Record<string, unknown>)["source"] !== "manual") {
        (ev as Record<string, unknown>)["source"] = "manual";
        repaired++;
      }
    }
  }
  const citations = root["citations"];
  if (Array.isArray(citations)) {
    for (const c of citations) {
      if (!c || typeof c !== "object") continue;
      const obj = c as Record<string, unknown>;
      for (const key of ["cited_work", "cited_author"]) {
        if (!(key in obj)) {
          obj[key] = "";
          repaired++;
        }
      }
    }
  }
  return repaired;
}

interface BatchRecord {
  batch: string;
  prepared_at: string;
  window_ids: string[];
}

interface PreparedWindow {
  window_id: string;
  work_slug: string;
  title: string;
  genre: string;
  language: string;
  paragraph_count: number;
  prompt_chars: number;
  est_prompt_tokens: number;
  prompt_path: string;
  response_path: string;
}

function readBatches(runDir: string): BatchRecord[] {
  const p = join(runDir, "production-batches.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as BatchRecord[]) : [];
}

function prepare(): void {
  const runDir = runDirArg();
  const count = Number.parseInt(argValue("count", "32")!, 10);
  const batchName = argValue("batch", `batch-${new Date().toISOString().replace(/[:.]/g, "-")}`)!;
  mkdirSync(join(runDir, "prompts"), { recursive: true });
  mkdirSync(join(runDir, "responses"), { recursive: true });
  mkdirSync(join(runDir, "windows"), { recursive: true });

  const allWindows = buildWindows(runDir);
  const byId = new Map(allWindows.map((w) => [w.window_id, w]));

  // Windows already claimed by an earlier batch (prompt written) OR already valid.
  const claimed = new Set<string>();
  for (const b of readBatches(runDir)) for (const id of b.window_ids) claimed.add(id);

  const prepared: PreparedWindow[] = [];
  const pickedIds: string[] = [];
  for (const w of allWindows) {
    if (prepared.length >= count) break;
    if (claimed.has(w.window_id)) continue;
    if (isWindowDone(w)) continue;
    // Skip windows that already have a response awaiting finalize.
    if (existsSync(join(runDir, "responses", `${w.window_id}.response.txt`))) continue;
    const promptPath = join(runDir, "prompts", `${w.window_id}.prompt.txt`);
    writeFileSync(promptPath, w.prompt);
    prepared.push({
      window_id: w.window_id,
      work_slug: w.work_slug,
      title: w.title,
      genre: w.genre,
      language: w.language,
      paragraph_count: w.paragraphs.length,
      prompt_chars: w.prompt.length,
      est_prompt_tokens: estTokens(w.prompt.length),
      prompt_path: promptPath,
      response_path: join(runDir, "responses", `${w.window_id}.response.txt`),
    });
    pickedIds.push(w.window_id);
  }

  const batches = readBatches(runDir);
  batches.push({ batch: batchName, prepared_at: new Date().toISOString(), window_ids: pickedIds });
  writeFileSync(join(runDir, "production-batches.json"), JSON.stringify(batches, null, 2));

  const doneCount = allWindows.filter((w) => isWindowDone(w)).length;
  console.log(JSON.stringify({
    run_dir: runDir,
    batch: batchName,
    total_windows: allWindows.length,
    already_done: doneCount,
    prepared_this_batch: prepared.length,
    windows: prepared,
  }, null, 2));
  void byId;
}

interface WindowReport {
  window_id: string;
  work_slug: string;
  valid_json: boolean;
  schema_valid_raw: boolean;
  const_repaired_fields: number;
  schema_valid: boolean;
  paragraph_anchor_valid: boolean;
  quote_leak: boolean;
  enrichment_success: boolean;
  fully_valid: boolean;
  entities: number;
  themes: number;
  citations: number;
  quote_events: number;
  evidence_objects: number;
  quotes_attached: number;
  paragraph_fallbacks: number;
  failure_reason: string | null;
  est_prompt_tokens: number;
  est_completion_tokens: number;
}

/**
 * Hard quote-prohibition check: the model must return paragraph anchors ONLY.
 * Any `quote`/`quotes`/`text`/`snippet` key inside the model's own evidence
 * objects (before deterministic enrichment attaches its own `quotes`) is a leak.
 */
function detectQuoteLeak(parsed: unknown): boolean {
  const banned = new Set(["quote", "quotes", "text", "snippet", "exact_quote", "source_text"]);
  const walkEvidence = (ev: unknown): boolean => {
    if (!ev || typeof ev !== "object") return false;
    return Object.keys(ev as Record<string, unknown>).some((k) => banned.has(k));
  };
  if (!parsed || typeof parsed !== "object") return false;
  const root = parsed as Record<string, unknown>;
  for (const key of ["entities", "themes", "citations", "quote_events"]) {
    const arr = root[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const evs = (item as Record<string, unknown>)?.["evidence"];
      if (Array.isArray(evs) && evs.some(walkEvidence)) return true;
    }
  }
  return false;
}

function finalize(): void {
  const runDir = runDirArg();
  const windows = new Map(buildWindows(runDir).map((w) => [w.window_id, w]));
  const responsesDir = join(runDir, "responses");
  const responseIds = existsSync(responsesDir)
    ? readdirSync(responsesDir).filter((f) => f.endsWith(".response.txt")).map((f) => f.replace(/\.response\.txt$/, ""))
    : [];

  const reports: WindowReport[] = [];
  for (const id of responseIds) {
    const window = windows.get(id);
    if (!window) {
      console.error(`response has no matching window (skipped): ${id}`);
      continue;
    }
    const raw = readFileSync(join(responsesDir, `${id}.response.txt`), "utf-8");
    let parsed: OntologyOutput | null = null;
    let rawSchemaValid = false;
    let repaired = 0;
    let quoteLeak = false;
    let validation = { valid_json: false, schema_valid: false, paragraph_anchor_valid: false, errors: ["not parsed"] as string[] };
    let enrichment = { success: false, evidence_objects: 0, quotes_attached: 0, paragraph_fallbacks: 0, errors: ["not run"] as string[] };
    try {
      parsed = extractJson(raw) as OntologyOutput;
      quoteLeak = detectQuoteLeak(parsed);
      rawSchemaValid = validateOntology(parsed, window).schema_valid;
      repaired = normalizeOntology(parsed);
      validation = validateOntology(parsed, window);
    } catch (err) {
      validation = { valid_json: false, schema_valid: false, paragraph_anchor_valid: false, errors: [err instanceof Error ? err.message : String(err)] };
    }
    const fullyValid = !!parsed && validation.schema_valid && validation.paragraph_anchor_valid && !quoteLeak;
    if (fullyValid) {
      writeFileSync(window.anchor_path, JSON.stringify(parsed, null, 2));
      const enriched = enrichOntology(parsed!, window);
      enrichment = enriched.result;
      if (enrichment.success) writeFileSync(window.enriched_path, JSON.stringify(enriched.output, null, 2));
    }
    const estPromptTok = estTokens(window.prompt.length);
    const estComplTok = estTokens(raw.length);
    const meta: WindowMeta = {
      window_id: id,
      work_slug: window.work_slug,
      chapter_tokens: window.chapter_tokens,
      prompt_version: "anchor-range-v1",
      prompt_path: PROMPT_PATH,
      model: MODEL,
      base_url: "claude-code-subagent",
      server_config: { route: "sonnet-subagent-production" },
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      latency_ms: 0,
      attempts: [],
      validation,
      enrichment,
      usage: { prompt_tokens: estPromptTok, completion_tokens: estComplTok, total_tokens: estPromptTok + estComplTok },
    };
    writeFileSync(window.meta_path, JSON.stringify(meta, null, 2));
    const failureReason = fullyValid && enrichment.success
      ? null
      : (quoteLeak ? "quote_leak" : validation.errors[0] ?? enrichment.errors[0] ?? "unknown");
    reports.push({
      window_id: id,
      work_slug: window.work_slug,
      valid_json: validation.valid_json,
      schema_valid_raw: rawSchemaValid,
      const_repaired_fields: repaired,
      schema_valid: validation.schema_valid,
      paragraph_anchor_valid: validation.paragraph_anchor_valid,
      quote_leak: quoteLeak,
      enrichment_success: enrichment.success,
      fully_valid: fullyValid && enrichment.success,
      entities: parsed?.entities?.length ?? 0,
      themes: parsed?.themes?.length ?? 0,
      citations: parsed?.citations?.length ?? 0,
      quote_events: parsed?.quote_events?.length ?? 0,
      evidence_objects: enrichment.evidence_objects,
      quotes_attached: enrichment.quotes_attached,
      paragraph_fallbacks: enrichment.paragraph_fallbacks,
      failure_reason: failureReason,
      est_prompt_tokens: estPromptTok,
      est_completion_tokens: estComplTok,
    });
  }

  // Aggregate over every window that now has a meta on disk (full done set).
  const done = reports.filter((r) => r.fully_valid);
  const n = reports.length;
  const validJson = reports.filter((r) => r.valid_json).length;
  const schemaValidRaw = reports.filter((r) => r.schema_valid_raw).length;
  const needingRepair = reports.filter((r) => r.const_repaired_fields > 0).length;
  const anchorValid = reports.filter((r) => r.paragraph_anchor_valid).length;
  const enriched = reports.filter((r) => r.enrichment_success).length;
  const leaks = reports.filter((r) => r.quote_leak).length;
  const promptTok = reports.reduce((s, r) => s + r.est_prompt_tokens, 0);
  const complTok = reports.reduce((s, r) => s + r.est_completion_tokens, 0);
  const estCost = promptTok / 1e6 * PRICE_IN + complTok / 1e6 * PRICE_OUT;

  const failureQueue = reports.filter((r) => !r.fully_valid).map((r) => ({
    window_id: r.window_id,
    work_slug: r.work_slug,
    reason: r.failure_reason,
    valid_json: r.valid_json,
    schema_valid: r.schema_valid,
    paragraph_anchor_valid: r.paragraph_anchor_valid,
    quote_leak: r.quote_leak,
  }));

  const totalWindows = windows.size || TOTAL_WINDOWS_HINT;
  const costPerValid = done.length ? estCost / done.length : null;
  const summary = {
    generated_at: new Date().toISOString(),
    run_dir: runDir,
    model: MODEL,
    route: "claude-code-sonnet-subagent-production",
    prompt_path: PROMPT_PATH,
    prompt_version: "anchor-range-v1",
    pricing_usd_per_mtok: { input: PRICE_IN, output: PRICE_OUT },
    token_counts: "ESTIMATED (chars/4); subagent route exposes no exact usage",
    total_archive_windows: totalWindows,
    responses_finalized: n,
    fully_valid: done.length,
    valid_json: validJson,
    schema_valid_raw: schemaValidRaw,
    windows_needing_const_repair: needingRepair,
    paragraph_anchor_valid: anchorValid,
    enrichment_success: enriched,
    quote_leaks: leaks,
    valid_json_rate: n ? validJson / n : 0,
    paragraph_anchor_rate: n ? anchorValid / n : 0,
    fully_valid_rate: n ? done.length / n : 0,
    est_cost_usd_this_finalize: estCost,
    est_cost_per_valid_window: costPerValid,
    extraction_volume: {
      entities: reports.reduce((s, r) => s + r.entities, 0),
      themes: reports.reduce((s, r) => s + r.themes, 0),
      citations: reports.reduce((s, r) => s + r.citations, 0),
      quote_events: reports.reduce((s, r) => s + r.quote_events, 0),
      evidence_objects: reports.reduce((s, r) => s + r.evidence_objects, 0),
      quotes_attached: reports.reduce((s, r) => s + r.quotes_attached, 0),
      paragraph_fallbacks: reports.reduce((s, r) => s + r.paragraph_fallbacks, 0),
    },
    full_archive_projection: {
      remaining_windows: totalWindows - done.length,
      est_cost_full_archive_usd: costPerValid !== null ? costPerValid * totalWindows : null,
    },
    reports,
    failure_queue: failureQueue,
  };
  writeFileSync(join(runDir, "production-run-summary.json"), JSON.stringify(summary, null, 2));

  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "0.0");
  console.log(JSON.stringify({
    responses_finalized: n,
    fully_valid: done.length,
    valid_json_pct: pct(validJson, n),
    schema_valid_raw_pct: pct(schemaValidRaw, n),
    anchor_valid_pct: pct(anchorValid, n),
    enrichment_pct: pct(enriched, n),
    quote_leaks: leaks,
    est_cost_per_valid_window: costPerValid,
    est_cost_full_archive_usd: costPerValid !== null ? costPerValid * totalWindows : null,
    failure_queue: failureQueue.length,
  }, null, 2));
  void percentile;
}

function main(): void {
  const mode = process.argv[2];
  if (mode === "prepare") return prepare();
  if (mode === "finalize") return finalize();
  console.error("usage: ontology-sonnet-production.ts <prepare|finalize> [--run-dir DIR] [--count N] [--batch NAME]");
  process.exit(1);
}

main();
