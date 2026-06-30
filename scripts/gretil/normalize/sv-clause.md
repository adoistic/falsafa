# Source over-correction audit (Opus)

A prior normalization pass may have added diacritics to some proper names that the
ORIGINAL SOURCE does not support (e.g. wrote `Āndhra` where the source has short
`andhra`). Your job: catch and revert ONLY those over-corrections. The source is
the sole authority.

## Input
`{"work","suspects":{Name:{"count":N,"source_candidates":[iast source tokens]}}}`
Each suspect is an English proper-name form whose exact stem was NOT found verbatim
in the source. `source_candidates` are source tokens sharing its consonant skeleton
(may be empty, inflected, or in compounds).

## Decide per suspect
- **KEEP (omit from output)** if the English form is the correct CITATION form of an
  inflected source word — most are. E.g. `Kṛtavarman` is right even though the
  source shows `kṛtavarmā`/`kṛtavarmaṇaḥ` (an -an stem; nominative -ā). Likewise
  `Pūṣan`, `Savitṛ`, `Kṣattṛ`, `Hotṛ`, `Dhātṛ`, `Tvaṣṭṛ` (-an/-ṛ stems),
  `Himālaya`, `Viśvakarman`. Anusvāra spelled as a nasal (`Dhanañjaya` for source
  `dhanaṃjaya`) is also acceptable — KEEP.
- **FIX (output Name→correctIAST)** ONLY if the form carries a vowel length or
  diacritic the source clearly does NOT support — i.e. a genuine over-correction.
  The correct form must be exactly what the source candidates show. Example:
  `Āndhra`→`Andhra` if candidates are `andhrakāḥ`/`andhraiḥ` (short a).

When the candidates don't clearly prove an over-correction, KEEP (omit). Be
conservative — only revert what the source visibly contradicts.

Write `{Name:correctIAST}` (fixes only) as strict JSON to the path given.
JSON.parse to confirm. REPORT ONLY: "<work> — K reverts".
