# Bharata / Bhārata disambiguation (Opus, per-occurrence)

You are correcting the proper-name forms **Bharata / Bhārata / Bharatas / Bhāratas**
in English translations of Sanskrit texts. These are DIFFERENT and must be chosen
by context, occurrence by occurrence:

- **Bharata** (short *a*) = a personal name: the ancestor-king Bharata, OR (in the
  Rāmāyaṇa) Rāma's brother Bharata. Also the phrase "descendant of Bharata",
  "son of Bharata", "Bharata's line/race" where Bharata names the ancestor.
- **Bhārata** (long *ā*) = the **patronymic**, "(O) descendant of Bharata", used to
  ADDRESS or DESCRIBE a member of the Bharata lineage (commonly the vocative
  "O Bhārata", "bull of the Bhāratas", "best of the Bhāratas", or "the Bhārata
  race/host" as an epithet of the Kurus).
- **Bharatas / Bhāratas** = plurals of the above (the clan/people vs. a personal
  plural); choose length to match.

## Per-text policy (you will be told which work this batch is from)

- **mahabharata**: The poem constantly addresses its listeners (Dhṛtarāṣṭra,
  Saṃjaya, Yudhiṣṭhira, etc.) as the patronymic. So a VOCATIVE "O Bharata" or a
  descriptive epithet ("bull/best/foremost of the Bharatas", "the Bharata host")
  is almost always **Bhārata/Bhāratas**. Use short **Bharata** only when the text
  genuinely means the ancestor-king (e.g. "King Bharata", "descendant of Bharata",
  a narrated deed of Bharata himself).
- **valmiki-ramayana**: "Bharata" is overwhelmingly **Rāma's brother** — a short-*a*
  personal name — INCLUDING when addressed "O Bharata". Keep **Bharata** for the
  brother. Use **Bhārata** only where the text clearly means the patronymic of
  someone else (rare). When in doubt in this text, keep short **Bharata**.
- **rigveda-aufrecht / atharvaveda-ps**: "Bharata(s)" usually denotes the **Bharata
  tribe / clan** (a Vedic people) or the personal name — short **Bharata(s)**.
  Only use **Bhārata** for an unambiguous patronymic. When in doubt, keep short.

## Input / output

Input: a JSON array of verses `[{"ref","tokens":[...in order...],"text":"<verse>"}]`.
For EACH verse, read the actual text and decide the correct form for each token in
order. Output a JSON object mapping ref → corrected-form-array, **including only
verses where at least one token changes** from the input. The corrected array MUST
have the same length and order as that verse's `tokens`. Example:
`{"5.8.6": ["Bhārata"], "5.51.16": ["Bharata"]}` (omit verses you leave unchanged).

Write strict valid JSON (real diacritics ā) to the path given. `JSON.parse` to
confirm. REPORT ONLY: `<label> — V verses changed`.
