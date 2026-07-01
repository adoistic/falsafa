# Ontology API Cost Estimate

Date: 2026-07-01

This estimate counts input tokens from actual corpus windows using `tiktoken` locally. It uses the full prompt style in `scripts/graph/prompts/ontology-anchor-range-v1.md`, including the JSON Schema, dynamic work metadata, allowed paragraph ids, and source paragraphs.

## Corpus Windowing

- Estimated windows: 12,929
- Source characters counted: 384,876,240
- Source tokens: 85,518,635
- Full prompt input tokens: 133,281,600
- Prompt/schema/id overhead: 47,762,965
- Average input tokens per window: 10,309
- Median input tokens per window: 11,003
- p90 input tokens per window: 13,703
- p99 input tokens per window: 18,985
- Largest input window: 51,152

## Model Prices Used

- GLM-5.2 on OpenRouter: $0.93/M input, $3.00/M output, $0.18/M cached input.
- MiMo V2.5 Pro on OpenRouter: $0.435/M input, $0.87/M output, $0.0036/M cached input.

## Output Token Assumption

Input cost can be counted directly. Output cost cannot be known until extraction runs, so it is projected from pilot output/input ratios.

- GLM full-schema pilot output/input ratio: 1.52x
- MiMo full-schema pilot output/input ratio: 1.18x

The MiMo pilot includes one failed dense window, so its 1.18x ratio may be too optimistic. A non-failed-window estimate was about 1.57x.

## First-Pass Extraction Cost

| Model | Scenario | Input | Output est. | Base cost | +15% retry | +30% buffer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GLM-5.2 | low 1.0x output | 133.3M | 133.3M | $524 | $602 | $681 |
| GLM-5.2 | pilot 1.52x output | 133.3M | 203.2M | $733 | $843 | $953 |
| GLM-5.2 | high 2.0x output | 133.3M | 266.6M | $924 | $1,062 | $1,201 |
| MiMo V2.5 Pro | low 1.0x output | 133.3M | 133.3M | $174 | $200 | $226 |
| MiMo V2.5 Pro | pilot 1.18x output | 133.3M | 157.8M | $195 | $225 | $254 |
| MiMo V2.5 Pro | high 1.8x output | 133.3M | 239.9M | $267 | $307 | $347 |

## Cache Effect

The full prompt repeats a large static prefix: instructions plus JSON Schema. The estimate above charges all input tokens at normal input price. If provider prompt caching applies to the static prefix, input costs can drop.

Approximate cached-overhead input cost:

- GLM-5.2 input side: about $88 instead of $124.
- MiMo V2.5 Pro input side: about $37 instead of $58.

Output still dominates GLM. MiMo benefits more from caching because its cached-input price is extremely low.

## Reconciliation Cost

The extraction pass is not the whole ontology. We still need:

- schema repair and validation retries;
- deterministic quote enrichment;
- entity/alias merge;
- citation target resolution;
- fidelity pass from citation target to in-corpus paragraphs;
- cross-work and cross-tradition relation synthesis.

These should not rerun the full source through the model. They should mostly operate on extracted JSON plus targeted paragraphs.

Planning reserve:

- MiMo first pass plus validation/reconciliation: roughly $350-$900.
- GLM first pass plus validation/reconciliation: roughly $900-$1,700.
- Add frontier-model review only for hard merge conflicts and contested cross-tradition concepts.

## Raw Estimate File

The raw machine-readable estimate was written to:

`corpus/graph/ontology-codex-pilot/cost-estimate-fullschema-2026-07-01.json`
