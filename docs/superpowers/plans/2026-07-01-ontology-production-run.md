# Ontology Production Run Plan

Date: 2026-07-01

This is the first production extraction run for the restarted Falsafa ontology. The prompt, schema, anchoring design, model choice, and deterministic quote-enrichment approach are now treated as fixed for run planning. The run should not be framed as another benchmark, except where we measure operational throughput and failure rates.

## Fixed Inputs

- Prompt/schema: `scripts/graph/prompts/ontology-anchor-range-v1.md`
- Output version: `anchor-range-v1`
- Model target: GLM-5.2 quality path
- Evidence strategy: paragraph ids and paragraph ranges only
- Quote strategy: no model-written quotes; attach quote arrays deterministically after validation
- Corpus estimate: 12,929 extraction windows
- Expected input volume: about 133.3M prompt tokens

## Production Goal

Produce validated ontology JSON for every selected corpus window, with:

- entities;
- themes;
- citations;
- quote events;
- valid paragraph evidence anchors;
- deterministic quote arrays attached after model output;
- enough run metadata to resume, audit, repair, and reconcile.

The first pass is allowed to be imperfect in ontology judgment. It is not allowed to be unauditable. Every output must preserve its source window, prompt version, model, usage, timestamps, validation result, retry history, and deterministic enrichment result.

## Throughput Metric

Because windows are independent, concurrency is an operational question, not a semantic-quality question. Measure:

- valid windows per hour;
- valid JSON rate;
- valid paragraph-anchor rate;
- retry rate;
- timeout rate;
- average and p95 latency;
- output tokens per valid window;
- GPU cost per valid window if self-hosted;
- API cost per valid window if routed through OpenRouter.

The main number is:

```text
valid_windows_per_hour
```

The whole-run time estimate is:

```text
12,929 / valid_windows_per_hour
```

## Run Shape

### 1. Canary

Run 25-50 real windows across mixed corpus types:

- dense legal/dharmashastra material;
- dialogue material;
- poetry or aphoristic material;
- modern social/political prose;
- long translated prose windows;
- windows with many citations;
- windows with few or no citations.

Accept the canary only if:

- every completed output parses as JSON;
- every output has all top-level arrays;
- anchor validation succeeds;
- deterministic enrichment can attach quotes or paragraph-level evidence;
- no systemic field drift appears;
- output size is not routinely truncated.

### 2. Throughput Ramp

Use the same production prompt and real windows. Start ambitiously at 32 concurrent windows, because the windows are independent and the purpose is to measure throughput. Then move in steps of 8.

```text
32, 40, 48, 56, 64, ...
```

If 32 is unstable, step down by 8:

```text
24, 16, 8
```

Stop increasing concurrency when:

- throughput flattens;
- p95 latency jumps sharply;
- timeouts become common;
- JSON/schema errors increase;
- GPU memory pressure causes instability;
- retry cost eats the throughput gain.

### 3. Main Pass

Run all remaining windows with the best stable concurrency discovered in the ramp.

Each window should be idempotent:

- deterministic output path;
- skip if a valid enriched output already exists;
- retry if missing, invalid, timed out, or truncated;
- quarantine persistent failures into a separate repair queue.

### 4. Repair Queue

Do not let hard cases block the main run. Collect failures with reason codes:

- model timeout;
- malformed JSON;
- schema mismatch;
- missing top-level arrays;
- invalid paragraph id;
- invalid paragraph range;
- truncated output;
- empty extraction on non-empty source.

Repair them after the main pass with either stricter retry settings, smaller windows, or a more expensive reviewer model only for genuinely hard cases.

### 5. Reconciliation

After first-pass extraction:

- merge aliases and duplicate entities;
- resolve citations to works and authors already in the corpus;
- locate cited/referenced ideas in target works where possible;
- connect quote events to people, works, doctrines, and paragraph evidence;
- compare against old prototype ontology files only as recall/regression material;
- run a fidelity pass for claims that depend on cross-work matches.

## Stop Conditions

Pause the production run if any of these happen:

- valid JSON rate falls below 95% over a batch of 100 windows;
- anchor validation falls below 99% over a batch of 100 windows;
- average retries exceed 20%;
- output truncation appears more than a few times;
- cost per valid window is more than 2x the canary estimate;
- a prompt/schema ambiguity produces repeated bad structure.

## Expected Decision After One Hour

After the first production hour, decide one of:

1. Continue full run at current concurrency.
2. Continue full run with lower concurrency.
3. Split the hardest windows and continue.
4. Pause and repair the prompt/schema only if the issue is systemic.
5. Switch back to API route if self-hosted throughput is worse than expected.

The purpose of the hour is not to prove whether the ontology idea works. That has already been established. The purpose is to identify the real production rate and failure curve.
