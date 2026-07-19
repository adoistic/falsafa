#!/usr/bin/env python3
"""
analyze-duplication — go and see every category.

Scans the merged entity index (corpus/graph/atlas/entities-index.json) and
reports, per kind, the duplication patterns the surface-string merge cannot
see:

  1. GLOSS COLLISIONS — "Alethes (truth)" vs "Truth"; "Truth (Satya)" vs
     "Satya": the harvester's own parenthetical glosses declare equivalences
     the merge ignored. These are deterministic cluster candidates.
  2. THE-PREFIX      — "the soul" vs "Soul".
  3. PLURAL VARIANTS — "Cow" vs "Cows"; "law" vs "laws".
  4. COMPOUNDS       — "Zeus and the gods": noise entities.
  5. EPITHET FORMS   — figures: "Zeus the Liberator" where "Zeus" exists.
  6. CASE TWINS      — same norm, different kinds (legit, listed FYI).

Output: a per-kind report + machine-readable candidate file
(corpus/graph/atlas/duplication-report.json) that seeds the concordance and
the subagent review prompts.
"""

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IDX = ROOT / "corpus/graph/atlas/entities-index.json"
OUT = ROOT / "corpus/graph/atlas/duplication-report.json"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def stem(n: str) -> str:
    """very conservative singular fold: only trailing -s / -es on the last word."""
    words = n.split(" ")
    w = words[-1]
    if len(w) > 3 and w.endswith("es") and not w.endswith("ses"):
        w2 = w[:-2]
    elif len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        w2 = w[:-1]
    else:
        w2 = w
    return " ".join(words[:-1] + [w2])


entities = json.loads(IDX.read_text())
by_kind = defaultdict(list)
for e in entities:
    by_kind[e["kind"]].append(e)

report = {}
PAREN = re.compile(r"^(.*?)\s*\(([^)]{2,40})\)\s*$")

for kind, rows in sorted(by_kind.items()):
    norm_to = {}
    for e in rows:
        norm_to.setdefault(norm(e["name"]), e)

    gloss_hits = []      # (entity, base, gloss, collides_with)
    the_hits = []        # ("the X", "X")
    plural_hits = []     # ("Cows", "Cow")
    compound_hits = []   # "X and Y"
    epithet_hits = []    # figures: "Zeus the Liberator" -> "Zeus"

    for e in rows:
        name = e["name"]
        n = norm(name)

        m = PAREN.match(name)
        if m:
            base, gloss = m.group(1).strip(), m.group(2).strip()
            nb, ng = norm(base), norm(gloss)
            target = None
            if ng in norm_to and norm_to[ng] is not e:
                target = norm_to[ng]["name"]
            elif nb in norm_to and norm_to[nb] is not e:
                target = norm_to[nb]["name"]
            gloss_hits.append(
                {"name": name, "base": base, "gloss": gloss,
                 "collides_with": target, "works": e["works"], "page": e["page"]}
            )

        if n.startswith("the ") and n[4:] in norm_to and norm_to[n[4:]] is not e:
            the_hits.append({"name": name, "target": norm_to[n[4:]]["name"]})

        st = stem(n)
        if st != n and st in norm_to and norm_to[st] is not e:
            plural_hits.append({"name": name, "target": norm_to[st]["name"]})

        if re.search(r"\b(and|&)\b", n) and e["works"] <= 2:
            compound_hits.append({"name": name, "works": e["works"]})

        if kind == "figure":
            em = re.match(r"^(.{2,25}?)\s+(the|of)\s+.{2,30}$", name, re.I)
            if em:
                head = norm(em.group(1))
                if head in norm_to and norm_to[head] is not e and norm_to[head]["works"] >= 2:
                    epithet_hits.append({"name": name, "target": norm_to[head]["name"]})

    report[kind] = {
        "total": len(rows),
        "paged": sum(1 for e in rows if e["page"]),
        "gloss_entities": len(gloss_hits),
        "gloss_collisions": [g for g in gloss_hits if g["collides_with"]],
        "the_prefix": the_hits,
        "plural_variants": plural_hits,
        "compounds": compound_hits[:200],
        "compounds_total": len(compound_hits),
        "epithets": epithet_hits[:200],
        "epithets_total": len(epithet_hits),
    }

OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1))

for kind, r in report.items():
    print(f"\n== {kind}: {r['total']} entities ({r['paged']} paged)")
    print(f"   gloss-carrying names: {r['gloss_entities']}  "
          f"| gloss COLLISIONS: {len(r['gloss_collisions'])}  "
          f"| the-prefix: {len(r['the_prefix'])}  "
          f"| plural: {len(r['plural_variants'])}  "
          f"| compounds: {r['compounds_total']}  "
          f"| epithets: {r['epithets_total']}")
    for g in r["gloss_collisions"][:6]:
        print(f"     · {g['name']!r} ↔ {g['collides_with']!r}")
    for t in r["the_prefix"][:3]:
        print(f"     · {t['name']!r} → {t['target']!r}")
    for p in r["plural_variants"][:3]:
        print(f"     · {p['name']!r} → {p['target']!r}")
print(f"\n→ {OUT}")
