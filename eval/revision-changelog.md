# Falsafa eval pool — revision changelog

**Revisions applied:** 226  
**Drop+replaced:** 9  
**Left untouched:** 774  
**Output:** `eval/questions-revised-1000.json` (the original `eval/questions-draft-1000.json` is untouched)

---

## Per-category summary

| Category | Total | Revised (prompt) | Dropped + replaced | Left alone |
|---|---:|---:|---:|---:|
| citation | 200 | 1 | 0 | 199 |
| comparative | 200 | 93 | 1 | 106 |
| conceptual | 150 | 0 | 2 | 148 |
| cross-cultural | 50 | 45 | 5 | 0 |
| discovery | 150 | 3 | 0 | 147 |
| multilingual | 100 | 65 | 0 | 35 |
| specific-obscure | 150 | 10 | 1 | 139 |
| **TOTAL** | 1000 | 217 | 9 | 774 |

Note: 'Drop+replaced' means the prompt was discarded entirely and replaced with a new question on the same category and (where relevant) the same expected_works pair. The question ID is preserved so total count stays at 1000 with no ID gaps.

---

## Manifest verification

**PASS** — every chapter reference in the revised pool resolves within `total_logical_chapters` for the referenced work; every `expected_works` slug exists in the manifest.

---

## Class breakdown

- **Class 1 — Chapter-out-of-bounds (referenced chapter > work's total_logical_chapters)**: 10 revisions
- **Class 2 — Multilingual templating (universal 'How does the X...' opener)**: 65 revisions
- **Class 3 — Comparative templating (Compare/Both opener and tagline closers)**: 90 revisions
- **Class 4 — Specific premise issues flagged in calibration report**: 11 revisions
- **Class 5 — Cross-cultural subset (50 questions, all overrated by ~2.8)**: 50 revisions

---

## Per-question detail

Each entry below: question ID, classification, original issue, and a short note on the fix. The full revised prompt is in `eval/questions-revised-1000.json`.

### Class 1 — Chapter-out-of-bounds (referenced chapter > work's total_logical_chapters)

- **q-0228** (comparative, revise prompt) — Refs to Part 1 ch.42 (cap=44 ok) and Part 2 ch.42 (cap=28, broken).
- **q-0353** (comparative, revise prompt) — Cited Comte Vol II ch.37 doesn't exist (cap=27).
- **q-0759** (specific-obscure, revise prompt) — Comte Vol III ch.33 doesn't exist (cap=23). Original phrasing was also awkward.
- **q-0763** (specific-obscure, revise prompt) — Traité de la propriété Vol II ch.29 doesn't exist (cap=28).
- **q-0765** (specific-obscure, revise prompt) — Dunoyer Vol II ch.13 doesn't exist (cap=7). Reframe to topical retrieval.
- **q-0842** (specific-obscure, DROP+REPLACE) — Comte Vol III ch.28 doesn't exist (cap=23). Drop+replace with a question that anchors topically inside Vol III.
- **q-0843** (specific-obscure, revise prompt) — Comte Vol III ch.36 doesn't exist (cap=23). Reframe topically.
- **q-0846** (specific-obscure, revise prompt) — Vol II ch.35 doesn't exist (cap=28). Reframe topically.
- **q-0847** (specific-obscure, revise prompt) — Dunoyer Vol II ch.17 doesn't exist (cap=7). Reframe topically.
- **q-0848** (specific-obscure, revise prompt) — Dunoyer Vol II ch.19 doesn't exist (cap=7). Reframe topically.

### Class 2 — Multilingual templating (universal 'How does the X...' opener)

- **q-0851** (multilingual, revise prompt) — (template variation)
- **q-0852** (multilingual, revise prompt) — (template variation)
- **q-0853** (multilingual, revise prompt) — (template variation)
- **q-0854** (multilingual, revise prompt) — (template variation)
- **q-0855** (multilingual, revise prompt) — (template variation)
- **q-0856** (multilingual, revise prompt) — (template variation)
- **q-0857** (multilingual, revise prompt) — (template variation)
- **q-0858** (multilingual, revise prompt) — (template variation)
- **q-0859** (multilingual, revise prompt) — (template variation)
- **q-0860** (multilingual, revise prompt) — (template variation)
- **q-0861** (multilingual, revise prompt) — (template variation)
- **q-0862** (multilingual, revise prompt) — (template variation)
- **q-0863** (multilingual, revise prompt) — (template variation)
- **q-0864** (multilingual, revise prompt) — (template variation)
- **q-0865** (multilingual, revise prompt) — (template variation)
- **q-0866** (multilingual, revise prompt) — (template variation)
- **q-0867** (multilingual, revise prompt) — (template variation)
- **q-0868** (multilingual, revise prompt) — (template variation)
- **q-0869** (multilingual, revise prompt) — (template variation)
- **q-0870** (multilingual, revise prompt) — (template variation)
- **q-0871** (multilingual, revise prompt) — (template variation)
- **q-0872** (multilingual, revise prompt) — (template variation)
- **q-0873** (multilingual, revise prompt) — (template variation)
- **q-0874** (multilingual, revise prompt) — (template variation)
- **q-0875** (multilingual, revise prompt) — (template variation)
- **q-0876** (multilingual, revise prompt) — (template variation)
- **q-0877** (multilingual, revise prompt) — (template variation)
- **q-0878** (multilingual, revise prompt) — (template variation)
- **q-0879** (multilingual, revise prompt) — (template variation)
- **q-0880** (multilingual, revise prompt) — (template variation)
- **q-0881** (multilingual, revise prompt) — (template variation)
- **q-0882** (multilingual, revise prompt) — (template variation)
- **q-0883** (multilingual, revise prompt) — (template variation)
- **q-0884** (multilingual, revise prompt) — (template variation)
- **q-0885** (multilingual, revise prompt) — (template variation)
- **q-0886** (multilingual, revise prompt) — (template variation)
- **q-0887** (multilingual, revise prompt) — (template variation)
- **q-0888** (multilingual, revise prompt) — (template variation)
- **q-0889** (multilingual, revise prompt) — (template variation)
- **q-0890** (multilingual, revise prompt) — (template variation)
- **q-0891** (multilingual, revise prompt) — (template variation)
- **q-0892** (multilingual, revise prompt) — (template variation)
- **q-0893** (multilingual, revise prompt) — (template variation)
- **q-0894** (multilingual, revise prompt) — (template variation)
- **q-0895** (multilingual, revise prompt) — (template variation)
- **q-0896** (multilingual, revise prompt) — (template variation)
- **q-0897** (multilingual, revise prompt) — (template variation)
- **q-0898** (multilingual, revise prompt) — (template variation)
- **q-0899** (multilingual, revise prompt) — (template variation)
- **q-0900** (multilingual, revise prompt) — (template variation)
- **q-0901** (multilingual, revise prompt) — (template variation)
- **q-0902** (multilingual, revise prompt) — (template variation)
- **q-0903** (multilingual, revise prompt) — (template variation)
- **q-0904** (multilingual, revise prompt) — (template variation)
- **q-0905** (multilingual, revise prompt) — (template variation)
- **q-0906** (multilingual, revise prompt) — (template variation)
- **q-0907** (multilingual, revise prompt) — (template variation)
- **q-0908** (multilingual, revise prompt) — (template variation)
- **q-0909** (multilingual, revise prompt) — (template variation)
- **q-0910** (multilingual, revise prompt) — (template variation)
- **q-0911** (multilingual, revise prompt) — (template variation)
- **q-0912** (multilingual, revise prompt) — (template variation)
- **q-0913** (multilingual, revise prompt) — (template variation)
- **q-0914** (multilingual, revise prompt) — (template variation)
- **q-0915** (multilingual, revise prompt) — (template variation)

### Class 3 — Comparative templating (Compare/Both opener and tagline closers)

- **q-0203** (comparative, revise prompt) — (template variation)
- **q-0206** (comparative, revise prompt) — (template variation)
- **q-0207** (comparative, revise prompt) — (template variation)
- **q-0212** (comparative, revise prompt) — (template variation)
- **q-0217** (comparative, revise prompt) — (template variation)
- **q-0220** (comparative, revise prompt) — (template variation)
- **q-0224** (comparative, revise prompt) — (template variation)
- **q-0226** (comparative, revise prompt) — (template variation)
- **q-0230** (comparative, revise prompt) — (template variation)
- **q-0231** (comparative, revise prompt) — (template variation)
- **q-0233** (comparative, revise prompt) — (template variation)
- **q-0234** (comparative, revise prompt) — (template variation)
- **q-0235** (comparative, revise prompt) — (template variation)
- **q-0239** (comparative, revise prompt) — (template variation)
- **q-0243** (comparative, revise prompt) — (template variation)
- **q-0247** (comparative, revise prompt) — (template variation)
- **q-0249** (comparative, revise prompt) — (template variation)
- **q-0250** (comparative, revise prompt) — (template variation)
- **q-0253** (comparative, revise prompt) — (template variation)
- **q-0256** (comparative, revise prompt) — (template variation)
- **q-0258** (comparative, revise prompt) — (template variation)
- **q-0260** (comparative, revise prompt) — (template variation)
- **q-0264** (comparative, revise prompt) — (template variation)
- **q-0267** (comparative, revise prompt) — (template variation)
- **q-0268** (comparative, revise prompt) — (template variation)
- **q-0272** (comparative, revise prompt) — (template variation)
- **q-0275** (comparative, revise prompt) — (template variation)
- **q-0280** (comparative, revise prompt) — (template variation)
- **q-0281** (comparative, revise prompt) — (template variation)
- **q-0286** (comparative, revise prompt) — (template variation)
- **q-0288** (comparative, revise prompt) — (template variation)
- **q-0290** (comparative, revise prompt) — (template variation)
- **q-0291** (comparative, revise prompt) — (template variation)
- **q-0294** (comparative, revise prompt) — (template variation)
- **q-0295** (comparative, revise prompt) — (template variation)
- **q-0300** (comparative, revise prompt) — (template variation)
- **q-0301** (comparative, revise prompt) — (template variation)
- **q-0304** (comparative, revise prompt) — (template variation)
- **q-0308** (comparative, revise prompt) — (template variation)
- **q-0309** (comparative, revise prompt) — (template variation)
- **q-0310** (comparative, revise prompt) — (template variation)
- **q-0311** (comparative, revise prompt) — (template variation)
- **q-0313** (comparative, revise prompt) — (template variation)
- **q-0316** (comparative, revise prompt) — (template variation)
- **q-0317** (comparative, revise prompt) — (template variation)
- **q-0319** (comparative, revise prompt) — (template variation)
- **q-0320** (comparative, revise prompt) — (template variation)
- **q-0322** (comparative, revise prompt) — (template variation)
- **q-0323** (comparative, revise prompt) — (template variation)
- **q-0324** (comparative, revise prompt) — (template variation)
- **q-0327** (comparative, revise prompt) — (template variation)
- **q-0328** (comparative, revise prompt) — (template variation)
- **q-0329** (comparative, revise prompt) — (template variation)
- **q-0330** (comparative, revise prompt) — (template variation)
- **q-0332** (comparative, revise prompt) — (template variation)
- **q-0333** (comparative, revise prompt) — (template variation)
- **q-0336** (comparative, revise prompt) — (template variation)
- **q-0339** (comparative, revise prompt) — (template variation)
- **q-0340** (comparative, revise prompt) — (template variation)
- **q-0342** (comparative, revise prompt) — (template variation)
- **q-0343** (comparative, revise prompt) — (template variation)
- **q-0348** (comparative, revise prompt) — (template variation)
- **q-0349** (comparative, revise prompt) — (template variation)
- **q-0350** (comparative, revise prompt) — (template variation)
- **q-0352** (comparative, revise prompt) — (template variation)
- **q-0354** (comparative, revise prompt) — (template variation)
- **q-0355** (comparative, revise prompt) — (template variation)
- **q-0356** (comparative, revise prompt) — (template variation)
- **q-0358** (comparative, revise prompt) — (template variation)
- **q-0359** (comparative, revise prompt) — Comparative with tagline closer.
- **q-0361** (comparative, revise prompt) — (template variation)
- **q-0363** (comparative, revise prompt) — (template variation)
- **q-0366** (comparative, revise prompt) — (template variation)
- **q-0367** (comparative, revise prompt) — (template variation)
- **q-0368** (comparative, revise prompt) — (template variation)
- **q-0370** (comparative, revise prompt) — (template variation)
- **q-0371** (comparative, revise prompt) — (template variation)
- **q-0373** (comparative, revise prompt) — (template variation)
- **q-0375** (comparative, revise prompt) — (template variation)
- **q-0377** (comparative, revise prompt) — (template variation)
- **q-0378** (comparative, revise prompt) — (template variation)
- **q-0380** (comparative, revise prompt) — (template variation)
- **q-0381** (comparative, revise prompt) — (template variation)
- **q-0389** (comparative, revise prompt) — (template variation)
- **q-0393** (comparative, revise prompt) — (template variation)
- **q-0395** (comparative, revise prompt) — (template variation)
- **q-0396** (comparative, revise prompt) — (template variation)
- **q-0398** (comparative, revise prompt) — (template variation)
- **q-0399** (comparative, revise prompt) — (template variation)
- **q-0400** (comparative, revise prompt) — (template variation)

### Class 4 — Specific premise issues flagged in calibration report

- **q-0162** (citation, revise prompt) — Plausible but unverified premise; soften so the question still scores cleanly if pratyaksa happens not to be defined explicitly.
- **q-0221** (comparative, revise prompt) — Naradasmrti and Brhaspatismrti both have only 1 logical chapter; developmental tracking is hard at this granularity.
- **q-0374** (comparative, DROP+REPLACE) — Thin cross-tradition link (demon-confrontation vs yamic afterlife) plus formulaic phrasing. Dropped, replaced with a sharper question on the same texts.
- **q-0450** (discovery, revise prompt) — Rationale named 'Widsith' inside Old English Elegies; manifest doesn't confirm Widsith specifically. Tighten.
- **q-0489** (discovery, revise prompt) — Template phrasing; rephrase.
- **q-0524** (discovery, revise prompt) — Rationale hedged with 'possibly Manu on Veda chanting'; either commit or drop.
- **q-0577** (conceptual, DROP+REPLACE) — wisaal and visal are the same Urdu word in two transliterations. Drop the false distinction; replace with a real semantic question.
- **q-0596** (conceptual, DROP+REPLACE) — Three San Hyan texts each have only 1 logical chapter; cross-text concept synthesis is forced at this granularity.
- **q-0747** (specific-obscure, revise prompt) — Open-ended chapter dump masquerading as specificity. Narrow.
- **q-0832** (specific-obscure, revise prompt) — Template phrasing 'what topic?' is too generic.
- **q-0835** (specific-obscure, revise prompt) — Template phrasing.

### Class 5 — Cross-cultural subset (50 questions, all overrated by ~2.8)

- **q-0951** (cross-cultural, revise prompt) — Template 'How does X compare to Y' opener.
- **q-0952** (cross-cultural, revise prompt) — Generic 'can the two be reconciled' framing.
- **q-0953** (cross-cultural, revise prompt) — Compare X with Y opener; heavy.
- **q-0954** (cross-cultural, revise prompt) — Cross-cultural; tagline closer 'Two cultures, opposing positions...' is a tell. Sharpen the framing.
- **q-0955** (cross-cultural, revise prompt) — Compare X with Y opener.
- **q-0956** (cross-cultural, revise prompt) — Three-tradition compare with template framing.
- **q-0957** (cross-cultural, revise prompt) — Compare X with Y opener; tagline closer.
- **q-0958** (cross-cultural, revise prompt) — Compare X with Y; the pairing is reasonable but framing is generic.
- **q-0959** (cross-cultural, revise prompt) — How does X compare opener; tagline closer.
- **q-0960** (cross-cultural, revise prompt) — Tagline closer 'Two political-theological positions.'
- **q-0961** (cross-cultural, revise prompt) — Compare X with Y opener.
- **q-0962** (cross-cultural, revise prompt) — Compare X with Y mid-prompt.
- **q-0963** (cross-cultural, revise prompt) — Compare X with Y mid-prompt.
- **q-0964** (cross-cultural, revise prompt) — Tagline closer 'Two cosmologies in dialogue.'
- **q-0965** (cross-cultural, revise prompt) — Compare X with Y opener; tagline closer.
- **q-0966** (cross-cultural, revise prompt) — Imperative 'Stage the encounter' is OK but framing is generic.
- **q-0967** (cross-cultural, revise prompt) — Compare X with Y; tagline closer.
- **q-0968** (cross-cultural, revise prompt) — How does X compare opener; tagline closer.
- **q-0969** (cross-cultural, revise prompt) — Imperative + 'Are these traditions...' template.
- **q-0970** (cross-cultural, DROP+REPLACE) — Compare X with Y; tagline closer; the 'liturgical year implicit in Cynewulf' is also vague.
- **q-0971** (cross-cultural, revise prompt) — Tagline closer; Widsith reference inside Elegies is plausible but framing is generic.
- **q-0972** (cross-cultural, revise prompt) — Compare X with Y; tagline closer.
- **q-0973** (cross-cultural, revise prompt) — Tagline closer.
- **q-0974** (cross-cultural, revise prompt) — Generic compare.
- **q-0975** (cross-cultural, revise prompt) — Cross-cultural with tagline closer. Sharpen on a specific affordance of penance in each.
- **q-0976** (cross-cultural, revise prompt) — Compare X with Y opener.
- **q-0977** (cross-cultural, revise prompt) — How does X compare; tagline closer.
- **q-0978** (cross-cultural, revise prompt) — Imperative + generic 'Both convert a recalcitrant...'
- **q-0979** (cross-cultural, revise prompt) — How does X compare; tagline closer.
- **q-0980** (cross-cultural, revise prompt) — Compare X with Y; generic 'Both appeal...'
- **q-0981** (cross-cultural, revise prompt) — Cross-cultural; reasonable pairing but generic phrasing. Sharpen to a specific gnomic move.
- **q-0982** (cross-cultural, revise prompt) — Cross-cultural; tagline 'Two traditions, sharply opposed.' is a tell.
- **q-0983** (cross-cultural, DROP+REPLACE) — Pure essay-prompt template; the pairing is also thin.
- **q-0984** (cross-cultural, DROP+REPLACE) — Vague pairing ('implicit medieval-Christian routine in Cynewulf') plus tagline closer.
- **q-0985** (cross-cultural, revise prompt) — Imperative + generic.
- **q-0986** (cross-cultural, revise prompt) — How does X compare; tagline closer.
- **q-0987** (cross-cultural, revise prompt) — Cross-cultural with tagline closer.
- **q-0988** (cross-cultural, revise prompt) — How does X compare; binary closer.
- **q-0989** (cross-cultural, revise prompt) — Imperative + tagline closer.
- **q-0990** (cross-cultural, revise prompt) — Compare X with Y; tagline closer.
- **q-0991** (cross-cultural, revise prompt) — Compare X with Y; sati pairing is risky and the framing is generic.
- **q-0992** (cross-cultural, revise prompt) — How does X sit beside Y; tagline closer.
- **q-0993** (cross-cultural, DROP+REPLACE) — Compare X with Y; tagline closer; the 'Manu near-silence' premise asserts an absence.
- **q-0994** (cross-cultural, revise prompt) — Imperative + tagline closer.
- **q-0995** (cross-cultural, revise prompt) — How does X compare; tagline closer.
- **q-0996** (cross-cultural, DROP+REPLACE) — Substantial overlap with q-0955; differentiate.
- **q-0997** (cross-cultural, revise prompt) — How does X compare; tagline closer.
- **q-0998** (cross-cultural, revise prompt) — Cross-cultural with tagline closer; the pairing is interesting but framing is generic.
- **q-0999** (cross-cultural, revise prompt) — Imperative + sweeping framing.
- **q-1000** (cross-cultural, revise prompt) — Compare X with Y; long tagline closer.

---

## Notes on what was NOT done

- The 100 originals (q-0001 through q-0100, batch A) were not revised. They were not in the audit's flagged set and the calibration report explicitly noted them as the prose-calibration target.
- Discovery (150 questions) was largely left alone except q-0450 / q-0489 / q-0524 (premise-tightening). The discovery set's `Find every work...` template recurs but the calibration report did not flag it as urgent; this revision pass prioritised the structural problems.
- A handful of questions the analyzer flagged as chapter-out-of-bounds turned out to be false positives — the chapter number always belonged to the other (validly-referenced) work in the prompt, not to the work whose cap looked low. Examples: q-0229, q-0245, q-0278, q-0289, q-0306, q-0312, q-0326, q-0346, q-0351, q-0355, q-0384, q-0387, q-0391, q-0650. None of these were revised; the analyzer's heuristic was too eager about associating a chapter ref with every work in `expected_works`.
- The conceptual subset's `What is X across the [N] corpus?` template (named in the report's section 4) is ~10 questions; the most distinctive issues there (q-0577 wisaal/visal collision, q-0596 forced San Hyan synthesis) were addressed via Class 4 drop+replace. The remaining conceptual questions in the cluster are template-shaped but each picks out a real cross-poet trope, so they were left.

---

## Honest verdict

**Ship as launch eval pool — with caveats.**

What this revision pass fixed:
- Every chapter-out-of-bounds case is either re-anchored to a topic-level retrieval or replaced. The MCP will not throw 'chapter not found' on the revised pool.
- The multilingual subset now has 65 of 100 questions with varied opening structures, breaking the universal 'How does the X...' template that would have read as AI-generated to a launch audience.
- The comparative subset has 90 of 200 questions rewritten away from the Compare/Both opener and tagline closer ('Two X in dialogue.') that the calibration report flagged as the most AI-flavored phrasings.
- The cross-cultural set (50/50) is fully reworked: tagline closers eliminated, generic 'Both posit X' framings replaced with concrete is-this-recoverable / who-pays-the-price / would-it-survive-translation questions that force the system to do real interpretive work.
- The specifically-flagged content errors (q-0577 wisaal/visal, q-0596 San Hyan, q-0162 unverified Nyaya pratyaksa) are corrected by drop+replace or premise-softening.

What this revision pass did not fix:
- The conceptual subset's `What is X across the Y corpus?` template still occurs in ~7 questions (the ones whose underlying cross-poet topos is real and worth keeping). A future pass could vary their openings without changing their substance.
- The discovery subset's `Find every work...` template was reduced from 3 to 1 instance via Class 4 fixes, but a few discovery questions still use it. The format is fine for genuine corpus-discovery questions; only the templated ones with brittle premises were rewritten.
- 700+ unflagged questions in batch B were left alone. The calibration report's correction is that batch B is overrated by ~1.26 points on average, with most of that concentrated in the categories that were specifically rewritten in this pass.

Reasons to ship the revised pool:
1. The structural failures (false eval failures from broken chapter refs) are eliminated.
2. The two AI-tell concentrations (multilingual templating, cross-cultural taglines) are broken up.
3. The remaining naturalness inflation is even-textured (~0.4 across most categories), which any reasonable rescore on launch night can cleanly absorb.

Reasons to be aware:
- Some revised questions move from a chapter-anchored retrieval to a topic-anchored retrieval. That makes the eval slightly less mechanical to grade and slightly more interesting, but it does mean a few questions now require the grader to do interpretive work the original chapter ref would have shortcutted.
- Several Class 5 cross-cultural rewrites add a comparative judgment ('which would survive translation', 'who pays the higher price'). These are deliberately added to break the symmetric-compare template, but they raise the difficulty of automated grading. Worth knowing for any scoring rubric.
