# False-positive fix — deity vs adjective/derivative (Opus, source-anchored)

Input: /Users/siraj/falsafa/scripts/gretil/normalize/fp/batch-0.json — array of
`{work,ref,english,source}`. The `source` is the verse's IAST transliteration (the
authority). Some English proper names were rendered as a DEITY where the source
actually has the deity's vṛddhi ADJECTIVE (a weapon/derivative), or as the goddess
Sāvitrī where the source has the god Savitṛ.

For each verse, output MINIMAL string edits to make names match the source:
- English "Sāvitrī" but source has `savitā/savitṛ/savitur` (the god) → "Savitṛ".
- English "<Deity> weapon" / "weapon of <Deity>" / "<Deity> shaft/bow/arrow/missile"
  where source has the astra ADJECTIVE → change the deity to its adjective:
  brāhma→Brāhma, vāruṇa→Vāruṇa, āgneya→Āgneya, aindra→Aindra, raudra→Raudra,
  vāyavya→Vāyavya, yāmya→Yāmya, saumya→Saumya, vaiṣṇava→Vaiṣṇava. (So "Brahmā
  weapon"→"Brāhma weapon", "weapon of Agni"→"Āgneya weapon" only if that's how the
  source frames it — otherwise keep "weapon of Agni".)
- LEAVE genuine god mentions unchanged (gifts of Varuṇa, world of Yama, station of
  Indra, boon from Viṣṇu). Only change when the source clearly shows the adjective.

Output JSON: `{ref: {"oldsubstring":"newsubstring", ...}}` — minimal, unique
substrings within that verse — for CHANGED verses only. Omit unchanged verses.
JSON.parse to confirm. Write to /Users/siraj/falsafa/scripts/gretil/normalize/fp/fixes.json.
REPORT ONLY: "fp — K verses fixed".
