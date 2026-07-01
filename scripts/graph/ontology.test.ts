import { describe, expect, test } from "bun:test";
import {
  quoteAppearsInParagraph,
  quoteEventsFromCitations,
  quoteEventsFromEntityMentions,
  quoteEventsFromOntology,
  validateOntologyGrounding,
} from "./ontology";
import type { OntologyWork } from "./types";

const baseWork = (partial: Partial<OntologyWork> = {}): OntologyWork => ({
  work_slug: "plato-apology",
  extracted_at: "2026-07-01T00:00:00.000Z",
  ontology_version: "v1",
  window_chapters: ["01-apology"],
  entities: [],
  themes: [],
  citations: [],
  ...partial,
});

describe("quoteAppearsInParagraph", () => {
  test("matches verbatim snippets while ignoring whitespace and case", () => {
    expect(quoteAppearsInParagraph("Human wisdom is of little or no value", "human   wisdom is of little or no VALUE.")).toBe(true);
  });

  test("rejects empty or absent snippets", () => {
    expect(quoteAppearsInParagraph("", "anything")).toBe(false);
    expect(quoteAppearsInParagraph("not here", "a different paragraph")).toBe(false);
  });
});

describe("quoteEventsFromCitations", () => {
  test("turns ontology citations into quote-level citation events", () => {
    const work = baseWork({
      citations: [{
        cited_work: "Clouds",
        cited_author: "Aristophanes",
        stance: "refute",
        paragraph_id: "p-0dc1ec",
        quote: "you yourselves saw these things in Aristophanes' comedy",
        justification: "Socrates names the comedy and rejects its portrayal.",
      }],
    });

    expect(quoteEventsFromCitations(work)).toEqual([{
      paragraph_id: "p-0dc1ec",
      quote: "you yourselves saw these things in Aristophanes' comedy",
      kind: "citation_quote",
      source: "citation",
      stance: "refute",
      quoted_work: "Clouds",
      quoted_author: "Aristophanes",
      justification: "Socrates names the comedy and rejects its portrayal.",
    }]);
  });
});

describe("quoteEventsFromEntityMentions", () => {
  test("promotes quoted figure mentions into direct quote events", () => {
    const work = baseWork({
      entities: [{
        canonical_name: "Bṛhaspati",
        surface_names: ["Bṛhaspati"],
        kind: "figure",
        figure_kind: "historical",
        mentions: [{
          paragraph_id: "p-722565",
          quote: "Bṛhaspati says that the dharma of the age declines",
          role: "quoted authority on yuga-dharma durations",
        }],
        description: "A smṛti authority quoted on yuga-dharma.",
        justification: "Bṛhaspati is named as the speaker of the quoted verse.",
        founding_texts: [],
      }],
    });

    expect(quoteEventsFromEntityMentions(work)).toEqual([{
      paragraph_id: "p-722565",
      quote: "Bṛhaspati says that the dharma of the age declines",
      kind: "direct_quote",
      source: "entity_mention",
      speaker: "Bṛhaspati",
      quoted_person: "Bṛhaspati",
      justification: "Bṛhaspati is named as the speaker of the quoted verse.",
    }]);
  });

  test("does not promote ordinary entity mentions", () => {
    const work = baseWork({
      entities: [{
        canonical_name: "Socrates",
        surface_names: ["Socrates"],
        kind: "figure",
        figure_kind: "historical",
        mentions: [{ paragraph_id: "p-1", quote: "Socrates is on trial", role: "defendant" }],
        description: "The defendant.",
        justification: "Named in the trial.",
        founding_texts: [],
      }],
    });

    expect(quoteEventsFromEntityMentions(work)).toEqual([]);
  });
});

describe("quoteEventsFromOntology", () => {
  test("combines derived and explicit quote events", () => {
    const work = baseWork({
      citations: [{
        cited_work: "Works and Days",
        cited_author: "Hesiod",
        stance: "authority",
        paragraph_id: "p-h",
        quote: "Hesiod says the just city flourishes",
        justification: "Hesiod is quoted as poetic authority.",
      }],
      quote_events: [{
        paragraph_id: "p-m",
        quote: "Manu declared this rule",
        kind: "direct_quote",
        speaker: "Manu",
        quoted_person: "Manu",
        source: "manual",
        justification: "Manual review identified the speaker.",
      }],
    });

    const events = quoteEventsFromOntology(work);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.paragraph_id)).toEqual(["p-h", "p-m"]);
  });
});

describe("validateOntologyGrounding", () => {
  test("checks entities, themes, citations, and explicit quote events against real paragraph text", () => {
    const work = baseWork({
      entities: [{
        canonical_name: "Socrates",
        surface_names: ["Socrates"],
        kind: "figure",
        figure_kind: "historical",
        mentions: [{ paragraph_id: "p-1", quote: "Socrates is on trial", role: "defendant" }],
        description: "The defendant.",
        justification: "Named in the trial.",
        founding_texts: [],
      }],
      themes: [{
        topic: "trial",
        implicit: false,
        mentions: [{ paragraph_id: "p-2", quote: "the court gathers" }],
        justification: "The scene is judicial.",
      }],
      citations: [{
        cited_work: "",
        cited_author: "Homer",
        stance: "authority",
        paragraph_id: "p-3",
        quote: "Homer says",
        justification: "Homer is invoked.",
      }],
      quote_events: [{
        paragraph_id: "p-4",
        quote: "missing quote",
        kind: "direct_quote",
        speaker: "Socrates",
        source: "manual",
        justification: "Manual review.",
      }],
    });

    const errors = validateOntologyGrounding(work, [
      { id: "p-1", text: "Socrates is on trial before the Athenians." },
      { id: "p-2", text: "At dawn the court gathers." },
      { id: "p-3", text: "Homer says something about heroes." },
      { id: "p-4", text: "A paragraph with different words." },
    ]);

    expect(errors).toEqual([{
      path: "quote_events.0",
      paragraph_id: "p-4",
      reason: "quote_not_found",
      quote: "missing quote",
    }]);
  });

  test("reports missing paragraph ids", () => {
    const work = baseWork({
      citations: [{
        cited_work: "Clouds",
        cited_author: "Aristophanes",
        stance: "refute",
        paragraph_id: "p-missing",
        quote: "Aristophanes' comedy",
        justification: "The citation is present.",
      }],
    });

    expect(validateOntologyGrounding(work, [])).toEqual([{
      path: "citations.0",
      paragraph_id: "p-missing",
      reason: "missing_paragraph",
      quote: "Aristophanes' comedy",
    }]);
  });
});
