/**
 * Unit tests for the TF-IDF cross-link builder.
 *
 * Three guards under test:
 *   1. Empty/short-body chapters land in `skipped_short_chapters` and never
 *      appear in `links` — protects the index from noise.
 *   2. A chapter never appears in its own related list (self-exclusion).
 *   3. Two builds with identical input + the same `generatedAt` produce
 *      byte-identical serialized output — the script is deterministic so the
 *      cross-links.json file diff is meaningful in code review.
 */

import { describe, expect, test } from "bun:test";
import {
  buildIndex,
  serializeIndex,
  tokenize,
  MIN_TOKENS,
  type BuildInput,
} from "./cross-link.ts";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

/**
 * Two long-ish prose passages with shared distinctive vocabulary
 * (sword, warrior, battle, chariot, helmet, shield) — these should rank
 * as each other's strongest match in a TF-IDF index where most other
 * documents are about unrelated topics (oceans, gardens, music, etc.).
 *
 * IDF is meaningful only when distinctive terms are RARE across the
 * corpus, so we need a fixture with ~10 documents to get realistic
 * dynamics. Each test document is at least MIN_TOKENS (50) after
 * stopword filtering.
 */
const COURAGE_BODY = `
Courage is the first quality which guarantees all others. The
brave warrior confronts danger without flinching, faces battle
without fear. In ancient wars the warriors gathered before dawn,
sharpening swords, polishing shields, fastening helmets. Courage
carried them across rivers, courage held the line when chariots
charged, courage brought them home with songs of triumph. The
chronicles tell of kings whose courage shaped nations, of soldiers
whose courage saved cities, of poets whose courage spoke truth to
tyrants. To be without courage is to be without virtue. To possess
courage is to possess the seed of every excellence praised across
centuries. Courage and prudence walk together. Courage and justice
defend the city. Courage and temperance build the noble soul.
`.repeat(2);

const COURAGE_BODY_2 = `
Brave warriors face battle without flinching. The path of duty calls
them across rivers. Their swords are sharp, shields polished, helmets
fastened. The brave hold the line. The brave defend cities when
chariots come. Songs of triumph fill the night. The chronicles tell
of kings whose courage shaped nations, of poets whose courage spoke
truth to tyrants. Without courage virtue cannot stand. With courage
the seed of every excellence takes root. Courage and prudence walk
together. Courage and justice defend cities. Courage and temperance
build the soul. The philosophers across centuries have placed courage
near the head of the virtues. Brave warriors carry triumph across
rivers of fear toward the dawn.
`.repeat(2);

/** Filler documents — distinct vocabulary so TF-IDF for COURAGE terms stays high. */
const FILLER_BODIES = [
  `The garden bloomed with roses and lilies. Bees hummed among
   blossoms. Children played beneath the cherry tree. Grandmother
   tended her vegetables in the morning sun. The fountain bubbled
   gently in the courtyard. Songbirds nested in the eaves. Apricots
   ripened on the south wall. Mint and basil grew in clay pots beside
   the kitchen door. Evenings brought lanterns and gentle laughter
   among neighbors. The garden was a haven of peace and modest
   abundance throughout every season of the gentle year.`.repeat(2),
  `Ocean waves crashed against rocky cliffs. Seagulls wheeled in
   salty air. Fishermen mended their nets along the shore. Boats
   bobbed in the harbor. Lighthouses flashed warnings through fog.
   Sailors told tales of distant ports and strange creatures glimpsed
   in tropical seas. The smell of brine clung to wooden docks. Crabs
   skittered across wet sand at low tide. Old tars spliced ropes and
   carved scrimshaw through long quiet evenings beside coal stoves.`.repeat(2),
  `Music filled the concert hall. Violinists tuned their strings.
   The conductor raised his baton. Symphonies poured forth from
   ranked instruments. Audiences listened in rapt silence. Pianists
   coaxed melody from polished keys. Cellists drew long bows across
   resonant strings. Composers labored at desks copying parts. Singers
   warmed their voices backstage among hanging costumes. Opera flowed
   through gilded auditoriums and modest village theaters across the
   continent throughout glittering autumn seasons.`.repeat(2),
  `Mathematicians proved theorems on dusty blackboards. Equations
   covered notebook pages. Geometers traced compass arcs. Algebraists
   manipulated symbols. Topologists studied surfaces with handles.
   Number theorists chased prime patterns through infinite sequences.
   Logicians built formal systems. Statisticians sampled populations
   and computed confidence intervals. Mathematics flourished in
   universities and quiet libraries everywhere thoughtful minds
   gathered to pursue abstract beauty across many curious decades.`.repeat(2),
  `Bread baked in stone ovens. Flour dusted the kitchen counter.
   Yeast bubbled in clay bowls. Bakers shaped loaves before dawn.
   Apprentices kneaded dough until their arms ached. Baguettes,
   sourdoughs, rolls, and crusty boules emerged golden brown. Butter
   melted on warm slices. Honey dripped onto torn pieces. Markets
   filled with fragrant baskets every market morning while merchants
   called their wares beneath bright awnings.`.repeat(2),
  `Mountains towered above misty valleys. Glaciers crept slowly
   downward. Rocky pinnacles caught morning light. Climbers roped
   themselves together for the difficult pitches. Alpine flowers
   carpeted summer meadows. Marmots whistled warnings. Eagles soared
   on thermals. Mountain passes wound between snowy peaks. Shepherds
   guided flocks to high pastures every spring across continents
   wherever ranges and herds endure together throughout long
   stretches of patient seasons.`.repeat(2),
  `Stars wheeled across the night sky. Astronomers gazed through
   telescopes. Constellations marked the seasons. Planets traced
   slow paths against the fixed background. Comets visited and
   departed. Galaxies spiraled in deep space. Nebulae glowed in
   colored light. Supernovae signaled distant stellar deaths.
   Cosmologists puzzled over expansion. Generations watched the
   heavens rotate in patient observation through long winter nights
   beside warm hearths and quiet libraries always waiting.`.repeat(2),
  `Rivers flowed past leafy banks. Trout darted through clear water.
   Otters slid down muddy slides. Frogs croaked from cattail reeds.
   Anglers cast feathered flies. Children skipped flat stones across
   pools. Beavers built dams of stripped saplings. Herons stalked
   shallow shoals. Rivers carried boats, mills, fish, and stories
   downstream toward the broad coastal estuaries throughout every
   year continuously across patient watershed ages.`.repeat(2),
];

const SHORT_BODY = `One two three four five six.`;

function fixtureInput(): BuildInput {
  const fillers: BuildInput["chapters"] = FILLER_BODIES.map((body, i) => ({
    key: `filler-${i}/main`,
    work_slug: `filler-${i}`,
    chapter_slug: "main",
    chapter_number: 1,
    body,
  }));
  return {
    chapters: [
      {
        key: "work-a/courage",
        work_slug: "work-a",
        chapter_slug: "courage",
        chapter_number: 1,
        body: COURAGE_BODY,
      },
      {
        key: "work-c/courage-redux",
        work_slug: "work-c",
        chapter_slug: "courage-redux",
        chapter_number: 1,
        body: COURAGE_BODY_2,
      },
      {
        key: "work-d/short",
        work_slug: "work-d",
        chapter_slug: "short",
        chapter_number: 1,
        body: SHORT_BODY,
      },
      ...fillers,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe("cross-link tokenizer", () => {
  test("drops stopwords and short tokens", () => {
    const tokens = tokenize("the quick brown fox is a fox of high virtue");
    // "the", "is", "a", "of" stripped; "fox" appears twice; "high" kept; "virtue" kept.
    expect(tokens).toEqual(["quick", "brown", "fox", "fox", "high", "virtue"]);
  });

  test("lowercases and splits on non-alpha", () => {
    const tokens = tokenize("Courage! Wisdom; Justice — virtue.");
    expect(tokens.sort()).toEqual(["courage", "justice", "virtue", "wisdom"]);
  });
});

describe("buildIndex", () => {
  test("short-body guard: chapters under MIN_TOKENS are skipped, not linked", () => {
    const idx = buildIndex(fixtureInput(), { generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(idx.skipped_short_chapters).toContain("work-d/short");
    expect(idx.links["work-d/short"]).toBeUndefined();
    // And short chapters never appear in others' related lists.
    for (const related of Object.values(idx.links)) {
      for (const r of related) {
        expect(`${r.work_slug}/${r.chapter_slug}`).not.toBe("work-d/short");
      }
    }
    // Defensive sanity: tokenizer truly produces < MIN_TOKENS for the short body.
    expect(tokenize(SHORT_BODY).length).toBeLessThan(MIN_TOKENS);
  });

  test("self-exclusion: a chapter never appears in its own related list", () => {
    const idx = buildIndex(fixtureInput(), { generatedAt: "2026-01-01T00:00:00.000Z" });
    for (const [key, related] of Object.entries(idx.links)) {
      for (const r of related) {
        expect(`${r.work_slug}/${r.chapter_slug}`).not.toBe(key);
      }
    }
  });

  test("courage variants rank as each other's top match", () => {
    const idx = buildIndex(fixtureInput(), { generatedAt: "2026-01-01T00:00:00.000Z" });
    // The two courage-themed chapters should be each other's strongest link.
    const aRelated = idx.links["work-a/courage"];
    const cRelated = idx.links["work-c/courage-redux"];
    expect(aRelated).toBeDefined();
    expect(cRelated).toBeDefined();
    expect(aRelated![0]!.work_slug).toBe("work-c");
    expect(cRelated![0]!.work_slug).toBe("work-a");
  });

  test("determinism: identical input + frozen timestamp → byte-identical serialized output", () => {
    const a = serializeIndex(buildIndex(fixtureInput(), { generatedAt: "2026-01-01T00:00:00.000Z" }));
    const b = serializeIndex(buildIndex(fixtureInput(), { generatedAt: "2026-01-01T00:00:00.000Z" }));
    expect(a).toBe(b);
  });

  test("topK override is honored", () => {
    const idx = buildIndex(fixtureInput(), {
      generatedAt: "2026-01-01T00:00:00.000Z",
      topK: 1,
    });
    for (const related of Object.values(idx.links)) {
      expect(related.length).toBeLessThanOrEqual(1);
    }
  });
});
