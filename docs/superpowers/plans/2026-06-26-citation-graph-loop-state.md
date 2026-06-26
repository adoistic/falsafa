# Citation-Graph Autonomous Loop — State & Log

**Read this first on every wake-up.** Self-paced loop processing the archive through the
citation pipeline, hardening as issues surface, until stable (~1/4) then cruising the 3/4.
Branch: `feat/citation-graph-pipeline`. Pipeline: `scripts/graph/`. Output: `corpus/graph/`
(git-ignored). Run a batch: `bun run scripts/graph/run.ts <slug> [slug...]`. Raw refs cache at
`corpus/graph/raw/<slug>.json` — re-running a cached work makes NO LLM call (free re-resolve).

## ACTIVE (2026-06-27 ~00:10 IST) — FIGURE LAYER added (Adnan's mythological-names directive)
Adnan: do NOT discard mythological figures as "non-citations" — they're a valuable cross-work layer,
AND recurring figures point to FOUNDING TEXTS we should acquire. So extraction is now TWO layers/work:
  (1) citations  → corpus/graph/raw/v2/<slug>.json   (work/author cited as source — unchanged)
  (2) FIGURES    → corpus/graph/figures/v1/<slug>.json
      each = {work_slug, canonical_name, surface_names[], figure_kind: mythological|deity|historical,
              mentions:[{paragraph_id, quote, role}], portrayal, founding_texts:[...]}
FIGURE FILES DONE (9, 402 raw figures): ovid-ars-amatoria (131), seneca-medea (60),
  hesiod-works-and-days (43), unknown-parasara-smrti (38), seneca-phaedra (33), seneca-oedipus (32),
  homeric-hymn-to-aphrodite (24), plautus-poenulus (22), homeric-hymn-to-demeter (19).
  hesiod-theogony: STILL MISSING (background worker ab229d6c never notified — re-dispatch it; keystone).
KEY INSIGHT — founding texts mostly resolve IN-CORPUS: we hold Homer (Iliad/Odyssey/Hymns), Hesiod
  (Theogony/W&D), ALL Seneca tragedies (his own Medea/Phaedra/Oedipus/Hercules), Ovid's complete works
  (Metamorphoses), Virgil, Apuleius. So the figure layer draws mostly INTERNAL founding-text links (the
  "even more fascinating" case); acquisition list = the genuine gaps (Euripides' Medea, Apollonius'
  Argonautica, lost tragedians). Cross-cultural proven on Indic side (Manu→Manusmṛti/Vedas,
  Parāśara→Viṣṇu-Purāṇa/Mahābhārata, Agni→Ṛgveda).
THEONYM MERGE needed in the aggregator: Greek=Roman identity (Zeus=Jupiter, Aphrodite=Venus,
  Heracles=Hercules, Odysseus=Ulysses) — the figure-layer analogue of author alias-merge.
DONE (figure layer) — aggregator BUILT + TDD'd (11 tests pass), committed:
  scripts/graph/theonyms.ts (Greek/Roman merge table), figures.ts (canonicalFigureId/mergeFigures/
  normalizeFoundingText/resolveFoundingText/buildFoundingTextList), figures-run.ts (writes
  corpus/graph/{figure-index.json, figures.md, founding-texts.md}). resolve-references.ts now exports contains().
  RESULTS (9 works): 301 distinct figures, 56 cross-work — Zeus 8 works/56 mentions (merges Jupiter+Zeus),
  Aphrodite 5 works (merges Venus/Cytherea), Hades (Pluto/Dis/Orcus), Ares (Mars/Gradivus), Athena (Minerva/Pallas).
  Founding texts: 267 total → 217 resolve IN-CORPUS (Hesiod Theogony←72 figures, Hesiod W&D←48, Homer Iliad←32,
  Ovid Metamorphoses←20, + Euripides Medea/Bacchae/Hippolytus, Apollodorus, Pindar, Sophocles, Virgil — the
  corpus is a DEEP classical library); 50 ABSENT→acquire, ranked: Mahābhārata 23, Ṛgveda 20, Sophocles
  Oedipus Rex 11, Śatapatha Brāhmaṇa / Atharva Veda 8, + Purāṇic/Vedic/smṛti texts (Indic gaps dominate).
  Resolver verifies AUTHOR (Euripides-Medea ≠ Seneca-Medea we hold), routes "Homeric Hymn to X" to the held
  hymn work, tolerates author name-variants (Apollonius of Rhodes ≡ Rhodius), suppresses generic-title noise.
NEXT (figure layer):
  (a) re-dispatch hesiod-theogony figures (keystone, still missing — worker ab229d6c).
  (b) keep grinding more works through BOTH layers — esp. the HELD founding texts (Homer Iliad/Odyssey,
      Ovid Metamorphoses, Virgil Aeneid, more Seneca/Euripides tragedies) so cross-work figure pages deepen.
  (c) polish later: collapse book-number variants ("Ovid, Metamorphoses VIII" → the work); minor.
  (d) citation layer still at ~18 works — resume dual citation+figure grind on prose works.
OPS: 5-hour usage limit resets 2:00am IST. Session cron 8723d66e fires ~2:15am daily to resume
  (reads THIS file first). It is session-only — relies on the Claude process staying alive; if it
  dies, re-arm a cron or run an OS-level launchd job off this file.

## Phases
1. **Validate** ✓ — Parāśara run end-to-end; real cross-work edges + acquisition list.
2. **Harden (→ ~460 works / 1/4)** — diverse batches; fix issues after each; until error +
   ambiguity + false-edge rates flatten. **EARLY CHECKPOINT: stop + report to Adnan after the
   first real batch.** **MAIN CHECKPOINT: stop + report at ~460 works before the 3/4 cruise.**
3. **Cruise (the 3/4)** — large autonomous batches once stable.

## Hardening backlog
- [x] H1 — word-boundary token resolver matching (killed substring false-matches). `6cfddbc7a`.
- [x] INFRA-A — char-budget chunking (40k-char windows) in `extract-references.ts`. `e8f970975`.
- [x] INFRA-B — raw-ref cache `corpus/graph/raw/<slug>.json`; `run.ts` uses `getReferences`. `e8f970975`.
- [ ] H2 — drop/tag self-citations (work citing its own author). Lower priority — noise, not wrong.
- [ ] H3 — persist ambiguous + unresolved refs to `corpus/graph/review.json` (was 0 on Parāśara post-H1).
- [ ] QUALITY — verify the quote actually appears in its paragraph (today only checks the p-id exists).
- [ ] RESOLVER — alias/epithet table for divergent surface forms (Svāyaṃbhuva = Manu, etc.).

## Progress
- Works processed: 1 (Parāśara). Chunking + caching live-verified.
- Latest Parāśara stats (post-H1): 46 refs · 25 in_corpus · 21 absent · 0 ambiguous.
- Spend so far: a few cheap calls (validation + 2 hardening re-runs).

## Metrics to watch (stability signals)
extraction errors/timeouts · % ambiguous · % absent · false-edge spot-check rate · quote-fidelity.
"Stable" = flat across the last few diverse batches.

## ACTIVE — ARCHITECTURE: extraction via Agent SUBAGENTS (Claude subscription, FREE) — NOT OpenRouter, NOT claude-p (Adnan's directive).
Validated + SUPERIOR: subagent on Aristophanes Birds = 8 clean citations (vs OpenRouter Suetonius = 199 noise); Abhinavagupta poem = correct 0; Say's Treatise = 152, incl. Say→Adam-Smith ×55 stanced (endorse 13 / extend 9 / refute 17 / authority 16), + Ricardo / Turgot / Beccaria — all resolved to held authors.
Deterministic core (resolver / graph / acquisition, all TDD'd) UNCHANGED — subagents just fill `corpus/graph/raw/v2/<slug>.json`; `bun run scripts/graph/run.ts --next 0` builds. Accumulated graph: 9 works, 365 edges.

LOOP SHAPE (each tick): list next N uncached manifest works → dispatch N extraction subagents in PARALLEL (each: read work paragraphs, extract genuine citations grounded in real p-ids, write its cache file) → `run.ts --next 0` to build → review stats → repeat toward 1/4 (~460 works). Subagent extraction prompt = the "genuine citations only, exclude bare mentions" rules used above.
FIDELITY MECHANISM BUILT (6d95739a1): in-corpus edges now carry `target_passages` (two-sided). BUT the deterministic bag-of-words matcher is too weak for PARAPHRASE (Say paraphrases Smith, doesn't quote him → Say→Smith refute matched a physiocratic WoN para, not the labour-value passage). Lexical/FTS matching hits the same paraphrase wall. ACCURATE fix = SUBAGENT semantic matching (a subagent reads the citing context + the target work, finds the engaged passage) — same reason subagents beat OpenRouter on extraction. The deterministic matcher stays as a rough pre-filter.
PROGRESS: 10 works cached. Suetonius RE-CLEANED via subagent (199→29 edges); acquisition list now clean (Montesquieu/Stewart/Melon/Raynal/Condillac/Galiani + Ennius's Annals — Roman-name noise gone); ambiguity 110→29; Turgot +2. Graph: 150 in_corpus, 163 absent, 197 edges.
GELLIUS SKIPPED (too big for one worker — it's citation-DENSE, hundreds of precise work-citations, but a single worker fragments and never merges a cache).
BIG-WORK PATTERN (for Gellius / Mill's Logic / WoN later): the CONTROLLER dispatches N per-chapter-group workers that each WRITE a part file `corpus/graph/raw/v2/<slug>.partNN.json`, then a deterministic merge concatenates the parts into `<slug>.json`. Build that small infra when big works are worth grinding. For NOW grind MODERATE works only (single workers handle them fine).
DONE: semantic fidelity Say→Smith PROVEN (subagent, 16/18 accurate — both paraphrase→meaning AND verbatim-quote→source matches; corpus/graph/fidelity/say-smith.json). This is the two-sided/fidelity-check payoff. Graph now 15 works (added Marcet, Molinari, Guyot, Maine, Ovid — all genres handled correctly, incl. Ovid poetry scope = 11 clean): 666 refs, 263 in_corpus, 362 absent, 41 ambiguous, 420 edges. Acquisition roadmap now cross-corpus + ranked: Sombart 14, Physiocrats 7, Gaius's Commentarii 6, Montesquieu/Esprit-des-Lois, Sorel 5, Savigny 4, Marx-Engels Communist Manifesto 3.
RESOLVER NOTE: "Communist Manifesto" shows ABSENT though we likely hold it (MIA ingest had "Marx — only Manifesto"). Add a title/alias check so held works under variant titles resolve in-corpus.
STABILITY: system now demonstrated across smṛti / dharmaśāstra / Sāṃkhya / Śaiva / Nyāya / abolitionist / Scottish + French economics / Roman history / Greek comedy / Latin poetry / legal history / anti-socialist polemic / popular economics — all correct. The "stable for 3/4" bar is substantively met; remaining is COVERAGE (slow per-work subagent grind). At ~15/460. When Adnan returns, worth flagging: keep slow-grinding to literal 1/4, or call stability-achieved and plan the full run deliberately.
NEXT: (a) GENERALIZE the semantic fidelity pass — one subagent per (citing-work, in-corpus-target) cluster, write corpus/graph/fidelity/<pair>.json; the deterministic matcher stays as a cheap pre-filter. (b) keep grinding MODERATE works toward 1/4 (~11/460) — single workers, "do it yourself, no sub-agents". (c) strip the OpenRouter call from extract-references.ts. (d) Gellius + other BIG works later via the part-file pattern.
EXTRACTION-WORKER PROMPT must add: "Do this work YOURSELF — do not spawn or delegate to other agents."
Resolver bug to fix: common-word title collision (Say "wealth" the concept → matched the play "Aristophanes Wealth"). Add to the word-boundary matcher a guard against single common-word matches.
Only money + irreversible need Adnan (and cost is now ~0 on the subscription). Report at the 1/4 checkpoint.
Batch 1 ran Clarkson + Tarkasaṃgraha + Suetonius + Sāṃkhyakārikā + Paramārthasāra. 4/5 finished
extracting before a 20-min timeout (sequential calls too slow); caches persisted, so the rebuild
was free. Graph from the 4 cached works: 641 refs · 254 in_corpus · 273 absent · 114 ambiguous ·
345 edges (Suetonius 267, Clarkson 76, Tarkasaṃgraha 2, Sāṃkhya 0).

Findings:
- **WIN:** Clarkson → Tacitus / Demosthenes / Homer / Aristotle / Quintilian / Epictetus — real
  classical authorities, resolved to held authors. The citation graph delivers on genuine citations.
- **SCOPE DECISION (Adnan's call, blocks scaling):** on a history (Suetonius) the extractor
  over-fires — 267 "citations" that are mostly Roman people *narrated* (Augustus, Asinius Pollio…),
  not works/authors *cited*. The figure layer is bleeding into the citation layer. Likely fix:
  scope extraction to genuine work/authority citations; route bare person-mentions to the figure
  layer (Phase 3). NOT yet decided — do not narrow without Adnan.
- **THROUGHPUT (queued fix):** parallelize the per-window LLM calls (4 works = 20 min sequential).
- **RESOLUTION NOISE (queued fix):** persist the 114 ambiguous to review.json; reject anachronistic
  matches (Clarkson 1786 → Alfred Marshall 1890 false edge) using author dates.
- **GIANT WORKS:** WoN-class works ≈ 50+ windows each — cost/time outlier; needs a strategy.

NEXT ACTION (autonomous — do NOT pause for technical calls):
1. Narrow `EXTRACTION_PROMPT` to genuine citations: a WORK named, or an AUTHOR invoked as a
   source / authority / interlocutor (cites, quotes, rebuts, extends). EXCLUDE bare mentions of
   historical persons narrated about — those belong to the figure layer (Phase 3). Re-extract is
   needed (cache invalidated for this change) — but only on the batch works, and parallelized.
2. Parallelize per-window LLM calls (concurrency cap ~6) so batches don't time out.
3. Persist ambiguous + unresolved refs to `corpus/graph/review.json` (stop dropping them).
4. Reject anachronistic edges using published_year/era (citing year < target's earliest) — kills
   the Clarkson-1786 → Alfred-Marshall-1890 false edge.
5. Defer giant works (> ~25 windows, e.g. WoN) to a later pass; log them, don't let them dominate.
Then resume ~15–20-work diverse batches toward the 1/4 mark. Report SPEND + a quality read at the
1/4 checkpoint (the only planned stop).
