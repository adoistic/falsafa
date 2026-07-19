#!/usr/bin/env python3
"""
apply-review — fold the category reviewers' proposals into concordance.json.

Reads results/*.json (one per kind, {"clusters":[{head,members,why}],
"junk":[...], "uncertain":[...]}), validates each proposal against the
current entity index and the `never` guard list, and appends the survivors
to scripts/atlas/concordance.json:

  - clusters: members normed; head kept only if it (or a member promotable
    to head) exists in the index; guard-pair violations dropped loudly.
  - junk: appended to concordance.junk (synthesize demotes these from
    page-worthiness; the data stays, the noise pages go).
  - uncertain: printed for the human, never applied.

Idempotent: re-running dedupes. The concordance stays the single auditable
authority file.
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONC = ROOT / "scripts/atlas/concordance.json"
IDX = ROOT / "corpus/graph/atlas/entities-index.json"
RESULTS = Path(
    "/private/tmp/claude-501/-Users-siraj-falsafa/92bdb1c9-2ac7-4ee0-90d4-1852e738c1e3/scratchpad/entity-review/results"
)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


conc = json.loads(CONC.read_text())
idx = json.loads(IDX.read_text())
by_kind_norm = {}
for e in idx:
    if e.get("see"):
        continue
    by_kind_norm.setdefault(e["kind"], {}).setdefault(norm(e["name"]), e)

never = {tuple(sorted(p)) for p in conc.get("never", [])}


def guarded(kind: str, a: str, b: str) -> bool:
    return tuple(sorted([f"{kind}|{a}", f"{kind}|{b}"])) in never


conc.setdefault("clusters", {})
conc.setdefault("junk", {})

added_clusters = 0
added_members = 0
added_junk = 0
dropped = []

for f in sorted(RESULTS.glob("*.json")):
    kind = f.stem
    try:
        r = json.loads(f.read_text())
    except Exception as ex:
        print(f"!! {kind}: unreadable result ({ex})", file=sys.stderr)
        continue
    known = by_kind_norm.get(kind, {})
    existing = conc["clusters"].setdefault(kind, [])
    have_heads = {norm(g["head"]): g for g in existing}

    for c in r.get("clusters", []):
        head_n = norm(c.get("head", ""))
        members = [norm(m) for m in c.get("members", []) if norm(m) and norm(m) != head_n]
        if not head_n or not members:
            continue
        # head must exist (as a live entity) — else promote the largest member
        if head_n not in known:
            live = [m for m in members if m in known]
            if not live:
                dropped.append((kind, c["head"], "no live head/members"))
                continue
            promoted = max(live, key=lambda m: known[m]["works"])
            members = [m for m in members + [head_n] if m != promoted]
            head_n = promoted
        # guard check + drop unknown members (they may appear as harvest grows —
        # keep them: concordance members are norms, harmless if absent)
        ok_members = []
        for m in members:
            if guarded(kind, head_n, m):
                dropped.append((kind, f"{c['head']} ← {m}", "guard pair"))
                continue
            ok_members.append(m)
        if not ok_members:
            continue
        g = have_heads.get(head_n)
        if g is None:
            g = {"head": head_n, "members": []}
            existing.append(g)
            have_heads[head_n] = g
            added_clusters += 1
        before = set(g["members"])
        for m in ok_members:
            if m not in before:
                g["members"].append(m)
                added_members += 1

    junk_list = conc["junk"].setdefault(kind, [])
    jset = set(junk_list)
    for j in r.get("junk", []):
        jn = norm(j)
        if jn and jn not in jset:
            junk_list.append(jn)
            jset.add(jn)
            added_junk += 1

    unc = r.get("uncertain", [])
    if unc:
        print(f"   {kind}: uncertain (left alone): {', '.join(unc[:10])}")

CONC.write_text(json.dumps(conc, ensure_ascii=False, indent=2) + "\n")
print(
    f"\napplied: +{added_clusters} clusters, +{added_members} members, +{added_junk} junk flags"
)
for k, what, why in dropped[:20]:
    print(f"   dropped [{k}] {what} — {why}")
