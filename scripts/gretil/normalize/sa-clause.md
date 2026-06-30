# Source-anchored proper-name correction (Opus)

You correct the romanization of proper nouns in an English translation of a
Sanskrit/Old-Javanese text so each name matches **exactly how the ORIGINAL SOURCE
spells it**. The source is the sole authority. You must NEVER invent diacritics or
impose a spelling the source does not use.

## Input (one JSON file)
`{"work","names":{EnglishName:count},"source_tokens":{iastToken:count}}`
- `names`: capitalized tokens from the English translation (candidate proper nouns).
- `source_tokens`: the text's own transliteration tokens (IAST, inflected/sandhi'd),
  with counts. THIS IS THE AUTHORITY for correct diacritics.

## Task
For each English name, decide the correct IAST form by finding the SAME word in
`source_tokens` (allowing for inflection/sandhi — e.g. English "Krishna" matches
source `kṛṣṇaḥ`/`kṛṣṇam`/`kṛṣṇa`; the citation form is `Kṛṣṇa`). Output a JSON map
`{EnglishName: CorrectIAST}` ONLY for names whose spelling should change.

RULES:
- The CorrectIAST must use only diacritics ATTESTED in the source for that word.
  If the source writes `andhra` (short a), output `Andhra` — never `Āndhra`.
- Preserve the citation stem with the source's vowel lengths and consonants
  (ṛ ṣ ṇ ś ṭ ḍ ṅ ñ ā ī ū ṃ ḥ exactly as the source has them).
- Keep a trailing English plural `-s` (Pāṇḍavas), and possessive `'s`.
- If a name is an ordinary English word, or you cannot find it in the source, OMIT
  it (leave unchanged). Do NOT guess.
- Distinct entities (masc/fem, sage/patronymic) keep their own source spelling —
  if both the name's identities occur, map to the dominant source form and note it;
  when unsure, OMIT.

Write strict valid JSON to the path given. JSON.parse to confirm.
REPORT ONLY: "<work> — K fixes".