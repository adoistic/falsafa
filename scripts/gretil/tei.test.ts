import { test, expect } from "bun:test";
import { cleanLine, chapterize, parseTeiVerses, teiTitle } from "./tei";

const FIXTURE = `<TEI><teiHeader><titleStmt><title>Ṛgveda-Saṃhitā</title></titleStmt>
<sourceDesc><title>Die Hymnen des Rigveda</title></sourceDesc></teiHeader>
<text><body><div>
<div type="maṇḍala" n="1"><div type="sūkta" n="001">
<lg xml:id="RV_1.001.01"><l n="1.001.01a">a<orig>̱</orig>gnim ī<orig>̍</orig>ḻe |</l><l n="1.001.01c">hotā<orig>̍</orig>ram ||</l></lg>
<lg xml:id="RV_1.001.02"><l n="1.001.02a">agniḥ pūrvebhir ||</l></lg>
</div></div>
<div type="maṇḍala" n="2"><div type="sūkta" n="001">
<lg xml:id="RV_2.001.01"><l n="2.001.01a">tvam agne ||</l></lg>
</div></div>
</div></body></text></TEI>`;

test("teiTitle takes the titleStmt title, not the sourceDesc edition title", () => {
  expect(teiTitle(FIXTURE)).toBe("Ṛgveda-Saṃhitā");
});

test("cleanLine unwraps <orig> accents (keeps the mark) and strips tags", () => {
  expect(cleanLine("a<orig>̱</orig>gnim ī<orig>̍</orig>ḻe |")).toBe("a̱gnim ī̍ḻe |");
});

test("parseTeiVerses reads each line's hierarchical ref + pāda", () => {
  const v = parseTeiVerses(FIXTURE);
  expect(v.length).toBe(4);
  expect(v[0]).toMatchObject({ ref: [1, 1, 1], pada: "a" });
  expect(v[1]).toMatchObject({ ref: [1, 1, 1], pada: "c" });
  expect(v[3]).toMatchObject({ ref: [2, 1, 1], pada: "a" });
});

test("chapterize: maṇḍala chapters, verse-level paragraphs with pādas joined", () => {
  const ch = chapterize(parseTeiVerses(FIXTURE), 0, 2);
  expect(ch.length).toBe(2); // two maṇḍalas
  expect(ch[0]!.n).toBe(1);
  expect(ch[0]!.paragraphs.length).toBe(2); // verses 1.001.01 (two pādas) + 1.001.02
  expect(ch[0]!.paragraphs[0]!.ref).toBe("1.1.1");
  expect(ch[0]!.paragraphs[0]!.text).toBe("a̱gnim ī̍ḻe | hotā̍ram ||");
  expect(ch[1]!.paragraphs.length).toBe(1);
});
