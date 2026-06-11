#!/usr/bin/env python3
"""
Text-quality audit of the newly-added Project Gutenberg works in the Falsafa corpus.

Targets: works whose chapter-level meta.json variants carry a source_url containing
gutenberg.org. Genres are Philosophy / Logic / Aesthetics / Political Theory /
Philosophy of *.

Checks:
  1. No PG boilerplate in any chapter body (translation.md / original.md).
  2. Chapterization sanity (top-10 by chapter count; single-chapter >60k-word
     fallbacks; suspiciously tiny chaptered works).
  3. No raw markup leak ('<', '_' runs, '[Pg', '[Footnote', '[Illustration',
     3+ consecutive blank-ish artifacts).
  4. Structural completeness: index.md + per-chapter body + matching
     .paragraphs.json with >0 paragraphs and frontmatter word_count > 100.
  5. Spot-read the opening 200 words of 6 famous works.

Run: python3 audit_gutenberg.py
"""
import json
import os
import re
import statistics
import sys
from pathlib import Path

CORPUS = Path("/Users/siraj/falsafa/corpus/works")

# Body files we treat as "chapter bodies" (translation first, then original).
BODY_NAMES = ["translation.md", "original.md", "translation-2.md", "transliteration.md"]

# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def is_gutenberg_work(work_dir: Path) -> bool:
    """True if any chapter meta.json variant has a gutenberg.org source_url."""
    for meta in work_dir.glob("chapters/*/meta.json"):
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
        except Exception:
            continue
        for v in data.get("variants", []):
            url = (v.get("source_url") or "")
            if "gutenberg.org" in url.lower():
                return True
    return False


def discover_works():
    works = []
    for work_dir in sorted(CORPUS.iterdir()):
        if not work_dir.is_dir():
            continue
        if is_gutenberg_work(work_dir):
            works.append(work_dir)
    return works


def read_frontmatter(index_md: Path) -> dict:
    """Crude YAML frontmatter reader (flat top-level keys only)."""
    fm = {}
    if not index_md.exists():
        return fm
    text = index_md.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return fm
    block = m.group(1)
    for line in block.splitlines():
        mm = re.match(r"^(\w[\w_]*):\s*(.*)$", line)
        if mm:
            key, val = mm.group(1), mm.group(2).strip().strip('"')
            fm[key] = val
    return fm


def chapter_body_path(chapter_dir: Path):
    for name in BODY_NAMES:
        p = chapter_dir / name
        if p.exists():
            return p
    return None


def split_frontmatter(text: str):
    """Return (frontmatter_text, body_text). Body is everything after the
    closing '---' of a leading YAML frontmatter block. Line offset of the body
    within the original file is also returned so reported line numbers stay true."""
    m = re.match(r"^---\n.*?\n---\n?", text, re.DOTALL)
    if not m:
        return "", text, 0
    fm = m.group(0)
    body = text[m.end():]
    body_line_offset = fm.count("\n")
    return fm, body, body_line_offset


def chapter_para_json_path(chapter_dir: Path, body_path: Path):
    """Matching .paragraphs.json for a body file (e.g. translation.md -> translation.paragraphs.json)."""
    if body_path is None:
        return None
    stem = body_path.name[:-3]  # strip ".md"
    p = chapter_dir / f"{stem}.paragraphs.json"
    return p if p.exists() else None


def word_count_text(text: str) -> int:
    return len(re.findall(r"\S+", text))


# ---------------------------------------------------------------------------
# Check 1: PG boilerplate
# ---------------------------------------------------------------------------

BOILERPLATE_PATTERNS = [
    re.compile(r"project gutenberg", re.IGNORECASE),
    re.compile(r"\*\*\* ?START", re.IGNORECASE),
    re.compile(r"\*\*\* ?END", re.IGNORECASE),
    re.compile(r"gutenberg\.org/license", re.IGNORECASE),
    re.compile(r"produced by", re.IGNORECASE),
    re.compile(r"transcriber", re.IGNORECASE),
]

# A body hit is a GENUINE boilerplate defect (vs. innocent prose like
# "the sensation produced by a ray of light") only if it carries an
# unambiguous PG-credit / transcriber-note / start-end marker in its context.
GENUINE_BOILERPLATE = [
    re.compile(r"project gutenberg", re.IGNORECASE),       # literal "Project Gutenberg" in body
    re.compile(r"\*\*\* ?(START|END)", re.IGNORECASE),     # *** START/END markers
    re.compile(r"gutenberg\.org/license", re.IGNORECASE),
    re.compile(r"transcriber'?s? note", re.IGNORECASE),    # "Transcriber's Note"
    # "Produced by <Name>" only when accompanied by a credit-line tell.
    # Allow the period after the name (e.g. "Produced by Col Choat. HTML version by Al Haines.")
    re.compile(r"produced by .{0,40}?(?:HTML version|Distributed Proofread|"
               r"online distributed|anonymous Project Gutenberg|Gutenberg volunteer)", re.IGNORECASE),
]

# The bare word "transcribers" inside prose (e.g. "ignorance of transcribers")
# is NOT a transcriber's-note; only flag the note form above. So we do NOT add a
# bare \btranscriber rule here.


def is_genuine_boilerplate(snippet: str, pattern: str) -> bool:
    for g in GENUINE_BOILERPLATE:
        if g.search(snippet):
            return True
    return False


def check_boilerplate(work_dir: Path):
    """Returns (body_hits, frontmatter_hits).

    body_hits  = boilerplate inside the actual chapter prose (the real defect).
    frontmatter_hits = boilerplate inside the YAML metadata block (e.g. the
                       source_url and 'translator: Project Gutenberg edition'
                       attribution lines), reported separately because those are
                       expected metadata, not body contamination.
    """
    body_hits = []
    fm_hits = []
    for chapter_dir in sorted((work_dir / "chapters").glob("*")):
        if not chapter_dir.is_dir():
            continue
        body = chapter_body_path(chapter_dir)
        if body is None:
            continue
        text = body.read_text(encoding="utf-8")
        fm_text, body_text, line_offset = split_frontmatter(text)

        for pat in BOILERPLATE_PATTERNS:
            # Body hits (candidate defects)
            for m in pat.finditer(body_text):
                line_no = body_text.count("\n", 0, m.start()) + 1 + line_offset
                snippet = body_text[max(0, m.start() - 40): m.start() + 60].replace("\n", " ")
                genuine = is_genuine_boilerplate(snippet, pat.pattern)
                body_hits.append({
                    "chapter": chapter_dir.name, "file": body.name,
                    "pattern": pat.pattern, "line": line_no, "snippet": snippet.strip(),
                    "genuine": genuine,
                })
            # Frontmatter hits (metadata, informational)
            for m in pat.finditer(fm_text):
                line_no = fm_text.count("\n", 0, m.start()) + 1
                snippet = fm_text[max(0, m.start() - 30): m.start() + 50].replace("\n", " ")
                fm_hits.append({
                    "chapter": chapter_dir.name, "file": body.name,
                    "pattern": pat.pattern, "line": line_no, "snippet": snippet.strip(),
                })
    return body_hits, fm_hits


# ---------------------------------------------------------------------------
# Check 3: raw markup leak
# ---------------------------------------------------------------------------

# '<' that looks like an HTML/XML tag (not a comparison operator surrounded by spaces/digits)
TAG_RE = re.compile(r"<\s*/?[a-zA-Z!][^>]{0,80}>")
# runs of 3+ underscores (markdown rule leaks / OCR artifacts)
UNDERSCORE_RUN_RE = re.compile(r"_{3,}")
PG_BRACKET_RE = re.compile(r"\[Pg", re.IGNORECASE)
FOOTNOTE_RE = re.compile(r"\[Footnote", re.IGNORECASE)
ILLUSTRATION_RE = re.compile(r"\[Illustration", re.IGNORECASE)
# 3+ consecutive blank-ish lines (lines that are empty or only whitespace/punctuation noise)
BLANK_RUN_RE = re.compile(r"(?:^[ \t]*\n){3,}", re.MULTILINE)


def check_markup_leak(work_dir: Path):
    findings = {
        "html_tags": [],
        "underscore_runs": [],
        "pg_bracket": [],
        "footnote": [],
        "illustration": [],
        "blank_runs": [],
    }
    for chapter_dir in sorted((work_dir / "chapters").glob("*")):
        if not chapter_dir.is_dir():
            continue
        body = chapter_body_path(chapter_dir)
        if body is None:
            continue
        raw = body.read_text(encoding="utf-8")
        _fm, text, line_offset = split_frontmatter(raw)

        def record(bucket, pat_iter, kind):
            for m in pat_iter:
                line_no = text.count("\n", 0, m.start()) + 1 + line_offset
                snip = text[max(0, m.start() - 20): m.start() + 40].replace("\n", "\\n")
                findings[bucket].append({
                    "chapter": chapter_dir.name, "file": body.name,
                    "line": line_no, "snippet": snip.strip(),
                })

        record("html_tags", TAG_RE.finditer(text), "tag")
        record("underscore_runs", UNDERSCORE_RUN_RE.finditer(text), "underscore")
        record("pg_bracket", PG_BRACKET_RE.finditer(text), "pg")
        record("footnote", FOOTNOTE_RE.finditer(text), "footnote")
        record("illustration", ILLUSTRATION_RE.finditer(text), "illustration")
        record("blank_runs", BLANK_RUN_RE.finditer(text), "blank")
    return findings


# ---------------------------------------------------------------------------
# Check 2 + 4: chapterization + structural completeness
# ---------------------------------------------------------------------------

def analyze_work(work_dir: Path):
    index_md = work_dir / "index.md"
    fm = read_frontmatter(index_md)
    chapters = []
    structural_problems = []

    if not index_md.exists():
        structural_problems.append("MISSING index.md")

    chap_dirs = sorted([d for d in (work_dir / "chapters").glob("*") if d.is_dir()])
    for cd in chap_dirs:
        body = chapter_body_path(cd)
        cmeta_path = cd / "meta.json"
        chap = {"slug": cd.name, "word_count": 0, "para_count": 0}

        if not cmeta_path.exists():
            structural_problems.append(f"{cd.name}: MISSING chapter meta.json")
        if body is None:
            structural_problems.append(f"{cd.name}: MISSING body (translation.md/original.md)")
            chapters.append(chap)
            continue

        body_text = body.read_text(encoding="utf-8")
        # word_count from frontmatter (chapter meta variants) if available, else computed
        wc_meta = None
        if cmeta_path.exists():
            try:
                cmeta = json.loads(cmeta_path.read_text(encoding="utf-8"))
                for v in cmeta.get("variants", []):
                    if v.get("file") == body.name:
                        wc_meta = v.get("word_count")
                        break
            except Exception:
                pass
        wc_computed = word_count_text(body_text)
        wc = wc_meta if wc_meta is not None else wc_computed
        chap["word_count"] = wc
        chap["word_count_meta"] = wc_meta
        chap["word_count_computed"] = wc_computed

        if wc is not None and wc <= 100:
            structural_problems.append(f"{cd.name}: word_count {wc} <= 100")

        # paragraphs json
        pjson = chapter_para_json_path(cd, body)
        if pjson is None:
            structural_problems.append(f"{cd.name}: MISSING matching .paragraphs.json for {body.name}")
        else:
            try:
                pdata = json.loads(pjson.read_text(encoding="utf-8"))
                if isinstance(pdata, dict):
                    paras = pdata.get("paragraphs", pdata.get("data", []))
                elif isinstance(pdata, list):
                    paras = pdata
                else:
                    paras = []
                chap["para_count"] = len(paras)
                if len(paras) == 0:
                    structural_problems.append(f"{cd.name}: paragraphs.json has 0 paragraphs")
            except Exception as e:
                structural_problems.append(f"{cd.name}: paragraphs.json unparseable ({e})")
        chapters.append(chap)

    return fm, chapters, structural_problems


# ---------------------------------------------------------------------------
# Check 5: spot-read famous works
# ---------------------------------------------------------------------------

# pats = [author_regex, title_regex, exclude_regex_or_None]
# Prefer English editions; exclude the German Kant/Nietzsche editions.
FAMOUS = {
    "Machiavelli — The Prince": [r"machiavelli", r"the-prince", None],
    "Kant — Critique of Pure Reason": [r"kant", r"critique.*pure.reason", r"-germ-"],
    "Hume — Treatise of Human Nature": [r"hume", r"treatise-of-human-nature", None],
    "Mill — On Liberty": [r"john-stuart-mill", r"on-liberty", None],
    "Nietzsche — Beyond Good and Evil": [r"nietzsche", r"beyond-good-and-evil", r"german"],
    "Spinoza — Ethics": [r"spinoza", r"-ethics-", None],
}


def first_n_words(work_dir: Path, n=200):
    """Concatenate chapter bodies in order until we have n words; return text."""
    chap_dirs = sorted([d for d in (work_dir / "chapters").glob("*") if d.is_dir()])
    out = []
    count = 0
    used_chapter = None
    for cd in chap_dirs:
        body = chapter_body_path(cd)
        if body is None:
            continue
        raw = body.read_text(encoding="utf-8")
        _fm, text, _off = split_frontmatter(raw)  # body only, no YAML
        if used_chapter is None:
            used_chapter = cd.name
        words = re.findall(r"\S+", text)
        out.extend(words)
        count += len(words)
        if count >= n:
            break
    return " ".join(out[:n]), used_chapter


def find_famous(works):
    matches = {}
    for label, pats in FAMOUS.items():
        author_pat = re.compile(pats[0], re.IGNORECASE)
        title_pat = re.compile(pats[1], re.IGNORECASE)
        exclude_pat = re.compile(pats[2], re.IGNORECASE) if pats[2] else None
        best = None
        for w in works:
            slug = w.name.lower()
            if exclude_pat and exclude_pat.search(slug):
                continue
            if author_pat.search(slug) and title_pat.search(slug):
                best = w
                break
        matches[label] = best
    return matches


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    works = discover_works()
    print(f"# Gutenberg works discovered: {len(works)}\n")

    # ---- Check 1: boilerplate ----
    print("=" * 70)
    print("CHECK 1 — PG BOILERPLATE")
    print("=" * 70)
    print("(Frontmatter metadata hits — source_url + 'translator: Project Gutenberg")
    print(" edition' — are reported separately; only BODY hits are true defects.)\n")
    total_genuine = 0
    genuine_works = set()
    total_innocent = 0
    total_fm_hits = 0
    fm_works = 0
    innocent_pattern_counts = {}
    for w in works:
        body_hits, fm_hits = check_boilerplate(w)
        if fm_hits:
            fm_works += 1
            total_fm_hits += len(fm_hits)
        genuine = [h for h in body_hits if h["genuine"]]
        innocent = [h for h in body_hits if not h["genuine"]]
        for h in innocent:
            innocent_pattern_counts[h["pattern"]] = innocent_pattern_counts.get(h["pattern"], 0) + 1
        total_innocent += len(innocent)
        if genuine:
            genuine_works.add(w.name)
            total_genuine += len(genuine)
            print(f"[GENUINE BOILERPLATE] {w.name} — {len(genuine)} hit(s)")
            for h in genuine:
                print(f"    {h['chapter']}/{h['file']}:{h['line']} /{h['pattern']}/  …{h['snippet']}…")
            print()
    print(f"\nGENUINE body boilerplate (PG credits / transcriber notes / start-end markers):")
    print(f"   {total_genuine} hit(s) across {len(genuine_works)} work(s).")
    print(f"Innocent prose phrase matches (mostly 'produced by' inside real sentences): "
          f"{total_innocent} (NOT defects).")
    if innocent_pattern_counts:
        print("   innocent breakdown by pattern: " +
              ", ".join(f"{p}={c}" for p, c in innocent_pattern_counts.items()))
    print(f"Frontmatter metadata 'Project Gutenberg' attribution lines: "
          f"{total_fm_hits} across {fm_works} works (expected source attribution, informational).")
    if total_genuine == 0:
        print("RESULT: PASS — no genuine boilerplate in any chapter BODY across all 85 works.")
    else:
        print(f"RESULT: FAIL — genuine body boilerplate in {len(genuine_works)} work(s) (see above).")

    # ---- Check 2 + 4: chapterization + structural ----
    print("\n" + "=" * 70)
    print("CHECK 2 — CHAPTERIZATION SANITY")
    print("=" * 70)
    work_stats = []
    all_structural = {}
    for w in works:
        fm, chapters, problems = analyze_work(w)
        wcs = [c["word_count"] for c in chapters if c["word_count"]]
        total_words = sum(wcs)
        median_wc = statistics.median(wcs) if wcs else 0
        work_stats.append({
            "slug": w.name,
            "n_chapters": len(chapters),
            "total_words": total_words,
            "median_wc": median_wc,
            "chapters": chapters,
            "fm": fm,
        })
        if problems:
            all_structural[w.name] = problems

    # Top 10 by chapter count
    print("\nTop 10 works by chapter count:")
    for s in sorted(work_stats, key=lambda x: -x["n_chapters"])[:10]:
        print(f"   {s['n_chapters']:4d} chapters | {s['total_words']:>8,} words | {s['slug']}")

    # Single-chapter works over 60k words
    print("\nSingle-chapter works over 60k words (acceptable fallback, listed):")
    single_big = [s for s in work_stats if s["n_chapters"] == 1 and s["total_words"] > 60000]
    if not single_big:
        print("   (none)")
    for s in single_big:
        print(f"   {s['total_words']:>8,} words | {s['slug']}")

    # Also list ALL single-chapter works for context (any size) since they are fallbacks
    singles = [s for s in work_stats if s["n_chapters"] == 1]
    print(f"\nAll single-chapter works (n={len(singles)}):")
    for s in sorted(singles, key=lambda x: -x["total_words"]):
        flag = "  <-- >60k" if s["total_words"] > 60000 else ""
        print(f"   {s['total_words']:>8,} words | {s['slug']}{flag}")

    # Suspiciously tiny: median < 80 words with >5 chapters
    print("\nSuspiciously tiny works (median chapter < 80 words AND > 5 chapters):")
    tiny = [s for s in work_stats if s["n_chapters"] > 5 and s["median_wc"] < 80]
    if not tiny:
        print("   (none)")
    for s in tiny:
        print(f"   median {s['median_wc']:.0f}w | {s['n_chapters']} chapters | {s['slug']}")

    # ---- Check 3: markup leak ----
    print("\n" + "=" * 70)
    print("CHECK 3 — RAW MARKUP LEAK")
    print("=" * 70)
    leak_totals = {k: 0 for k in
                   ["html_tags", "underscore_runs", "pg_bracket", "footnote", "illustration", "blank_runs"]}
    leak_by_work = {}
    for w in works:
        f = check_markup_leak(w)
        counts = {k: len(v) for k, v in f.items()}
        if any(counts.values()):
            leak_by_work[w.name] = (counts, f)
        for k, v in counts.items():
            leak_totals[k] += v
    print("\nLeak totals across all works:")
    for k, v in leak_totals.items():
        print(f"   {k:16s}: {v}")
    if any(leak_totals.values()):
        print("\nPer-work leak detail (with sample snippets):")
        for slug, (counts, f) in sorted(leak_by_work.items(), key=lambda x: -sum(x[1][0].values())):
            nonzero = {k: c for k, c in counts.items() if c}
            print(f"\n[{slug}] {nonzero}")
            for k, c in nonzero.items():
                for item in f[k][:3]:
                    print(f"    {k}: {item['chapter']}/{item['file']}:{item['line']}  '{item['snippet']}'")
    else:
        print("PASS — no markup leaks of any category.")

    # ---- Check 4 summary ----
    print("\n" + "=" * 70)
    print("CHECK 4 — STRUCTURAL COMPLETENESS")
    print("=" * 70)
    print("Required per work: index.md present; each chapter has a body + matching")
    print(".paragraphs.json with >0 paragraphs; chapter word_count > 100.")
    if not all_structural:
        print("\nPASS — all 85 works structurally complete.")
    else:
        print(f"\n{len(all_structural)} work(s) with structural problems:")
        for slug, probs in all_structural.items():
            print(f"\n[{slug}]")
            for p in probs[:15]:
                print(f"    - {p}")
            if len(probs) > 15:
                print(f"    … and {len(probs) - 15} more")

    # Also verify index.md frontmatter sanity (every work has a genre + title)
    print("\nIndex.md frontmatter spot-check (genre/title present):")
    fm_problems = []
    for s in work_stats:
        if not s["fm"].get("genre") or not s["fm"].get("title"):
            fm_problems.append(s["slug"])
    if not fm_problems:
        print("   PASS — every work has genre + title in frontmatter.")
    else:
        for slug in fm_problems:
            print(f"   [FAIL] {slug}")

    # ---- Check 5: famous works spot-read ----
    print("\n" + "=" * 70)
    print("CHECK 5 — SPOT-READ OPENING 200 WORDS OF 6 FAMOUS WORKS")
    print("=" * 70)
    famous = find_famous(works)
    for label, w in famous.items():
        print(f"\n--- {label} ---")
        if w is None:
            print("   [NOT FOUND in Gutenberg set]")
            continue
        text, chap = first_n_words(w, 200)
        print(f"   work: {w.name}")
        print(f"   first body chapter: {chap}")
        print(f"   opening 200 words:\n")
        # wrap for readability
        words = text.split()
        line = "   "
        for word in words:
            if len(line) + len(word) + 1 > 95:
                print(line)
                line = "   "
            line += word + " "
        if line.strip():
            print(line)

    print("\n" + "=" * 70)
    print("END OF AUDIT")
    print("=" * 70)


if __name__ == "__main__":
    main()
