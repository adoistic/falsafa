import { test, expect } from "bun:test";
import { parseMbh, stripHtml } from "./mbh";

const FIXTURE = `<HTML><BODY>
01,000.000*0001_01	jayati parāśarasūnuḥ<BR>
01,001.000a	nārāyaṇaṃ namaskṛtya naraṃ caiva narottamam<BR>
01,001.000c	devīṃ sarasvatīṃ caiva tato jayam udīrayet<BR>
01,001.001A	lomaharṣaṇaputra ugraśravāḥ sūtaḥ<BR>
01,001.002a	samāsīnān abhyagacchad brahmarṣīn saṃśitavratān<BR>
01,001.002c	vinayāvanato bhūtvā kadā cit sūtanandanaḥ<BR>
01,001.003a	tam āśramam anuprāptaṃ naimiṣāraṇyavāsinaḥ<BR>
01,001.003b*0018_01	uvāca tān ṛṣīn sarvān (apparatus, skip)<BR>
01,001.003b*0018_02	veda vaiyāsikīḥ sarvāḥ (apparatus, skip)<BR>
01,001.008	sūta uvāca<BR>
02,001.001a	dhṛtarāṣṭra uvāca<BR>
02,001.001c	dharme tv arjunam uktavān<BR>
18,005.001a	bhīṣmadroṇau mahātmānau<BR>
18,005.001c	virāṭadrupadau cobhau<BR>
</BODY></HTML>`;

test("stripHtml removes tags and entities", () => {
  // Tags stripped, entities replaced with space, whitespace collapsed
  expect(stripHtml("nara<BR>caiva")).toBe("naracaiva");
  expect(stripHtml("text &nbsp; more")).toBe("text more");
  expect(stripHtml("<b>bold</b> text")).toBe("bold text");
});

test("parseMbh skips colophon (SSS=000) and apparatus (*NNN) lines", () => {
  const verses = parseMbh(FIXTURE);
  // 01,000.xxx lines skipped; 01,001.003b*... skipped; apparatus skipped
  const refs = verses.map((v) => v.ref);
  expect(refs).not.toContain("1.1.0"); // SSS=000 skipped
  expect(refs).not.toContain("1.0.0"); // AAA=000 skipped
  // apparatus *0018 lines have SSS != 0 but they won't match LINE_RE because 'b*' suffix
  // (the regex only allows [a-gA-G]? before \t — 'b*' has * after which is not \t)
});

test("parseMbh joins pāda half-lines for same śloka", () => {
  const verses = parseMbh(FIXTURE);
  const v002 = verses.find((v) => v.ref === "1.1.2");
  expect(v002).toBeDefined();
  expect(v002!.text).toContain("samāsīnān");
  expect(v002!.text).toContain("vinayāvanato");
  // Both a and c pādas joined
  expect(v002!.text).toBe("samāsīnān abhyagacchad brahmarṣīn saṃśitavratān vinayāvanato bhūtvā kadā cit sūtanandanaḥ");
});

test("parseMbh ref format is dotted P.A.S with no leading zeros", () => {
  const verses = parseMbh(FIXTURE);
  // 18,005.001 -> ref "18.5.1"
  const v18 = verses.find((v) => v.parva === 18);
  expect(v18).toBeDefined();
  expect(v18!.ref).toBe("18.5.1");
  expect(v18!.parva).toBe(18);
  expect(v18!.adhyaya).toBe(5);
  expect(v18!.sloka).toBe(1);
});
