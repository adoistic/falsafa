import { describe, expect, test } from "bun:test";
import { computeMechanicalResult } from "../build-eval-json.ts";

describe("computeMechanicalResult — fractional graded scoring", () => {
  test("vacuous pass when expected_works is empty", () => {
    const r = computeMechanicalResult({
      answer: "anything",
      expected_works: [],
      citations: [],
    });
    expect(r.score).toBe(1.0);
    expect(r.pass_loose).toBe(true);
    expect(r.pass_strict_raw).toBe(true);
    expect(r.pass).toBe(true);
  });

  test("all expected cited → score=1.0, strict=true", () => {
    const r = computeMechanicalResult({
      answer: "The manusmrti and yajnavalkya-smrti both address dharma [p-aaa111] [p-bbb222].",
      expected_works: ["manusmrti", "yajnavalkya-smrti"],
      citations: [
        { work_slug: "manusmrti", chapter_number: 1, paragraph_id: "p-aaa111" },
        { work_slug: "yajnavalkya-smrti", chapter_number: 2, paragraph_id: "p-bbb222" },
      ],
    });
    expect(r.score).toBe(1.0);
    expect(r.pass_strict_raw).toBe(true);
    expect(r.pass_loose).toBe(true);
  });

  test("partial citations (3 of 6) → score=0.5", () => {
    const r = computeMechanicalResult({
      answer: "The manusmrti, yajnavalkya-smrti, vishnu-smrti, narada-smrti, brihaspati-smrti, and parashara-smrti all address this — citing [p-aaa111] [p-bbb222] [p-ccc333].",
      expected_works: ["manusmrti", "yajnavalkya-smrti", "vishnu-smrti", "narada-smrti", "brihaspati-smrti", "parashara-smrti"],
      citations: [
        { work_slug: "manusmrti", chapter_number: 1, paragraph_id: "p-aaa111" },
        { work_slug: "yajnavalkya-smrti", chapter_number: 2, paragraph_id: "p-bbb222" },
        { work_slug: "vishnu-smrti", chapter_number: 1, paragraph_id: "p-ccc333" },
      ],
    });
    expect(r.score).toBe(0.5);          // 3 of 6 cited
    expect(r.pass_strict_raw).toBe(false);
    expect(r.pass_loose).toBe(true);    // all 6 slug names appear in prose
  });

  test("none cited but all named in prose → score=0, pass_loose=true", () => {
    const r = computeMechanicalResult({
      answer: "The manusmrti and yajnavalkya-smrti both discuss dharma.",
      expected_works: ["manusmrti", "yajnavalkya-smrti"],
      citations: [],
    });
    expect(r.score).toBe(0.0);
    expect(r.pass_strict_raw).toBe(false);
    expect(r.pass_loose).toBe(true);
  });

  test("zero matches anywhere → score=0, all pass=false", () => {
    const r = computeMechanicalResult({
      answer: "Something completely off-topic.",
      expected_works: ["manusmrti"],
      citations: [],
    });
    expect(r.score).toBe(0.0);
    expect(r.pass_loose).toBe(false);
    expect(r.pass_strict_raw).toBe(false);
  });

  test("hallucinated citations (model cited works it shouldn't) don't pad the score", () => {
    const r = computeMechanicalResult({
      answer: "[p-zzz999]",
      expected_works: ["manusmrti"],
      citations: [
        // Model cited Yajnavalkya, but expected was Manusmriti
        { work_slug: "yajnavalkya-smrti", chapter_number: 1, paragraph_id: "p-zzz999" },
      ],
    });
    expect(r.score).toBe(0.0);          // 0 of 1 expected cited
    expect(r.pass_strict_raw).toBe(false);
  });

  test("audit overlay accepts alternative work_slug → pass_strict_audited=true", () => {
    const r = computeMechanicalResult({
      answer: "[p-zzz999]",
      expected_works: ["manusmrti"],
      citations: [
        { work_slug: "yajnavalkya-smrti", chapter_number: 1, paragraph_id: "p-zzz999" },
      ],
      auditOverlay: {
        // For this case, auditor decided Yajnavalkya counts as alternative
        decisions: { "q-test": { verdict: "valid_alternative", acceptable_alternatives: [["yajnavalkya-smrti"]] } },
      },
      caseId: "q-test",
    });
    expect(r.pass_strict_raw).toBe(false);
    expect(r.pass_strict_audited).toBe(true);
  });

  test("audit overlay without matching case → audited === raw", () => {
    const r = computeMechanicalResult({
      answer: "Manu says [p-aaa111].",
      expected_works: ["manusmrti"],
      citations: [{ work_slug: "manusmrti", chapter_number: 1, paragraph_id: "p-aaa111" }],
      auditOverlay: { decisions: {} },
      caseId: "q-no-decision",
    });
    expect(r.pass_strict_raw).toBe(true);
    expect(r.pass_strict_audited).toBe(true);
  });
});
