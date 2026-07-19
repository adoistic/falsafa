# Straggler unification filter (Opus)

Input: /Users/siraj/falsafa/scripts/gretil/normalize/straggler-candidates.json —
`{work: {StragglerForm: [AttestedSibling, count]}}`. Each StragglerForm is a
capitalized token NOT attested in that work's source; AttestedSibling IS attested.
A clustering heuristic guessed they are the same name — but it is NOISY.

Return ONLY the genuinely-correct unifications: `{work: {StragglerForm: Target}}`.

KEEP a unification (Straggler→Sibling) ONLY IF ALL hold:
- Both are the SAME Sanskrit/Old-Javanese proper noun, differing by a trivial
  spelling/diacritic/vowel-length slip (e.g. `VAJRA`→`Bajra` in an Old Javanese
  text whose source has `bajra`; `Vāsiṣṭha`→`Vasiṣṭha`).
- They are NOT distinct entities. REJECT masculine/feminine or god/verse pairs:
  **Savitṛ≠Sāvitrī** (sun-god vs the Sāvitrī verse/goddess), **Brahmā≠Brāhma**,
  **Nāsatya≠Nāsatyā**, **Aṅgāraka≠Aṅgārakā**, **Aparājita≠Aparājitā**, and any
  other pair whose difference is a meaningful -a/-ā/-ī gender or lexical contrast.
- Neither is an ordinary English word. REJECT She/See, White/Bite, Rich/Ric,
  Hold/Old, THAT/TATH, WHO/BHO, etc.
- The Target must be the attested sibling exactly (or, if the sibling is itself the
  wrong direction, omit).

When unsure, OMIT. Output only high-confidence same-entity unifications.
Write strict JSON to /Users/siraj/falsafa/scripts/gretil/normalize/straggler-final.json.
JSON.parse to confirm. REPORT ONLY: "straggler filter — K kept of N".
