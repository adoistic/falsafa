# Falsafa — What It Is, What We Have, Where It's Going

_Internal overview. Written 2026-06-27. All counts are pulled from the live corpus, the knowledge-graph outputs, and the deployed site — not estimated._

---

## 1. The idea

Falsafa is a single, machine-readable corpus of the world's philosophical and classical canon, published as both a public reading site (falsafa.ai) and an open-source MCP server (`npx @falsafa/mcp`, MIT, free). On the surface it looks like a digital library. Underneath it is a **knowledge graph of how the canon talks to itself** — who cites, refutes, and extends whom; which figures recur across traditions; which founding texts everything points back to.

**The distinction that matters: translation is the human layer, not the system.** A model reads Sanskrit, Greek, Latin, Arabic, and Classical Chinese natively; it does not need an English crib to reason over a text or to extract its citations, figures, and concepts. The ontology is built on the **source text**. Translation exists for two reasons only: human readers, and adoption. So the durable, defensible asset Falsafa is building is the **multilingual, citation-grounded ontology** — the graph and the verbatim ground it sits on. The translations are the welcome mat.

This reframes the roadmap. Adding a tradition is, at the system level, an **ingestion + ontology** problem, and only secondarily a translation problem. We can graph al-Ghazālī in Arabic the day we ingest him; the English rendering can follow for the readers.

The name is not incidental. _Falsafa_ (فلسفة) is the Arabic word for philosophy — specifically the tradition of Hellenized Islamic philosophy that carried Aristotle and Plato from Greek through Arabic into Latin. The project is named for an act of transmission, and transmission is the thesis: every classical text that survives was carried across by translators, revisers, and patrons with names. Falsafa continues that for machine readers.

---

## 2. What we have now

### Headline

| Metric | Count |
|---|---|
| Works (served) | **1,836** (1,838 on disk; the Ṛgveda + Rāmāyaṇa are translated but not yet wired into the manifest) |
| Authors | 442 |
| Source languages | 9 |
| Eras | 10 · Genres 32 |
| Logical chapters | 21,516 |
| Reader pages (source + translation variants) | 30,462 |
| **Addressable passages** (each with a stable `p-xxxxxx` cite handle) | **1,272,233** |
| AI-translated in-house | 427 works |
| Human / external-sourced | 1,406 works |
| Time span (with the Ṛgveda in) | **~1500 BCE → 1952 CE ≈ 3,450 years** |

The Ṛgveda (~1500–1200 BCE) becomes the **oldest text in the collection**, five to seven centuries before Homer. Nothing already in the manifest predates Homer, so this ingestion extends the corpus down to its deepest root.

### By tradition (with flagship works)

**Greek — 810 works.** Iliad (Homer), Histories (Herodotus), Peloponnesian War (Thucydides), Apology (Plato), Nicomachean Ethics (Aristotle), Meditations (Marcus Aurelius), Discourses (Epictetus), Aphorisms (Hippocrates), Elements (Euclid), Antigone (Sophocles), Hellenica (Xenophon), the Lives (Plutarch).

**Latin — 387 works.** De Rerum Natura (Lucretius), Aeneid (Virgil), Gallic War (Caesar), Ab Urbe Condita (Livy), Amores (Ovid), Carmina (Horace), Catiline (Sallust), the orations (Cicero), Agricola (Tacitus), Divus Julius (Suetonius), Consolation of Philosophy (Boethius), Andria (Terence).

**English — 589 works.** Wealth of Nations (Smith), Common Sense (Paine), Communist Manifesto (Marx), Principles of Political Economy + System of Logic (Mill), Ethics (Spinoza), Discourse on Method (Descartes), Dialogues Concerning Natural Religion (Hume), The Conquest of Bread (Kropotkin), Proposed Roads to Freedom (Russell), Democracy and Education (Dewey).

**Sanskrit — 22 works** (all currently Ancient-era; this is the tradition being expanded now). Full list:

- _Dharmaśāstra / Smṛti (10):_ Manusmṛti, Nāradasmṛti, Yājñavalkya Smṛti, Bṛhaspati Smṛti, Kātyāyana Smṛti, Parāśara Smṛti, Viṣṇu Smṛti, Yama Smṛti, Āṅgirasa Smṛti, Vīramitrodaya (Mitra Miśra)
- _Kashmir Śaivism (3):_ Bodhapañcadaśikā, Paramārthasāra, Paryantapañcāśikā (Abhinavagupta)
- _Sāṃkhya (2):_ Sāṃkhyakārikā (Īśvarakṛṣṇa), Sāṃkhyatattvavivecana
- _Buddhist logic / tantra (4):_ Caryāmelāpakapradīpa + Cittaviśuddhiprakaraṇa (Āryadeva), Śarīrārthagāthā (Asaṅga), Tarkasaṃgraha (Annaṃbhaṭṭa), Abhisamayālaṅkāravivaraṇa
- _Vedānta (2):_ Paramārthasāra (Ādiśeṣa), Brahmabindūpaniṣad

**Smaller traditions.** French 9 (Dunoyer, Comte, Molinari — 19th-c. political economy); Urdu 5 (Iqbal _Bāng-e-Darā_, Ghalib _Dīwān_, Zauq); Kawi / Old Javanese 9 (San Hyaṅ Kamahāyānikan, Kuñjarakarṇa, Vṛhaspatitattva — Hindu-Buddhist); Old English 4 (Cynewulf — Andreas, Elene, Juliana); German 1 (Fichte).

### Most-represented authors

Plutarch 143 · Lucian 71 · Demosthenes 63 · Cicero 59 · Aelius Aristides 56 · Livy 37 · Old Testament 37 · Plato 36 · Lysias 34 · Isocrates 30 · Tertullian 30 · _Historia Augusta_ 30 · New Testament 27 · Seneca 24 · Homeric Hymns 22 · Hippocrates 20 · Plautus 20 · Euripides 19 · Xenophon 14 · Lenin 14.

### Genre and era shape

Genres: Classics 940 · Philosophy 189 · Political Theory 137 · History 117 · Economics 109 · Literature 52 · Political & Social Theory 47 · Political Economy 44 · Poetry 43 · Law 29 · (+22 smaller, incl. Aesthetics, Logic, Epistemology, Metaphysics, Theology).

Eras: Imperial 521 · Classical 327 · 20th C 248 · 19th C 241 · Hellenistic 201 · Late Antiquity 150 · Enlightenment 75 · Ancient 32 · Renaissance 29 · Medieval 12.

The current center of gravity is **Greco-Roman antiquity plus 18th–20th-c. political economy and philosophy**. The conspicuous gaps — Indian, Islamic, Chinese — are exactly what the roadmap targets.

### What is live

Reader (prose / verse / manuscript views), author and era pages, full-text search (Pagefind), the **Naql transmission atlas** (people / places / languages / timeline + a `graph.json` of 27 works, 77 transmissions, 99 people), the **"Carried Across" book**, a **BYOK live MCP demo** at `/try`, the **eval explorer** (1,121 cases), a numbers page, and the engine/thesis pages. The **MCP server** exposes 11 tools (`list_works`, `read_chapter`, `search_corpus`, `get_passage`, `get_metadata`, `list_chapters`, `compare_works`, `find_related`, `read_wiki`, `read_wiki_full`) — "a librarian, not a second LLM": zero keys, zero server-side inference.

---

## 3. The knowledge graph / ontology

This is the system. It is kept in **three deliberately separated layers**:

1. **Ground** — verbatim text, every span carrying a stable `p-xxxxxx` ID. ~1.27M passages.
2. **Structure** — typed nodes (works, authors, figures) and typed edges that **always cite the ground**.
3. **Interpretation** — the analytical read (AI or human), explicitly labeled, anchored to ground, provenance-stamped, revisable.

The boundary between layers is the whole game: it is what lets a downstream model cite high-trust facts and treat interpretation as overridable, instead of swallowing one undifferentiated blob.

### Citation layer — what's built (run on 18 works so far)

- **351 nodes, 420 edges**; 666 references resolved — 263 in-corpus, 362 absent, 41 ambiguous (held for manual review, never guessed).
- A ranked **acquisition list of 264 absent targets** (what the held corpus cites but doesn't contain).
- Edge schema: `{from, to, type:"cites", stance, citations:[{paragraph_id, quote}]}`. Stance ∈ endorse / refute / extend / authority / neutral.
- A **fidelity pass** that, for in-corpus edges, finds the exact passage in the cited work that the citing passage engages (validated 16/18 on Say→Smith).
- Guards: word-boundary slug matching (kills false substring hits), a published-year guard (kills anachronistic edges, e.g. Clarkson 1786 → Marshall 1890).

### Figure layer — what's built (run on 20 works so far)

- 743 raw figure mentions → **468 distinct figures** after a theonym merge; **132 appear in 2+ works**.
- **340 founding texts** referenced — 275 in-corpus, **65 absent → to acquire**.
- Most cross-cutting figure: **Zeus** (14 works, 103 mentions).
- **Theonym merge:** 28 Greek=Roman identity groups, Greek canonical (Zeus≡Jupiter, Aphrodite≡Venus, Heracles≡Hercules, Odysseus≡Ulysses…), whole-token matched so "Mars" never bleeds into "Marsyas."
- Figure schema: `{work_slug, canonical_name, surface_names[], figure_kind, mentions:[{paragraph_id, quote, role}], portrayal, founding_texts[]}`.

### The self-referential acquisition insight

We let the graph decide what to acquire next. Ranked by figure demand, the **top two absent founding texts in our own corpus are the Ṛgveda (53 distinct figures) and the Mahābhārata (54)** — which is precisely why those are being ingested now. The library is being completed by following its own internal references. (Others high on the absent list: Sophocles' _Oedipus Rex_, Hyginus' _Fabulae_, the Śatapatha Brāhmaṇa, the Atharvaveda, the Bhāgavata Purāṇa.)

### Taxonomy: current vs. planned

- **Currently extracted:** `figure_kind ∈ mythological | deity | historical`; citation `target_kind ∈ work | author`.
- **Planned full taxonomy** (specified, not yet implemented — this is the next major build): **Figure · Animal · Place · Group · Idea/Concept · Object/Artifact · Event**, each first-class and tracked cross-work, cross-tradition. The rule that animals-as-creatures (the sacrificial horse, the frogs of RV 7.103) are distinct from theriomorphic deities/heroes (Hanumān, Jaṭāyu, Garuḍa — judged by personhood and agency, not body) is part of this spec.

---

## 4. The methodology — two pipelines

### Pipeline A — Translation (the human-accessibility layer)

Source: the GRETIL TEI mirror (CC BY-NC-SA), cloned locally.

1. **Comprehension first.** A subagent reads the *whole* text to recover its real transliteration scheme and true canonical structure. GRETIL's TEI headers are not trusted — they often misreport the scheme and bury the structure.
2. **Deterministic clean.** Strip headers, apparatus, page markers, index banners; preserve the source script as-is.
3. **Derive structure + chapterize** from content, not from the source's markup.
4. **Translate** chunk-by-chunk via Claude **subscription subagents** (never OpenRouter — validated: 8 clean citations vs. 199 noise on a controlled test), rolling context, a per-work glossary, names in IAST.
5. **Assemble + self-heal.** A gap-finder verifies every verse is present, re-dispatches misses, and merges into corpus sidecars. Known constraint: the 32k subagent output ceiling — dense cantos are split by verse-range.

This pipeline is what has been running to produce the Vedas and Epics. It is **downstream of the system**, not the system.

### Pipeline B — Ontology extraction (the system)

Deterministic core (test-driven) + LLM extraction, all cache-versioned (a cached work makes zero LLM calls on re-run). Runs on the **source text**, so it does not depend on Pipeline A.

- **Citation:** extract `RawReference` per paragraph (target, kind, stance, verbatim quote; grounding-guarded against hallucinated paragraph IDs) → resolve against the corpus index → build graph → rank acquisition list → fidelity pass.
- **Figures:** extract `FigureRaw` per work → theonym-merge + aggregate cross-work → resolve founding texts (in-corpus vs. absent) → emit `figure-index.json`.
- **Next:** extend the extractor to the full 7-category taxonomy and run it corpus-wide (target: harden at ~460 works / a quarter of the corpus, then a full cruise over all 1,836 + the new Indic material).

---

## 5. Process — done vs. in progress

### Done

- **Corpus:** 1,836 works live; reader, search, atlas, book, eval, MCP all shipped; hosted on Cloudflare (R2 + Worker).
- **Translation infra:** the comprehension-first GRETIL pipeline + self-healing gap-finder.
- **Ṛgveda:** all 10,552 verses (10 maṇḍalas) — translated, verified, committed.
- **Rāmāyaṇa:** Bāla, Ayodhyā, Araṇya, Kiṣkindhā, Sundara — 5 of 7 kāṇḍas committed (11,635 verses).
- **Graph infra:** citation + figure layers built and run on ~18–20 works; theonym merge; fidelity pass; acquisition + founding-text ranking.
- **Eval harness:** 1,120-question A/B pool live.

### In progress

- **Rāmāyaṇa Yuddha-kāṇḍa** (the war book) — actively grinding; ~14,200 of ~18,700 total verses done (~76%).

### Pending (next)

- Finish Rāmāyaṇa (Yuddha tail + Uttara-kāṇḍa).
- **Register the Ṛgveda + Rāmāyaṇa in the manifest** so the site and MCP surface them (currently invisible).
- **Run the ontology pass on the Indic material** and **extend the taxonomy to all 7 categories.**
- **Strict graded eval scoring** (the headline drops from 84.7% loose-match to 50.6% strict; this is the real finding and it gates the arXiv preprint).

---

## 6. Where we're going — the roadmap

**Source order (from DEPLOY.md):** Perseus → GRETIL → Liberty Fund → Islamic → Chinese and others.

### Near-term

1. Complete the Vedas + Epics (Rāmāyaṇa now; then Sāmaveda, Atharvaveda, and the **Mahābhārata** — ~100k verses / 1.8M words, needs its own HTML parser; it is the graph's #1 figure-demand gap).
2. The GRETIL **philosophical canon**: ~129 of 784 Sanskrit TEI files scoped to the six darśanas (Nyāya, Vaiśeṣika, Sāṃkhya, Yoga, Mīmāṃsā, Vedānta), the principal Upaniṣads, Gītā, Brahma-sūtra, and the Buddhist logicians (Nāgārjuna, Dignāga, Dharmakīrti). 12 ingested so far.
3. **Perseus:** 380 untranslated Greek/Latin works on the in-house pipeline (Meditations live, Epictetus next).

### Mid-term — Liberty Fund

The Online Library of Liberty: the classical-liberal / political-economy canon (Mill, Bastiat, Smith, Tocqueville, the Federalist tradition, Acton). Complements the 19th–20th-c. material already heavy in the corpus.

### The Islamic philosophy tranche (the namesake tradition)

Not yet enumerated in the repo — proposed scope below. This is the bridge tradition: the Arabic philosophers are exactly the nodes that connect the Greek originals to the Latin scholastics, so they should surface heavily as citation targets once the medieval material is graphed.

- **Al-Kindī** — the first philosopher of the Arabs (treatises on the intellect, metaphysics).
- **Al-Fārābī** — _The Virtuous City_ (al-Madīna al-Fāḍila), _The Book of Letters_, _Enumeration of the Sciences_.
- **Ibn Sīnā / Avicenna** — _The Healing_ (al-Shifāʾ), _The Salvation_ (al-Najāt), _Pointers and Reminders_ (al-Ishārāt).
- **Al-Ghazālī** — _The Incoherence of the Philosophers_ (Tahāfut al-Falāsifa), _Deliverance from Error_, the _Iḥyāʾ_.
- **Ibn Rushd / Averroes** — _The Incoherence of the Incoherence_, the Aristotle commentaries, _Decisive Treatise_ (Faṣl al-Maqāl).
- **Ibn Ṭufayl** — _Ḥayy ibn Yaqẓān_.
- **Suhrawardī** — _The Philosophy of Illumination_ (Ḥikmat al-Ishrāq).
- **Ibn ʿArabī** — _Bezels of Wisdom_ (Fuṣūṣ al-Ḥikam), _Meccan Revelations_ (selections).
- **Ibn Khaldūn** — _The Muqaddimah_.
- **Mullā Ṣadrā** — _The Four Journeys_ (al-Asfār al-Arbaʿa).
- Adjacent: al-Ashʿarī (kalām), Naṣīr al-Dīn al-Ṭūsī (ethics/logic), al-Rāzī, al-Bīrūnī.

Sourcing note: there is no single GRETIL-equivalent TEI mirror for Arabic philosophy. Likely sources are al-Maktaba al-Shāmila and scattered digital editions; some texts will need OCR and structural cleanup. Because the ontology runs on the source, we can graph these in Arabic first and translate for readers afterward.

### The Chinese tranche

- Confucius — _Analects_; _Mèngzǐ_; _Dàodéjīng_ (Laozi); _Zhuāngzǐ_; _Xúnzǐ_; _Mòzǐ_; _Hán Fēizǐ_ (Legalism); Sūnzǐ — _Art of War_; the _Great Learning_ and _Doctrine of the Mean_; and the Neo-Confucians (Zhū Xī, Wáng Yángmíng).
- Source: the Chinese Text Project (ctext.org) is bulk-downloadable, much like GRETIL — a clean ingestion target.

The completeness spec notes that Chinese and other civilizations **inherit the shared semantic ontology layer** built for the Indic expansion. Once the taxonomy and extractor are right, adding a tradition is ingest → extract → (optionally) translate.

---

## 7. The eval and the paper

The experimental claim: does giving a model this grounded layer make it cite the canon more honestly? A 1,120-question pool across 7 categories, two tiers — Citation (757 named-work questions) and Discovery (363 hidden-work questions). The only variable is whether the model has the wiki/graph layer. The pending work is **strict 3-state scoring** (pass / mixed / fail), which drops the headline from 84.7% to **50.6%** — that citation-discipline gap is the actual contribution, and finishing it unblocks the preprint.

---

## One-line summary

We hold **1,836 works / 1.27M cited passages spanning ~3,450 years**, just added the **two most-demanded texts in our own graph** (Ṛgveda complete, Rāmāyaṇa ~76%), and are heading through the Indian philosophical canon, Perseus, Liberty Fund, Islamic philosophy, and Chinese — with the real product being not the translations but the **multilingual, citation-grounded ontology** the translations sit on top of.
