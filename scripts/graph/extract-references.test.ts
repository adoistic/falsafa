import { describe, expect, test } from "bun:test";
import { validateRawReferences } from "./extract-references";
import type { RawReference } from "./types";

const rec = (p: string): RawReference => ({
  citing_work_slug: "parasara", citing_paragraph_id: p, raw_target: "Manu",
  target_kind: "author", stance: "authority", quote: "thus has Manu declared",
});

describe("validateRawReferences", () => {
  test("keeps records with real paragraph ids, drops the rest", () => {
    const real = new Set(["p-8991a9"]);
    const { kept, dropped } = validateRawReferences([rec("p-8991a9"), rec("p-deadbe")], real);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(kept[0]!.citing_paragraph_id).toBe("p-8991a9");
  });
});
