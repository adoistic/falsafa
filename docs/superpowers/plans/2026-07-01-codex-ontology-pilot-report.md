# Codex Ontology Pilot Report

Date: 2026-07-01

## Scope

This is a small Codex-produced ontology pilot, kept separate from the canonical ontology directory:

- `corpus/graph/ontology-codex-pilot/v1/plato-apology-dbfd5d-part01.json`
- `corpus/graph/ontology-codex-pilot/v1/plato-crito-33befc.json`
- `corpus/graph/ontology-codex-pilot/v1/unknown-parasara-smrti-2259be-ch06.json`

The aim is not to continue the old v1 ontology as-is. It is a controlled comparison against the earlier Claude-subagent outputs, using the same basic schema and stricter grounding discipline.

## Count Comparison

| Work/window | Existing Claude output | Codex pilot |
| --- | ---: | ---: |
| Plato, Apology part 01 | 41 entities, 10 themes, 4 citations | 14 entities, 6 themes, 3 citations |
| Plato, Crito | 16 entities, 12 themes, 1 citation | 10 entities, 7 themes, 1 citation |
| Parāśara Smṛti part 02 vs chapter 06 only | 17 entities, 8 themes, 4 citations | 14 entities, 8 themes, 3 citations |

The Parāśara comparison is not apples-to-apples: the older file covers chapters 06-09, while this pilot covers chapter 06 only.

## Validation

Every entity mention, theme mention, and citation quote in the three Codex pilot files was mechanically checked against the relevant `translation.paragraphs.json` source. All passed. The existing quote-event helper tests also passed: 8 tests, 0 failures.

## Honest Read

Codex can do this, but the production strategy matters.

The Codex pilot is higher precision and easier to audit. It is conservative about entities, avoids turning every proper noun into a node, separates themes from entities more cleanly, and makes the justification field do real work. It also fits the deeper ontology direction: quote/person-level edges, exact passage grounding, and a graph that can later support questions like who is quoted, where, with what stance, and at what level of textual granularity.

The earlier Claude-subagent outputs are stronger on breadth. They collect more names and possibilities in one pass, which is useful for recall and discovery. They also show why parallel subagents were attractive: many windows can be processed at once, and each output is complete enough to inspect without waiting for one main thread to finish everything.

The risk with Codex is not capability; it is throughput and consistency over a full corpus if done manually in one thread. A main-agent-only Codex grind would be too slow and would invite drift. A Codex version should be run as an orchestrated pipeline: fixed prompt, fixed JSON schema, small windows, grounding validation, then merge/dedupe/fidelity passes. Old ontology files should be used as comparison and regression material, not as canonical truth.

## Recommendation

Use Codex for the restart if we build the runner around it. The right shape is:

1. freeze a stricter schema with quote events, entities, themes, citations, and later relation edges;
2. run small windows through Codex workers or repeated Codex sessions with identical instructions;
3. validate every paragraph id and quote mechanically;
4. aggregate only after validation passes;
5. compare against the old Claude ontology to find recall gaps, not to inherit its ontology wholesale.

Verdict: Codex is capable of the quality target. Claude-style subagents still win on raw parallel throughput unless Codex is given an equivalent worker/orchestration setup.
