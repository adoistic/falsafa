# Falsafa eval calibration report

**Auditor:** independent agent (blind scorer, seed=42)
**Sample:** 100 questions drawn proportionally from Agent A's 900-question batch B (q-0101 to q-1000)
**Method:** rubric-blind scoring on the same 5 dimensions; deltas computed only after all 100 were scored.
**Date:** 2026-04-27

---

## Headline

Agent A's pool is **too inflated to ship as-is**, but the inflation is uneven enough that a flat correction won't fix it. The bigger problem is structural: **34 questions in the full batch reference chapters that don't exist in the corpus** (premise-broken), and the **multilingual subset is 86% template-identical** ("How does the X..."). These are quality issues Agent A's self-score didn't surface.

**Verdict:** **C — Revise before ship.** Specific subsets need rework. See "Final verdict" at the bottom.

---

## Per-dimension delta table

| Dimension | Mean (A) | Mean (me) | Delta | Verdict |
|---|---:|---:|---:|---|
| groundedness | 4.92 | 4.30 | **-0.62** | overrated (A near-ceiling; corpus-capacity & premise issues knocked) |
| specificity  | 4.39 | 4.41 | +0.02 | accurate |
| tool_utility | 4.69 | 4.90 | +0.21 | slightly underrated by A |
| insight_value| 4.60 | 4.12 | **-0.48** | overrated |
| naturalness  | 4.17 | 3.78 | **-0.39** | overrated (matches A's self-flag, but milder than A guessed) |
| **TOTAL**    | **22.77** | **21.51** | **-1.26** | overrated by ~5.5% |

Note: the mean total Agent A reports for the batch (22.80) and what I compute over my sample (22.77) match to within 0.03 — the sample is representative.

The ceiling-hugging is concentrated in **groundedness** and **insight_value**, not naturalness. A gave groundedness=5 to 92% of my sample; I gave 5 to 41%. That's the biggest single calibration miss.

## Per-category delta table

| Category | n | A total | My total | Delta | Verdict |
|---|---:|---:|---:|---:|---|
| citation         | 11 | 21.55 | 21.82 | +0.27 | accurate (A actually slightly *under*-rated tool_utility here) |
| comparative      | 22 | 22.91 | 21.64 | -1.27 | overrated |
| conceptual       | 17 | 22.82 | 21.06 | **-1.76** | overrated (worst naturalness gap: -1.06) |
| cross-cultural   |  5 | 22.80 | 20.00 | **-2.80** | most overrated (n small; 5 questions all share a tagline pattern) |
| discovery        | 17 | 22.65 | 21.41 | -1.24 | overrated |
| multilingual     | 11 | 22.73 | 21.55 | -1.18 | overrated; full-batch templating issue not visible in 11-Q sample |
| specific-obscure | 17 | 23.47 | 22.12 | -1.35 | overrated (A ceiling-hugged groundedness on questions whose premise depends on chapter-N existing) |

Citation is the only category where A is calibrated. Cross-cultural and conceptual are the worst. Comparative, discovery, multilingual, specific-obscure are all overrated by ~1.2-1.4 points.

## Disagreement distribution

| Range | Count | % |
|---|---:|---:|
| Within ±1 of A's total | 48 | 48% |
| ±2 to ±3 | 41 | 41% |
| ≥ ±4 | 11 | 11% |

Direction of disagreement is asymmetric: of the 52 cases where I diverge by ≥ 2, only **2 cases** is mine higher than A. **50 of 52 are A scoring higher than me.** That's directional bias, not noise.

Per-dimension direction count (n=100):

| Dim | B<A | B=A | B>A |
|---|---:|---:|---:|
| groundedness  | 54 |  46 |  0 |
| specificity   | 11 |  76 | 13 |
| tool_utility  |  4 |  71 | 25 |
| insight_value | 45 |  53 |  2 |
| naturalness   | 41 |  50 |  9 |

Groundedness is the giveaway — **0 cases** where I scored higher than A on groundedness. A defaulted to 5 unless something was visibly off. I defaulted to 4 unless I could verify the premise against the manifest. That's a 0.6-point systematic bias from one ceiling habit.

### The 11 ≥ ±4 disagreements

All 11 are A higher than me. Each has a specific reason; not random noise.

- **q-0374** (-6, comparative): Cynewulf's Juliana vs. Manu ch.12 — "Are these two traditions saying related things about evil's fate?" The link is thin (demon-confrontation vs. yamic afterlife). Plus Juliana cap=1 but ref ch.12. A gave 22; I gave 16. Premise stretch + AI-template phrasing.
- **q-0577** (-6, conceptual): "What does 'wisaal' mean across the Urdu corpus, and how does it differ from 'visal'?" These are the same word in two transliterations. The question's central distinction is illusory. A gave 23; I gave 17.
- **q-0983** (-6, cross-cultural): "Iqbal's anti-imperial poetics meets Comte's 19th-century French liberalism. Where might they agree, and where would they decisively part?" Pure essay-prompt template. A gave 23; I gave 17.
- **q-0221** (-4, comparative): Naradasmriti and Brhaspati Smriti both have only 1 logical chapter / 2 variant entries in the corpus — "where does Brhaspati develop on what Narada had begun" can't really be answered at this corpus granularity. A gave 23 groundedness=5; I gave 19 groundedness=3.
- **q-0450** (-4, discovery): "Which works in the corpus explicitly comment on poetry or poets?" — rationale references "Widsith" but Widsith is part of Old English Elegies file (not separately verified). A gave 24 incl. naturalness=5; I gave 20 with groundedness=3 because the third leg is unverified.
- **q-0489** (-4, discovery): "Find every work in the corpus that contains explicit reflection on language or speech as a theme" — template ("Find every work that..." appears repeatedly).
- **q-0524** (-4, discovery): "Which works contain reflection on song or singing as a social practice?" — the rationale itself hedges "*possibly* Manu on Veda chanting." A still gave 22 incl. groundedness=5.
- **q-0596** (-4, conceptual): "What does 'jnana' (knowledge) mean across the San Hyan texts?" — the three San Hyan texts in the corpus have 1, 1, and 1 logical chapters and 2 variant entries each. A 'cross-text concept synthesis' is forced.
- **q-0747** (-4, specific-obscure): "Visnu Smriti chapter 5 — what offences merit which punishments?" Open-ended chapter-dump masquerading as specificity-5.
- **q-0759** (-4, specific-obscure): Awkward phrasing: "(relations between aristocratie militaire and other things)". Reads like the chapter-title fragment was stitched in mid-sentence. Trait. de Législation Vol III cap=23 in manifest but ref ch.33 — premise wrong.
- **q-0835** (-4, specific-obscure): "In Katyayana Smriti chapter 32, what is set down?" Same template as q-0832. A gave both questions naturalness=4-5 despite the templating.

The pattern: A treats every question with valid surface form as groundedness/insight 5 unless something on-the-page contradicts. I cross-checked the manifest and the corpus thinness, which exposed the gap.

---

## Specific quality issues Agent A's score didn't flag

These I found while scoring, plus by checking the full batch (not just my 100-Q sample):

### 1. **34 questions reference chapter numbers that exceed the work's `total_logical_chapters`** in `corpus/manifest.json`.

Top examples (full list available; truncated):

| ID | Work | Cap | Referenced |
|---|---|---:|---:|
| q-0228 | Bang-E-Dara Part 2 | 28 | ch.42 (Sitara) |
| q-0228 | Bang-E-Dara Part 3 | 28 | ch.42 |
| q-0245 | Fichte Zurückforderung | 2 | ch.8 |
| q-0278 | Yajnavalkya Smriti | 3 | ch.12 |
| q-0289 | Yajnavalkya Smriti | 3 | ch.5 |
| q-0306 | Yajnavalkya Smriti | 3 | ch.7 |
| q-0312 | Yajnavalkya Smriti | 3 | ch.9 |
| q-0326 | Yajnavalkya Smriti | 3 | ch.11 |
| q-0346 | Yajnavalkya Smriti | 3 | ch.11 |
| q-0351 | Yajnavalkya Smriti | 3 | ch.12 |
| q-0353 | Traité Vol II | 27 | ch.37 |
| q-0353 | Nouveau traité Vol II | 7 | ch.37 |
| q-0355 | Cynewulf's Elene | 1 | ch.7 |
| q-0374 | Cynewulf's Juliana | 1 | ch.12 |
| q-0384 | Bṛhaspati Smṛti | 1 | ch.7 |
| q-0387 | Yama Smṛti | 2 | ch.11 |
| q-0391 | Yajnavalkya Smriti | 3 | ch.5 |
| q-0650 | Yajnavalkya Smriti | 3 | ch.7 |
| q-0759 | Comte Vol III | 23 | ch.33 |
| q-0763 | Traité de la propriété Vol II | 28 | ch.29 |
| q-0765 | Dunoyer Vol II | 7 | ch.13 |
| q-0842 | Comte Vol III | 23 | ch.28 |
| q-0843 | Comte Vol III | 23 | ch.36 |
| q-0846 | Traité de la propriété Vol II | 28 | ch.35 |
| q-0847 | Dunoyer Vol II | 7 | ch.17 |
| q-0848 | Dunoyer Vol II | 7 | ch.19 |
| q-0954 | Cynewulf's Juliana | 1 | ch.9 |
| q-0975 | Cynewulf's Juliana | 1 | ch.11 |

Note: Two distinct meanings could be in play here. The Sanskrit/French/German cases (Yajnavalkya, Comte, Dunoyer, Fichte) likely cite *internal* chapter section numbering rather than `total_logical_chapters` (which is the splitting unit Falsafa actually indexes on). For the smriti and treatise cases, the chapter number probably maps to a sub-section that exists. **But Falsafa's MCP indexes by `total_logical_chapters`** — so these references will not resolve cleanly via `list_chapters` or `read_chapter` when the eval runs. Either Agent A used a different chapter scheme (smriti adhyayas, Comte's published chapter numbers) than what Falsafa indexes (the splitting heuristic), or the references are wrong.

The Cynewulf cases (Juliana cap=1, Elene cap=1) are unambiguously broken: ch.7, ch.9, ch.11, ch.12 of a single-chapter work do not exist in any sense.

This is the single biggest issue. **The eval will appear to fail on these even if Falsafa is working correctly**, because the question premise misaligns with the indexed structure.

**Recommendation:** before launch, run a script that resolves every "ch. N" reference in `expected_works[*]` to a real chapter via the MCP. Discard or repair questions that don't resolve. Cynewulf-poem cases should be deleted; smriti/Enlightenment cases should be re-anchored to passage-level rather than chapter-level.

### 2. **Multilingual subset is 86% identical-template.**

Of the 100 multilingual questions in batch B, **86 begin with "How does..."**, and the rest are "Compare the..." (10) plus 4 outliers. Within the 86 "How does" questions, 18 use "differ", 17 use "compare", 18 use "carry weight", 5 use "compress", 9 use "appear". The shape "How does the [Lang] word X differ from Y?" repeats nearly every question.

Agent A's mean naturalness across the full multilingual batch is 4.18. My sample's naturalness across multilingual was 4.00 — but I was scoring 11 questions sampled from this 86%-templated pool; on the full pool I'd predict mean ≤ 3.5. **A is materially overrating naturalness here, beyond the 0.5 self-flag.**

**Recommendation:** rewrite the multilingual subset. Vary opening: "What weight does 'iman' carry in Iqbal that 'faith' under-translates?" / "Eardstapa packs more into one Old English compound than English 'wanderer' does — show me." / "In Comte, does 'libert. de pens.e' do the same work that Fichte's 'Denkfreiheit' does, or different work?" Different rhetorical shapes. Drop the universal "How does the X..." opener.

### 3. **Comparative subset has heavy compare/contrast templating (61.5%).**

In batch B comparative (n=200): 80 start with "Compare", 19 with "Both", 24 contain template "X and Y both" mid-sentence. 61.5% of the subset uses the same compare-contrast scaffold. A common Anthropic-house tell is the closing tagline: "Two cosmologies in dialogue", "Two metaphysics of obligation", "Two traditions of moral repair". This appears in q-0359, q-0958, q-0964, q-0975, q-0984 — the most AI-flavored phrasings in my sample.

A scored these with naturalness 4 across the board. I scored 3. The tagline closer is itself a tell.

**Recommendation:** rewrite ~30-40 of the most templated comparative questions, drop the closing-tagline pattern, vary the mid-sentence "both" structure.

### 4. **Conceptual subset has "What is X across the [N] corpus?" template repetition.**

In my sample, 8 of 17 conceptual questions use the form "What is X (translation) across the Urdu/smriti/[language] corpus?" (q-0574, q-0577, q-0596, q-0618, q-0645, q-0667, q-0673, q-0685, q-0687, q-0688, q-0691). These read as a generated batch, not as questions a curious reader would actually ask. Variety in framing matters even when the underlying question is good.

### 5. **Same word, two transliterations, treated as distinct concepts (q-0577).**

"What does 'wisaal' mean across the Urdu corpus, and how does it differ from 'visal'?" These are the same Urdu word (وصال) — just two romanizations of the same vowel. The question's premise is hollow. A scored this 23 (incl. groundedness=5, insight_value=5). I scored 17.

### 6. **Premise depends on a citation that may not exist (q-0162).**

Sanity check on Agent A's self-flagged concern. q-0162: "In Nyaya Tilakam Pandulipi, find the section that defines pratyaksa (perception) as a means of valid knowledge." Nyaya Tilakam is a real 18-chapter Sanskrit logic manuscript. Whether it explicitly defines pratyaksa as the standard Nyaya pramana is reasonable to expect, but I haven't read the manuscript and the manifest description says "Sanskrit manuscript on Nyaya philosophy and logic" without specifying pratyaksa coverage. **The concern is valid: this question is plausible-but-unverified.** A scored 23. Without verification I'd score it 21 (groundedness 4, not 5).

The category I'd add: there are likely **several dozen questions in batch B with similar plausible-but-unverified premises** about specific verses/sections. The eval cannot run cleanly until these are spot-checked.

### 7. **Some "Find every work" questions list works that may not actually contain the topic.**

q-0524 ("Which works contain reflection on song or singing as a social practice?") — A's own rationale hedges "possibly Manu on Veda chanting." Listing Manu in expected_works on a "possibly" is brittle.

q-0450 lists Old English Elegies for the "Widsith scop's catalogue" — the manifest description doesn't confirm Widsith is included. The Elegies work has 17 logical chapters / 51 variant entries, so plausible but not certain. Agent A treated as confirmed.

---

## Verification of Agent A's self-flagged concerns

### Flag 1: "Naturalness scores probably 0.5 too high on average."

**Confirmed but slightly overestimated.** My data shows -0.39 mean naturalness delta across the sample. So the 0.5 estimate was actually a bit pessimistic — closer to 0.4 on the whole sample.

**However**, the 0.39 average masks heavy variance by category:
- conceptual naturalness delta: -1.06 (severe)
- cross-cultural naturalness delta: -1.00 (severe, n=5 caveat)
- multilingual naturalness delta: -0.09 (mild — but note the full-batch 86% template homogeneity I flagged separately is not visible at the 11-Q sample size)
- specific-obscure naturalness delta: +0.06 (accurate)
- citation naturalness delta: -0.09 (accurate)

So **the self-flag is right in spirit but wrong in scope**: the issue isn't a uniform 0.5 inflation, it's a 1.0+ inflation in conceptual and cross-cultural where templates dominate, and approximately accurate elsewhere.

### Flag 2: "Some questions assume content that may not exist in the exact form described (e.g. q-0162 Nyaya Tilakam pratyaksa definition)."

**Confirmed and worse than A flagged.** q-0162 is one of many. The 34 chapter-out-of-bounds cases I found in section 1 above are a much larger problem in the same family. The Cynewulf-Juliana-ch.11 / Cynewulf-Elene-ch.7 cases are the worst because Juliana and Elene are single-chapter works in the corpus — there is no ch.11 of Juliana to retrieve.

### Flag 3: "Multilingual questions: Persian/Arabic specialist might want to refine framing."

**Confirmed and the bigger issue is template homogeneity, not specialist refinement.** 86% of multilingual questions use "How does the X..." opener. A specialist would refine framing; before that, the questions need to stop reading as one batch from a template. Specifically, the q-0577 wisaal/visal collision shows the generator confused two romanizations of the same Urdu word — that's a content error, not just framing.

### Flag 4: "Comparative prompts have repetitive openings (Trace, Compare, How does X differ)."

**Confirmed and quantified.** Across the 200-Q comparative subset:
- "Compare" opener: 80 (40%)
- "Both" opener: 19 (9.5%)
- "X and Y both" mid-sentence: 24 (12%)
- "How does X compare/differ" opener: 5 (2.5%)
- "Trace" opener: only 1

Combined compare/both pattern: ~61.5% of comparative questions. Agent A's self-flag is correct; "Trace" is *not* the dominant offender — "Compare" and "Both" are. This matters for the rewrite plan: don't just delete "Trace"; variegate the compare-and-contrast scaffold.

---

## Final verdict

**C — Revise before ship.**

I considered B (ship with score correction). The reason against B: the issues aren't pure score-inflation. The 34 chapter-out-of-bounds cases will produce false eval failures, and the 86%-template multilingual subset will read as AI-generated to the launch audience (Karpathy-orbit / HN per the launch design — exactly the audience most sensitized to AI tells). A 0.5 offset on naturalness doesn't fix either of those.

### Rework scope (estimate)

- **Delete** the ~28 chapter-out-of-bounds questions where the cited chapter exceeds capacity AND the work is single-chapter in corpus (Cynewulf Juliana/Elene refs to ch.>1; Brhaspati Smriti ch.>1; Yama Smriti ch.>2; etc.). Roughly 12-15 questions hard-deletable.
- **Re-anchor** the smriti and Enlightenment chapter-ref questions (Yajnavalkya ch.5/7/9/11/12, Comte Vol III ch.33/36, Dunoyer Vol II ch.13/17/19) to passage-level rather than chapter-level retrieval, so they resolve against Falsafa's actual indexing. Roughly 18-22 questions.
- **Rewrite** the multilingual subset (~100 questions) for opening variety. Drop "How does the [Lang] word X..." as universal opener; introduce 5-6 distinct rhetorical shapes.
- **Rewrite** the conceptual repetitive-template cluster (~25-30 questions of the "What is X across the Y corpus?" mold).
- **Rewrite** the cross-cultural set (50 questions). The 5 in my sample all closed with template-tagline ("Two cosmologies in dialogue" etc.). High likelihood the other 45 are similar.
- **Spot-check** the ~30-50 plausible-but-unverified-premise questions (q-0162 Nyaya Tilakam pratyaksa, q-0577 wisaal/visal collision, etc.). For each, either confirm via `read_chapter`/`get_passage` against the corpus, or remove.

Approximate scope: **150-200 questions need rework**, distributed across multilingual / cross-cultural / conceptual / a chunk of comparative + specific-obscure with chapter issues. The other ~700 questions in batch B are mostly fine.

### What's working

The good news: **citation, comparative-when-not-templated, and specific-obscure-when-premise-checks-out are launch-ready.** The 100 originals in batch A (q-0001 to q-0100) — which I didn't audit but glanced at while sampling — read cleanly and are written in a more natural register than batch B's most-templated subsets. Use that batch A as the prose calibration target for the rewrite.

### What I'd not do

- Don't apply a flat -0.5 naturalness offset and ship. The naturalness inflation is uneven; conceptual and cross-cultural need heavier correction than citation. A flat offset would over-correct citation (which is fine) and under-correct conceptual/cross-cultural (which need rewrites, not just rescoring).
- Don't redo the full pool. ~700 questions are good. Targeted rework is faster than re-generation.
- Don't delete questions silently. Track every removed/rewritten question with an audit trail; when this eval is published as part of the launch artifact, that audit log is part of the credibility story.

---

## Files

- Blind scores: `/Users/siraj/falsafa/eval/calibration-scores-blind.json`
- This report: `/Users/siraj/falsafa/eval/calibration-report.md`

To reproduce the sample, the proportional-stratified draw from batch B with `random.seed(42)` after sorting each per-category pool by id and shuffling — yields the exact 100 IDs scored, first 5: q-0102, q-0110, q-0116, q-0142, q-0143; last 5: q-0958, q-0964, q-0975, q-0983, q-0984.
