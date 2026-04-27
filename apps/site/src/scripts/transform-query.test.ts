import { describe, it, expect } from "bun:test";
import { transformQuery } from "./transform-query.ts";

describe("transformQuery", () => {
  it("empty input returns empty groups + strategies", () => {
    const r = transformQuery("");
    expect(r.groups).toEqual([]);
    expect(r.strategies).toEqual([]);
    expect(r.tokens).toEqual([]);
  });

  it("whitespace-only input returns empty", () => {
    const r = transformQuery("   ");
    expect(r.groups).toEqual([]);
    expect(r.strategies).toEqual([]);
  });

  it("single token: exact + wildcard fallback", () => {
    const r = transformQuery("courage");
    expect(r.groups).toEqual([["courage"]]);
    expect(r.strategies).toEqual(["courage", "courage*"]);
    expect(r.tokens).toEqual(["courage"]);
  });

  it("multi-token AND (no comma): single group, exact + wildcard", () => {
    const r = transformQuery("dharma courage");
    expect(r.groups).toEqual([["dharma", "courage"]]);
    expect(r.strategies).toEqual(["dharma courage", "dharma* courage*"]);
  });

  it("comma-separated: returns multiple groups for runner fan-out", () => {
    const r = transformQuery("dharma, courage");
    expect(r.groups).toEqual([["dharma"], ["courage"]]);
    expect(r.strategies).toEqual([]); // runner uses .groups, not .strategies
    expect(r.tokens).toEqual(["dharma", "courage"]);
  });

  it("comma + extra whitespace tolerated", () => {
    const r = transformQuery("  dharma  ,  courage   ");
    expect(r.groups).toEqual([["dharma"], ["courage"]]);
  });

  it("trailing comma drops empty group", () => {
    const r = transformQuery("dharma,");
    expect(r.groups).toEqual([["dharma"]]);
    expect(r.strategies).toEqual(["dharma", "dharma*"]);
  });

  it("comma-AND mix: 'dharma yoga, courage' → two groups, first multi-token", () => {
    const r = transformQuery("dharma yoga, courage");
    expect(r.groups).toEqual([["dharma", "yoga"], ["courage"]]);
    expect(r.tokens).toEqual(["dharma", "yoga", "courage"]);
  });

  it("does not double-wildcard already-wildcarded terms", () => {
    const r = transformQuery("cour*");
    expect(r.strategies).toEqual(["cour*"]); // wildcard variant identical → only one
  });

  it("preserves quoted phrases through the strategy chain", () => {
    // The naive tokenizer splits on whitespace, so "divine love" becomes
    // two tokens: '"divine' and 'love"'. The exact strategy rejoins with
    // a space, recovering the original phrase. The wildcard strategy
    // skips terms starting with '"' so we don't poison phrase queries
    // with stray asterisks.
    const r = transformQuery('"divine love"');
    expect(r.strategies[0]).toEqual('"divine love"');
    // Wildcard strategy: '"divine' starts with `"`, skip; 'love"' doesn't,
    // so it gets a `*`. This is wonky but preserved as the documented
    // behavior; phrase-aware tokenizing is a follow-up if we ship quoted
    // phrases as a first-class feature.
    expect(r.strategies[1]).toEqual('"divine love"*');
  });

  it("preserves token case in tokens (used for snippet highlight)", () => {
    const r = transformQuery("Dharma");
    expect(r.tokens).toEqual(["Dharma"]);
    expect(r.strategies).toEqual(["Dharma", "Dharma*"]);
  });
});
