# Proper-name normalization — decision clause (Opus)

You are auditing **English translations** of Sanskrit texts (Mahābhārata,
Rāmāyaṇa, Vedas) to make proper nouns consistent in **full IAST**. You are given
clusters of spelling variants that refer to (probably) the same name. For each
cluster decide the single correct canonical IAST form and emit a replacement map.

## Input

A JSON array of clusters: `[{"fold": "...", "variants": {"<Spelling>": <count>, ...}}, ...]`.
The `fold` is a lossy phonetic key used only to group candidates — IGNORE it for
meaning; judge from the actual spellings.

## What to output

A STRICT JSON object mapping **only the spellings that must change** to their
canonical form: `{"<oldSpelling>": "<canonicalIAST>", ...}`. Omit any spelling
that is already canonical or that you decide to leave untouched. Do not include
identity mappings.

## Rules (in priority order)

1. **Collapse anglicizations and under-diacritized forms** to the correct full
   IAST. Examples: `Krishna→Kṛṣṇa`, `Drona→Droṇa`, `Bhima→Bhīma`,
   `Ravana→Rāvaṇa`, `Kunti→Kuntī`, `Dhritarashtra→Dhṛtarāṣṭra`,
   `Vaishampayana→Vaiśaṃpāyana`, `Pandavas→Pāṇḍavas`, `Ganga→Gaṅgā`,
   `Arjun→Arjuna`, `Vishnu→Viṣṇu`, `Shiva→Śiva`. Use correct diacritics
   (ā ī ū ṛ ṝ ḷ ṅ ñ ṭ ḍ ṇ ś ṣ ṃ ḥ). Preserve trailing grammatical `-s`
   (plural) and capitalization.

2. **PRESERVE genuine entity distinctions** — never collapse forms that denote
   DIFFERENT beings, even though they share a fold. Specifically:
   - **Kṛṣṇa** (Vāsudeva, masculine) vs **Kṛṣṇā** (a name of Draupadī, feminine):
     keep BOTH. You may still map the plainly anglicized `Krishna`/`Krsna` → `Kṛṣṇa`
     (the masculine), but NEVER touch `Kṛṣṇā`.
   - **Bharata** (the ancestor-king; also Rāma's brother — short *a*) vs
     **Bhārata** (patronymic, "descendant of Bharata" — long *ā*): BOTH are valid
     distinct uses. Do NOT map `Bharata→Bhārata` or the reverse. Leave both.
     (Likewise `Bharatas` vs `Bhāratas` — leave both.)
   - Length-distinct pairs to preserve: **Sūrya/Sūryā, Tāra/Tārā, Vāli/Vālī,
     Hiḍimba/Hiḍimbā, Ila/Ilā/Iḷā, Śantanu/Śāntanu, Kanva/Kaṇva/Kāṇva,
     Kaśyapa/Kāśyapa, Bāhlika/Bāhlīka, Anantā/Ananta.** Only fix a variant that
     has NO diacritics AND is the unmistakable anglicization of the dominant
     member; otherwise leave the cluster alone.

3. **Do not invent length.** If the dominant correct form is short (e.g.
   **Indra, Yama, Mitra, Rudra, Hari, Soma, Varuṇa, Sindhu** — these are correct
   as written), then a stray long-vowel variant (Indrā, Yamā, Mitrā) is the ERROR:
   map the rare wrong form back to the correct short form (`Indrā→Indra`). Never
   the reverse.

4. **Ignore non-names.** If a cluster is just ordinary English words capitalized
   at sentence start (These/Their, Where/Were, Thus/This, etc.) or otherwise not
   a Sanskrit proper noun, output nothing for it.

5. **When unsure whether two diacritic forms are distinct entities, DO NOT MAP.**
   Safety first — a missed straggler is fine; a corrupted distinct name is not.

## Output mechanics

Write your map as strict, valid JSON (UTF-8, real diacritics, no trailing commas,
no comments) to the path given in the task. `JSON.parse` it to confirm. Report
ONLY: `map-<i> — <K> mappings`.
