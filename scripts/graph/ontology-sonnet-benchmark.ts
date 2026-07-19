/**
 * Sonnet subagent benchmark for the ontology anchor-range-v1 pipeline.
 *
 * This does NOT call any model. It is the deterministic half of a two-phase
 * benchmark whose model half is executed by Claude Code Sonnet subagents:
 *
 *   1. `prepare`  - build REAL corpus windows using the canonical production
 *                   harness (scripts/graph/ontology-production-run.ts), select a
 *                   diverse subset, and write each rendered canonical prompt to
 *                   <run>/prompts/<window_id>.prompt.txt. A subagent is then
 *                   dispatched per window; its raw JSON response is saved to
 *                   <run>/responses/<window_id>.response.txt.
 *   2. `finalize` - read the saved responses, run the SAME canonical
 *                   validation + deterministic quote enrichment used in
 *                   production, and emit per-window meta + a run summary/report.
 *
 * The model is never asked to write quotes; it only returns paragraph anchors.
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
// Sonnet 4.x standard API pricing (USD per 1M tokens). Override via env if needed.
const PRICE_IN = Number.parseFloat(process.env["SONNET_PRICE_IN"] ?? "3.0");
const PRICE_OUT = Number.parseFloat(process.env["SONNET_PRICE_OUT"] ?? "15.0");
const TOTAL_WINDOWS = 12_929;

function argValue(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1] ?? fallback;
  return fallback;
}

/** Rough token estimate (chars/4) used only when real usage is unavailable. */
function estTokens(chars: number): number {
  return Math.round(chars / 4);
}

/**
 * Lossless deterministic schema repair applied before validation, mirroring the
 * production plan's "schema repair and validation retries" step. Only touches
 * fields whose schema value is a constant, so no model information is altered.
 * Repairs, all lossless:
 *  - quote_event.source has const "manual"; some outputs omit it.
 *  - citation requires both cited_work and cited_author KEYS present (values may
 *    be empty as long as one is non-empty per the schema's anyOf). Models that
 *    cite a bare author omit the cited_work key entirely; default the absent key
 *    to "". A citation with BOTH empty still fails validation, so no real
 *    "empty citation" is masked.
 * Returns the number of fields repaired so we can report raw-vs-repaired rates.
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

interface Selected {
  window_id: string;
  work_slug: string;
  title: string;
  genre: string;
  language: string;
  bucket: string;
  paragraph_count: number;
  prompt_chars: number;
  est_prompt_tokens: number;
}

function bucketOf(w: WorkWindow): string {
  return `${w.genre || "?"}|${w.language || "?"}`;
}

/** Pick a diverse subset: round-robin across genre|language buckets. */
function selectDiverse(windows: WorkWindow[], n: number): WorkWindow[] {
  const buckets = new Map<string, WorkWindow[]>();
  for (const w of windows) {
    const key = bucketOf(w);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(w);
  }
  // Deterministic bucket order: by descending bucket size, then name.
  const order = [...buckets.keys()].sort((a, b) => {
    const d = buckets.get(b)!.length - buckets.get(a)!.length;
    return d !== 0 ? d : a.localeCompare(b);
  });
  const picked: WorkWindow[] = [];
  let round = 0;
  while (picked.length < n) {
    let advanced = false;
    for (const key of order) {
      const list = buckets.get(key)!;
      if (round < list.length) {
        picked.push(list[round]!);
        advanced = true;
        if (picked.length >= n) break;
      }
    }
    if (!advanced) break;
    round++;
  }
  return picked;
}

function runDirArg(): string {
  return resolve(
    argValue("run-dir", join(CORPUS, "graph", "ontology-runs", "2026-07-02-sonnet-benchmark"))!,
  );
}

function prepare(): void {
  const runDir = runDirArg();
  const n = Number.parseInt(argValue("select", "16")!, 10);
  mkdirSync(join(runDir, "prompts"), { recursive: true });
  mkdirSync(join(runDir, "responses"), { recursive: true });
  mkdirSync(join(runDir, "windows"), { recursive: true });

  const windows = buildWindows(runDir);
  const chosen = selectDiverse(windows, n);

  const selected: Selected[] = [];
  for (const w of chosen) {
    writeFileSync(join(runDir, "prompts", `${w.window_id}.prompt.txt`), w.prompt);
    selected.push({
      window_id: w.window_id,
      work_slug: w.work_slug,
      title: w.title,
      genre: w.genre,
      language: w.language,
      bucket: bucketOf(w),
      paragraph_count: w.paragraphs.length,
      prompt_chars: w.prompt.length,
      est_prompt_tokens: estTokens(w.prompt.length),
    });
  }
  writeFileSync(join(runDir, "selection.json"), JSON.stringify(selected, null, 2));
  console.log(JSON.stringify({ run_dir: runDir, total_windows: windows.length, selected: selected.length, buckets: [...new Set(selected.map((s) => s.bucket))], windows: selected }, null, 2));
}

interface BatchSummary {
  batch: string;
  attempted: number;
  completed: number;
  valid_json: number;
  schema_valid_raw: number;
  schema_valid: number;
  windows_needing_const_repair: number;
  paragraph_anchor_valid: number;
  enriched: number;
  valid: number;
  valid_pct: number;
  retries: number;
  failures_by_reason: Record<string, number>;
  wall_clock_seconds: number | null;
  windows_per_minute: number | null;
  valid_windows_per_hour: number | null;
  est_prompt_tokens_per_window: number;
  est_completion_tokens_per_window: number;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  max_latency_ms: number | null;
  est_cost: number | null;
  est_cost_per_valid_window: number | null;
  decision: string;
}

interface Timings {
  // batch name -> { window_ids, wall_clock_seconds, per_window_latency_ms?, retries? }
  [batch: string]: {
    window_ids: string[];
    wall_clock_seconds: number;
    per_window_latency_ms?: Record<string, number>;
    retries?: number;
  };
}

function healthDecision(validJsonRate: number, anchorRate: number, retryRate: number): string {
  if (validJsonRate < 0.95) return "STOP: valid JSON < 95%";
  if (anchorRate < 0.99) return "STOP: anchor validity < 99%";
  if (retryRate > 0.2) return "STEP DOWN: retry/failure > 20%";
  return "healthy";
}

function finalize(): void {
  const runDir = runDirArg();
  const selection = JSON.parse(readFileSync(join(runDir, "selection.json"), "utf-8")) as Selected[];
  const selById = new Map(selection.map((s) => [s.window_id, s]));
  const timingsPath = join(runDir, "timings.json");
  const timings: Timings = existsSync(timingsPath) ? JSON.parse(readFileSync(timingsPath, "utf-8")) : {};

  // Rebuild windows (need paragraphs) and index by id.
  const windows = new Map(buildWindows(runDir).map((w) => [w.window_id, w]));

  const responsesDir = join(runDir, "responses");
  const available = new Set(
    existsSync(responsesDir)
      ? readdirSync(responsesDir).filter((f) => f.endsWith(".response.txt")).map((f) => f.replace(/\.response\.txt$/, ""))
      : [],
  );

  const metas = new Map<string, WindowMeta>();
  const estCompletionChars = new Map<string, number>();
  const rawSchemaValidById = new Map<string, boolean>();
  const repairedById = new Map<string, number>();

  for (const sel of selection) {
    if (!available.has(sel.window_id)) continue;
    const window = windows.get(sel.window_id);
    if (!window) {
      console.error(`window not found in build: ${sel.window_id}`);
      continue;
    }
    const raw = readFileSync(join(responsesDir, `${sel.window_id}.response.txt`), "utf-8");
    estCompletionChars.set(sel.window_id, raw.length);
    const startedAt = new Date().toISOString();
    let parsed: OntologyOutput | null = null;
    let rawSchemaValid = false;
    let repairedFields = 0;
    let validation = { valid_json: false, schema_valid: false, paragraph_anchor_valid: false, errors: [] as string[] };
    let enrichment = { success: false, evidence_objects: 0, quotes_attached: 0, paragraph_fallbacks: 0, errors: ["not run"] as string[] };
    try {
      parsed = extractJson(raw) as OntologyOutput;
      // Raw model validity (before any deterministic repair).
      rawSchemaValid = validateOntology(parsed, window).schema_valid;
      // Lossless const-field repair, then authoritative validation.
      repairedFields = normalizeOntology(parsed);
      validation = validateOntology(parsed, window);
    } catch (err) {
      validation = { valid_json: false, schema_valid: false, paragraph_anchor_valid: false, errors: [err instanceof Error ? err.message : String(err)] };
    }
    if (parsed && validation.schema_valid && validation.paragraph_anchor_valid) {
      writeFileSync(window.anchor_path, JSON.stringify(parsed, null, 2));
      const enriched = enrichOntology(parsed, window);
      enrichment = enriched.result;
      if (enrichment.success) writeFileSync(window.enriched_path, JSON.stringify(enriched.output, null, 2));
    }
    const meta: WindowMeta = {
      window_id: sel.window_id,
      work_slug: sel.work_slug,
      chapter_tokens: window.chapter_tokens,
      prompt_version: "anchor-range-v1",
      prompt_path: PROMPT_PATH,
      model: MODEL,
      base_url: "claude-code-subagent",
      server_config: { route: "sonnet-subagent" },
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      latency_ms: 0,
      attempts: [],
      validation,
      enrichment,
      usage: {
        prompt_tokens: sel.est_prompt_tokens,
        completion_tokens: estTokens(raw.length),
        total_tokens: sel.est_prompt_tokens + estTokens(raw.length),
      },
    };
    writeFileSync(window.meta_path, JSON.stringify(meta, null, 2));
    metas.set(sel.window_id, meta);
    rawSchemaValidById.set(sel.window_id, rawSchemaValid);
    repairedById.set(sel.window_id, repairedFields);
  }

  // Build batch summaries from timings (each batch lists its window ids).
  const batchNames = Object.keys(timings);
  const summaries: BatchSummary[] = [];
  const summarize = (name: string, ids: string[], wallClock: number | null, perWindow?: Record<string, number>, retries = 0): BatchSummary => {
    const present = ids.filter((id) => metas.has(id));
    const ms = present.map((id) => metas.get(id)!);
    const validJson = ms.filter((m) => m.validation.valid_json).length;
    const schemaValidRaw = present.filter((id) => rawSchemaValidById.get(id)).length;
    const needingRepair = present.filter((id) => (repairedById.get(id) ?? 0) > 0).length;
    const schemaValid = ms.filter((m) => m.validation.schema_valid).length;
    const anchorValid = ms.filter((m) => m.validation.paragraph_anchor_valid).length;
    const enriched = ms.filter((m) => m.enrichment.success).length;
    const valid = ms.filter((m) => m.validation.schema_valid && m.validation.paragraph_anchor_valid && m.enrichment.success).length;
    const failures: Record<string, number> = {};
    for (const m of ms) {
      if (!(m.validation.schema_valid && m.validation.paragraph_anchor_valid && m.enrichment.success)) {
        const reason = m.validation.errors[0] ?? m.enrichment.errors[0] ?? "unknown";
        failures[reason] = (failures[reason] ?? 0) + 1;
      }
    }
    const attempted = ids.length;
    const promptTok = present.reduce((s, id) => s + (selById.get(id)?.est_prompt_tokens ?? 0), 0);
    const complTok = present.reduce((s, id) => s + estTokens(estCompletionChars.get(id) ?? 0), 0);
    const latencies = perWindow ? present.map((id) => perWindow[id]).filter((v): v is number => typeof v === "number") : [];
    const estCost = promptTok / 1e6 * PRICE_IN + complTok / 1e6 * PRICE_OUT;
    const validJsonRate = present.length ? validJson / present.length : 0;
    const anchorRate = present.length ? anchorValid / present.length : 0;
    // "retry/failure" proxy: fraction of attempted windows that are not fully valid.
    const failRate = attempted ? (attempted - valid) / attempted : 0;
    return {
      batch: name,
      attempted,
      completed: present.length,
      valid_json: validJson,
      schema_valid_raw: schemaValidRaw,
      schema_valid: schemaValid,
      windows_needing_const_repair: needingRepair,
      paragraph_anchor_valid: anchorValid,
      enriched,
      valid,
      valid_pct: attempted ? (valid / attempted) * 100 : 0,
      retries,
      failures_by_reason: failures,
      wall_clock_seconds: wallClock,
      windows_per_minute: wallClock ? present.length / (wallClock / 60) : null,
      valid_windows_per_hour: wallClock ? valid / (wallClock / 3600) : null,
      est_prompt_tokens_per_window: present.length ? Math.round(promptTok / present.length) : 0,
      est_completion_tokens_per_window: present.length ? Math.round(complTok / present.length) : 0,
      p50_latency_ms: percentile(latencies, 50),
      p95_latency_ms: percentile(latencies, 95),
      max_latency_ms: latencies.length ? Math.max(...latencies) : null,
      est_cost: estCost,
      est_cost_per_valid_window: valid > 0 ? estCost / valid : null,
      decision: healthDecision(validJsonRate, anchorRate, failRate),
    };
  };

  for (const name of batchNames) {
    const t = timings[name]!;
    summaries.push(summarize(name, t.window_ids, t.wall_clock_seconds, t.per_window_latency_ms, t.retries ?? 0));
  }
  // Always include a cumulative "all" batch across every response present.
  const allIds = [...metas.keys()];
  const allWall = batchNames.reduce((s, n) => s + (timings[n]!.wall_clock_seconds ?? 0), 0) || null;
  const allPerWindow = Object.assign({}, ...batchNames.map((n) => timings[n]!.per_window_latency_ms ?? {}));
  const allRetries = batchNames.reduce((s, n) => s + (timings[n]!.retries ?? 0), 0);
  summaries.push(summarize("cumulative", allIds, allWall, Object.keys(allPerWindow).length ? allPerWindow : undefined, allRetries));

  const finalRate = summaries.find((s) => s.batch === "cumulative")?.valid_windows_per_hour ?? null;
  const projected = finalRate ? TOTAL_WINDOWS / finalRate : null;
  const cumCost = summaries.find((s) => s.batch === "cumulative")?.est_cost ?? null;
  const cumValid = summaries.find((s) => s.batch === "cumulative")?.valid ?? 0;
  const projectedCost = cumValid > 0 && cumCost !== null ? (cumCost / cumValid) * TOTAL_WINDOWS : null;

  const summary = {
    generated_at: new Date().toISOString(),
    run_dir: runDir,
    model: MODEL,
    route: "claude-code-sonnet-subagent",
    prompt_path: PROMPT_PATH,
    prompt_version: "anchor-range-v1",
    pricing_usd_per_mtok: { input: PRICE_IN, output: PRICE_OUT },
    token_counts: "ESTIMATED (chars/4); subagent route exposes no exact usage",
    selected_windows: selection.length,
    responses_present: metas.size,
    batches: summaries,
    projection: {
      total_windows: TOTAL_WINDOWS,
      valid_windows_per_hour: finalRate,
      expected_hours: projected,
      expected_cost_usd: projectedCost,
    },
  };
  writeFileSync(join(runDir, "run-summary.json"), JSON.stringify(summary, null, 2));

  const fmt = (v: number | null, unit = "") => (v === null ? "n/a" : `${v.toFixed(unit === "s" ? 1 : unit === "$" ? 4 : 1)}${unit === "s" ? "s" : ""}`);
  const lines = [
    "# Ontology Sonnet Subagent Benchmark",
    "",
    `Generated: ${summary.generated_at}`,
    `Model: \`${MODEL}\` via Claude Code Sonnet subagents`,
    `Prompt: \`${PROMPT_PATH}\` (anchor-range-v1)`,
    `Token counts are ESTIMATED (chars/4); the subagent route exposes no exact API usage.`,
    "",
    "| batch | attempted | valid | valid % | retries | p95 latency | valid windows/hour | est. cost | cost/valid window | decision |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...summaries.map((s) => {
      const p95 = s.p95_latency_ms === null ? "n/a" : `${(s.p95_latency_ms / 1000).toFixed(1)}s`;
      const vph = s.valid_windows_per_hour === null ? "n/a" : s.valid_windows_per_hour.toFixed(1);
      const cost = s.est_cost === null ? "n/a" : `$${s.est_cost.toFixed(4)}`;
      const cpv = s.est_cost_per_valid_window === null ? "n/a" : `$${s.est_cost_per_valid_window.toFixed(4)}`;
      return `| ${s.batch} | ${s.attempted} | ${s.valid} | ${s.valid_pct.toFixed(1)}% | ${s.retries} | ${p95} | ${vph} | ${cost} | ${cpv} | ${s.decision} |`;
    }),
    "",
    `Projected full run (${TOTAL_WINDOWS} windows):`,
    `- valid windows/hour: ${finalRate === null ? "n/a" : finalRate.toFixed(1)}`,
    `- expected hours: ${projected === null ? "n/a" : projected.toFixed(1)}`,
    `- expected cost (est.): ${projectedCost === null ? "n/a" : `$${projectedCost.toFixed(0)}`}`,
    "",
  ];
  writeFileSync(join(runDir, "run-summary.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

function main(): void {
  const mode = process.argv[2];
  if (mode === "prepare") return prepare();
  if (mode === "finalize") return finalize();
  console.error("usage: ontology-sonnet-benchmark.ts <prepare|finalize> [--run-dir DIR] [--select N]");
  process.exit(1);
}

main();
