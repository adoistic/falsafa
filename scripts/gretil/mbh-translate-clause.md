# Mahābhārata translation clause (Opus pipeline)

Shared instructions injected into every MBh translation subagent so the
upgraded (Opus + fixed glossary) grind stays internally consistent.

## Romanization — full IAST, always

Render EVERY Sanskrit proper noun in full IAST with diacritics. Never anglicize
(no "Krishna", "Bhishma", "Arjun", "Drona"). Preserve vowel length (ā ī ū ṝ),
vocalic ṛ ḷ, retroflex ṭ ḍ ṇ ṣ, palatal ś ñ, velar ṅ, anusvāra ṃ, visarga ḥ.

Canonical forms for the recurring figures and places:

- Pāṇḍavas: Yudhiṣṭhira, Bhīma (Bhīmasena), Arjuna, Nakula, Sahadeva
- Their kin: Kuntī, Mādrī, Pāṇḍu, Draupadī, Subhadrā, Abhimanyu
- Kauravas: Dhṛtarāṣṭra, Duryodhana, Duḥśāsana, Śakuni, Vikarṇa
- Elders/teachers: Bhīṣma, Droṇa, Kṛpa, Aśvatthāman, Vidura, Saṃjaya, Gāndhārī
- Kṛṣṇa and his names: Kṛṣṇa, Vāsudeva, Keśava, Govinda, Janārdana, Mādhava, Hari
- Arjuna's epithets: Pārtha, Dhanaṃjaya, Phalguna, Bībhatsu, Savyasācin, Kirīṭin
- Karṇa's: Karṇa, Rādheya, Vaikartana, Sūtaputra
- Sages: Vyāsa, Nārada, Vasiṣṭha, Viśvāmitra, Bharadvāja, Mārkaṇḍeya
- Devas: Indra (Śakra, Vāsava, Purandara), Agni, Vāyu, Varuṇa, Yama, Sūrya,
  Soma, Viṣṇu, Brahmā, Rudra/Śiva (Maheśvara, Śaṃkara), Kubera
- Peoples/places: Kuru(s), Pāñcāla(s), Kaurava(s), Pāṇḍava(s), Hāstinapura,
  Indraprastha, Kurukṣetra, Gaṅgā, Yamunā, Sarasvatī

## Vowel-length / entity distinctions — do NOT flatten

These are DIFFERENT names; choose by context, never collapse:
- **Bhārata** = patronymic ("O descendant of Bharata", address) vs **Bharata** =
  the ancestor-king's personal name (short a). Keep them distinct.
- **Kṛṣṇa** (Vāsudeva, masc.) vs **Kṛṣṇā** (an epithet of Draupadī). Use Kṛṣṇā
  ONLY where the text addresses Draupadī by it; otherwise Kṛṣṇa.
- **Sūrya** (the sun god) vs **Sūryā** (fem.). **Śantanu** vs **Śāntanu** — keep
  whichever the source meter/text supports; do not normalize the vowel.

## Output

Read `t2work/gretil/segmented/mahabharata/parva-<PP>.txt` (lines
`<ref>\t<IAST>`, ref = parva.adhyaya.verse, file in source order). Translate
every verse in the assigned span inclusive — drop none, invent none, nothing
outside the range.

Write `corpus/works/mahabharata/chapters/<PP>-parva-<P>/translation.part<NNN>.json`
(`mkdir -p`) as a JSON array, source order:

```json
[{"ref":"<P.A.V>","sanskrit":"<verbatim source line>","english":"<translation>"}]
```

STRICT valid JSON — escape interior quotes, no trailing commas, no raw newlines
inside strings. `JSON.parse` the file to confirm before finishing.

## Register

Faithful, readable literary English. Sense-for-sense, not wooden word-for-word.
Preserve epithets, similes, and the epic register; keep the dignity of the verse
without padding. Match the quality of the committed parva-1–4 renderings.
