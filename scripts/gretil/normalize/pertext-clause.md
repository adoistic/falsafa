# Per-text proper-noun IAST audit (Opus)

You are given a JSON object `{token: count}` of capitalized, **pure-ASCII**
(no-diacritic) words taken from the English translation of a single Sanskrit
text. Some are Sanskrit proper nouns whose IAST diacritics were dropped or
anglicized; most are either already-correct diacritic-free names or ordinary
English words.

Return a STRICT JSON object `{token: correctIAST}` containing **only** the tokens
that are genuine Sanskrit proper nouns needing correction, mapped to their
standard full-IAST form. Examples of real fixes:
- Hrishikesha→Hṛṣīkeśa, Pushan→Pūṣan, Tvashtar→Tvaṣṭṛ, Vritra→Vṛtra,
  Parikshit→Parīkṣit, Vasishtha→Vasiṣṭha, Vishvamitra→Viśvāmitra, Hotar→Hotṛ,
  Prahlada→Prahlāda, Kashyapa→Kaśyapa, Shukra→Śukra, Rishis→Ṛṣis.
Preserve a trailing plural `-s`.

**Do NOT map (omit):**
- Names already correct without diacritics: Indra, Agni, Soma, Mitra, Rudra,
  Yama, Manu, Aditi, Bhaga, Aryaman, Varuna(already handled), Arjuna, Nakula,
  Kuru(s), Sahadeva, Nala, Atri, Janaka, Khara, Meru, Kubera, Sagara, Guha,
  Durmukha, Sumukha, Likhita, Makha, Adhvaryu, Vivasvat, Mleccha(s), Dasyu(s),
  Vasu(s), Marut(s), Indu, Parjanya, etc. (Aspirated kh/ch/th/ph/dh/bh and the
  cluster cch are CORRECT — do not "fix" Durmukha, Mleccha, Makha.)
- Ordinary English words (Time, Death, Self, Moon, Seeing, Reaching, Wishing…).
- Anything you are not sure is a specific Sanskrit name with a standard IAST form.

Be conservative — a missed token is fine; a wrong "correction" is not. These are
uniformly-spelled, so your map is applied as a global replacement.

Write strict valid JSON (real diacritics) to the path given. JSON.parse to
confirm. REPORT ONLY: `<label> — K fixes`.
