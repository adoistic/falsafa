# Falsafa — Chapter-Splitting Discovery Report

Generated: 2026-04-26T17:44:14.207Z

## Summary

| Type | Count | Strategy |
|------|------:|----------|
| TYPE_A | 7 | auto-split by verse markers (Mn_1.x style) |
| TYPE_B | 0 | verses exist, all under ch.1 — manual section discovery |
| TYPE_C | 6 | prose heading detection (CHAPTER N etc) |
| TYPE_D | 15 | already well-split (no action) |
| TYPE_E | 10 | no auto-detect — manual inspection |

Total works surveyed: 38

## TYPE_A — Auto-splittable by verse markers

These have clean `Prefix_N.M` verse markers with multiple distinct chapter numbers. The splitter can group verses by chapter number deterministically. Cross-variant consistency check column: all variants with markers detect the same chapter count.

| Work | Lang | Now | Proposed | Pattern | Variants agree? |
|------|------|----:|---------:|---------|:---------------:|
| Āṅgirasa Smṛti | Sanskrit | 1 | 3 | `Ang_<chapter>.<verse>` | ⚠️ no |
| Manusmṛti | Sanskrit | 1 | 12 | `Mn_<chapter>.<verse>` | ✅ |
| Nāradasmṛti | Sanskrit | 1 | 19 | `Nar_<chapter>.<verse>` | ✅ |
| Parāśara Smṛti | Sanskrit | 1 | 12 | `Par_<chapter>.<verse>` | ✅ |
| Viṣṇu Smṛti | Sanskrit | 1 | 100 | `Vi_<chapter>.<verse>` | ✅ |
| Yama Smṛti | Sanskrit | 1 | 2 | `YSS_<chapter>.<verse>` | ✅ |
| Yājñavalkya Smṛti | Sanskrit | 1 | 3 | `Yj_<chapter>.<verse>` | ✅ |

## TYPE_B — Verses exist but all under chapter 1

Verse markers are present but all carry the chapter-number 1, even though the actual work has internal divisions. The source document likely conflated divisions during preparation. **Manual section-break discovery required.**

## TYPE_C — Prose section headings detected

No verse markers, but heading patterns suggest internal structure. Manual review of the heading samples is required to confirm they represent real chapter boundaries.

### Bṛhaspati Smṛti  *(unknown-brhaspati-smrti-0fd070)*

- Language: Sanskrit
- Current state: 1 logical chapter(s)
- Detected sections: 52
- Sample headings:
  - **translation** (english, 52 sections):
    - `### 1.1 The Qualities of a King`
    - `### 1.2 The Topics of Legal Procedure`
    - `### 1.3 The Relative Strength of the Four Means of Decision`
    - `### 1.4 The Court of Justice`
    - `### 1.5 The Characteristics of a Fortress`
    - `### 1.6 The Characteristics of Protecting the Subjects`

### Kalpabuddha  *(unknown-kalpabuddha-d760dc)*

- Language: Kawi
- Current state: 1 logical chapter(s)
- Detected sections: 7
- Sample headings:
  - **translation** (english, 7 sections):
    - `### Paragraph 1`
    - `### Paragraph 2`
    - `### Paragraph 3`
    - `### Paragraph 4`
    - `### Paragraph 5`
    - `### Paragraph 5`
  - **transliteration** (Kawi, 7 sections):
    - `### Paragraph 1`
    - `### Paragraph 2`
    - `### Paragraph 3`
    - `### Paragraph 4`
    - `### Paragraph 5`
    - `### Paragraph 5`

### Kātyāyana Smṛti  *(unknown-katyayana-smrti-1e06d2)*

- Language: Sanskrit
- Current state: 1 logical chapter(s)
- Detected sections: 80
- Sample headings:
  - **translation** (english, 80 sections):
    - `## The Qualities of a King`
    - `## The Duties of a King`
    - `## The Definition of Legal Proceedings and Other Matters`
    - `## Deliberation on the Relative Strength of Sacred Law, Legal Procedure, Custom, and Royal Edicts`
    - `## The Court of Justice`
    - `## The Time for Examining Cases`

### Kunjarakarna Dharmakathana  *(unknown-kunjarakarna-dharmakathana-894f4a)*

- Language: Kawi
- Current state: 1 logical chapter(s)
- Detected sections: 34
- Sample headings:
  - **translation** (english, 34 sections):
    - `## Canto 8`
    - `## Canto 9`
    - `## Canto 10`
    - `## Canto 11`
    - `## Canto 12`
    - `## Canto 13`

### Vīramitrodaya  *(unknown-viramitrodaya-d4b632)*

- Language: Sanskrit
- Current state: 1 logical chapter(s)
- Detected sections: 70
- Sample headings:
  - **translation** (english, 70 sections):
    - `### [Determination of Caturthī]`
    - `### [Determination of Pañcamī]`
    - `### [Determination of Ṣaṣṭhī]`
    - `### [Determination of Saptamī]`
    - `### [Determination of Aṣṭamī]`
    - `### [Determination of Navamī]`

### Zurückforderung der Denkfreiheit von den Fürsten Europens  *(johann-gottlieb-fichte-zuruckforderung-der-denkfreiheit-bookde)*

- Language: German
- Current state: 1 logical chapter(s)
- Detected sections: 3
- Sample headings:
  - **translation** (english, 3 sections):
    - `## Reclaiming Freedom of Thought from the Princes of Europe, Who Have Hitherto Suppressed It.`
    - `## Preface`
    - `## Speech`
  - **original** (German, 3 sections):
    - `## Zurückforderung der Denkfreiheit von den Fürsten Europens, die sie bisher unterdrückten.`
    - `## Vorrede`
    - `## Rede`

## TYPE_E — No auto-detectable structure

Neither verse markers nor prose section headings detected. These need manual inspection — read the body, decide if it's genuinely one chunk or has hidden divisions.

### Andreas  *(cynewulf-andreas-07b573)*

- Language: old_english
- Current state: 1 logical chapter(s)
- **translation** (english): 12387 words, 69146 chars
  - preview: *We have heard of heroes in ages past, of twelve true thanes under the turning stars, the Lord’s own champions. Their glory lived on in the grim struggle where standards clashed. Their lots were laid o…*
- **original** (old_english): 9647 words, 69375 chars
  - preview: *Andreas ======= Verse Indeterminate Saxon Source: https://sacred-texts.com/neu/ascp/a02_01.htm Lines: 345 -------------------------------------------------------------------------------- Hwæt! We gefr…*
- **translation** (english): 9297 words, 68642 chars
  - preview: *Hwaet! We gefrunan on fyrndagum twelfe under tunglum tireadige haeleth, theodnes thegnas. No hira thrym alaeg campraedenne thonne cumbol hneotan, syththan hie gedaeldon, swa him dryhten sylf, heofona …*

### Elene  *(cynewulf-elene-d2d132)*

- Language: old_english
- Current state: 1 logical chapter(s)
- **translation** (english): 8573 words, 47461 chars
  - preview: *Two hundred winters had wound their way, and three and forty told in number, since the Wielder of Glory, the world's true Light, was born among men to bring us solace. Then Constantine ruled, the Caes…*
- **original** (old_english): 7592 words, 59872 chars
  - preview: *Elene ===== Verse Indeterminate Saxon Source: https://sacred-texts.com/neu/ascp/a02_06.htm Lines: 265 -------------------------------------------------------------------------------- þa wæs agangen ge…*
- **translation** (english): 7318 words, 53150 chars
  - preview: *tha was agangen geara hwyrftum tu hund ond threo geteled rimes, swylce XXX eac, thinggemearces, wintra for worulde, thas the wealdend god acenned wearth, cyninga wuldor, in middangeard thurh mennisc h…*

### Gaṇapatitattva  *(unknown-ganapatitattva-66a136)*

- Language: Kawi
- Current state: 1 logical chapter(s)
- **translation** (english): 10190 words, 57955 chars
  - preview: *//0// May there be no obstacles. // Oṃ, homage to the perfected. //0// Oṃ // Gaṇapati questioned Śiva, the giver of success to Gaṅgā and Umā, the son who is teacher to the host of gods, for the glory …*
- **transliteration** (Kawi): 7692 words, 43911 chars
  - preview: *Gaṇapatitattva //0// avighnam astu // oṃ namaḥ siddham //0// oṃ // gaṇapatiḥ śivam pṛcchad gaṅgomayoḥ siddhārthadaḥ devagaṇaguruḥ putraḥ śaktivīryyālokaśriyai // (1) 1 nihan pitu[tu]r ira bhaṭāra śiva…*

### Juliana  *(cynewulf-juliana-9a2157)*

- Language: old_english
- Current state: 1 logical chapter(s)
- **translation** (english): 5890 words, 32157 chars
  - preview: *Hark! We have heard it, a history for heroes, of days long departed, when a dark power reigned. Merciless Maximian, a man who held mastery over the wide world, a wicked emperor who raised up terror, a…*
- **original** (old_english): 4285 words, 33014 chars
  - preview: *Juliana ======= Verse Indeterminate Saxon Source: https://sacred-texts.com/neu/ascp/a03_05.htm Lines: 147 -------------------------------------------------------------------------------- Hwæt! We ðæt …*
- **translation** (english): 4128 words, 27431 chars
  - preview: *Hwaet! We thaet hyrdon haeleth eahtian, deman daedhwate, thaette in dagum gelamp Maximianes, se yeond middangeard, arleas chyning, eahtnysse ahof, cwealde cristne men, chirchan fylde, yeat on graeswon…*

### San Hyan Kamahayanikan  *(unknown-san-hyan-kamahayanikan-2a0c19)*

- Language: Kawi
- Current state: 1 logical chapter(s)
- **translation** (english): 14398 words, 85898 chars
  - preview: *Homage to the Buddha! This is the meaning of OṂ AḤ HUṂ. When taken as the foundation for teaching, the Lord of the Three Syllables is the ultimate reality, the *vajra* of body, speech, and mind. *Come…*
- **transliteration** (Kawi): 9256 words, 68688 chars
  - preview: *Saṅ Hyaṅ Kamahāyānikan [b8] namo buddhāya! nihan kaliṅan iṅ oṃ ah huṃ, yan pinakapaṅashiṣṭhāna umajarakan as bhaṭāra tryakṣara sira paramārtha kāya wāk citta bajra ṅaran ira. EHI VATSA MAHĀYĀNAṂ MANTR…*

### San Hyan Mahajnana  *(unknown-san-hyan-mahajnana-11c531)*

- Language: Kawi
- Current state: 1 logical chapter(s)
- **translation** (english): 6836 words, 36731 chars
  - preview: *The Sacred Supreme Wisdom *May there be no obstacles.* When the revered Kumāra was studying with the Lord Guru, he asked about The Sacred Supreme Wisdom. He made obeisance to the Lord, his words were:…*
- **transliteration** (Kawi): 4866 words, 28591 chars
  - preview: *Saṅ Hyaṅ Mahājñāna Avighnaṃ astu ri sḍĕṅ saṅ kumāra maṅaji ri bhaṭara guru / tumaṅākĕn saṅ hyaṅ mahājñāna / manĕmbah ta sira ri bhaṭara / liṅ nira / oṃ namah śiwāya / ri tlas nira manĕmbah / ujar ta s…*

### San Hyan Tattvajnana  *(unknown-san-hyan-tattvajnana-1f29bd)*

- Language: Kawi
- Current state: 1 logical chapter(s)
- **translation** (english): 16092 words, 94502 chars
  - preview: *// o // Oṃ, may there be no obstacles // Homage to the perfected ones // o // 1. Now, this must be heeded by the practitioner of the sacred duty who wishes to be released from the cycle of rebirth. Th…*
- **transliteration** (Kawi): 12617 words, 74061 chars
  - preview: *Saṅ Hyaṅ Tattvajñāna // o // Oṃ avighnam astu // namaḥ siddham // o // Nihan kayatnākna de saṅ sevakadharmma saṅ mahyun luputeṅ janmasaṃsāra / hana saṅ hyaṅ tattvajñāna ṅaranira / ya tika kavruhaknant…*

### Slokantara  *(unknown-slokantara-d7a628)*

- Language: Kawi
- Current state: 1 logical chapter(s)
- **translation** (english): 17343 words, 97686 chars
  - preview: *Ślokāntara [Slo_00s-opening] || May there be no obstacles || [Slo_01s-ab] brāhmaṇo vā manuṣyāṇām ādityo vāpi tejasām | [Slo_01s-cd] śiro vā sarvagātreṣu dharmeṣu satyam uttamam || 1 || [Slo_01j§1] The…*
- **transliteration** (Kawi): 12338 words, 74803 chars
  - preview: *Ślokāntara [Slo_00s-opening] || avighnam astu || [Slo_01s-ab] brāhmaṇo vā manuṣyāṇām ādityo vāpi tejasām | [Slo_01s-cd] śiro vā sarvagātreṣu dharmeṣu satyam uttamam || 1 || [Slo_01j§1] kaliṅanya | nih…*

### Vratisasana  *(unknown-vratisasana-d0fe75)*

- Language: Kawi
- Current state: 1 logical chapter(s)
- **translation** (english): 17658 words, 102073 chars
  - preview: *Vratiśāsana [VS_00s] ||0|| May there be no hindrance ||0|| [VS_00s] || oṁ namaḥ śivāya || [VS_01s-ab] *Having bowed to the god Bhāskara, the bestower of worldly enjoyment and liberation,* [VS_01s-cd] …*
- **transliteration** (Kawi): 12337 words, 76909 chars
  - preview: *Vratiśāsana [VS_00s] ||0|| avighnam astu ||0|| [VS_00s] || oṁ namaḥ śivāya || [VS_01s-ab] praṇamya bhāskaraṁ devaṁ bhuktimuktivarapradam | [VS_01s-cd] sarvalokahitārthāya pravakṣye vratiśāsanam ||1|| …*

### Vrhaspatitattva  *(unknown-vrhaspatitattva-b60b28)*

- Language: Kawi
- Current state: 1 logical chapter(s)
- **translation** (english): 14791 words, 85054 chars
  - preview: *May there be no obstacles. > On the beautiful peak of Mount Kailāśa, Maheśvara was seated, > and to Vṛhaspati he spoke of the unsurpassed truth of Śiva. || 1 Lord Īśvara was on the summit of Mount Kai…*
- **transliteration** (Kawi): 11214 words, 65442 chars
  - preview: *Vṛhaspatitattva Avighnam astu kailāśaśikhare ramye tiṣṭhamāno maheśvaraḥ | vṛhaspatim uvāceti śivatattvam anuttamam || 1 Bhaṭāra Īśvara hane pucak niṅ Kailāsaparvata / sĕḍĕṅ mavarah aji ri saṅ vatĕk d…*

## TYPE_D — Already well-split (no action)

| Work | Lang | Chapters |
|------|------|---------:|
| Bang-E-Dara Part 1 | Urdu | 44 |
| Bang-E-Dara Part 2 | Urdu | 28 |
| Bang-E-Dara Part 3 | Urdu | 28 |
| Diwan-E-Ghalib | Urdu | 239 |
| Diwan-E-Zauq | Urdu | 60 |
| Nouveau traité d'économie: VOL I | French | 13 |
| Nouveau traité d'économie: VOL II | French | 7 |
| Nyaya Tilakam Pandulipi | Sanskrit | 18 |
| Old English Elegies | old_english | 17 |
| Traité de Législation: VOL I | French | 22 |
| Traité de Législation: VOL II | French | 27 |
| Traité de Législation: VOL III | French | 23 |
| Traité de Législation: VOL IV | French | 23 |
| Traité de la propriété: VOL I | French | 27 |
| Traité de la propriété: VOL II | French | 28 |
