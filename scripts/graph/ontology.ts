import type {
  OntologyQuoteEvent,
  OntologyWork,
} from "./types";

export interface GroundParagraph {
  id: string;
  text: string;
}

export interface GroundingError {
  path: string;
  paragraph_id: string;
  reason: "missing_paragraph" | "quote_not_found";
  quote: string;
}

const QUOTED_ROLE_RE = /\b(quoted|quotes?|says?|said|statement|declared|declares)\b/i;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function quoteAppearsInParagraph(quote: string, paragraphText: string): boolean {
  const q = normalizeText(quote);
  if (!q) return false;
  return normalizeText(paragraphText).includes(q);
}

export function quoteEventsFromCitations(work: OntologyWork): OntologyQuoteEvent[] {
  return work.citations.map((c) => {
    const event: OntologyQuoteEvent = {
      paragraph_id: c.paragraph_id,
      quote: c.quote,
      kind: "citation_quote",
      source: "citation",
      stance: c.stance,
      justification: c.justification,
    };
    if (c.cited_work) event.quoted_work = c.cited_work;
    if (c.cited_author) event.quoted_author = c.cited_author;
    return event;
  });
}

export function quoteEventsFromEntityMentions(work: OntologyWork): OntologyQuoteEvent[] {
  const events: OntologyQuoteEvent[] = [];
  for (const entity of work.entities) {
    for (const mention of entity.mentions) {
      if (!QUOTED_ROLE_RE.test(mention.role)) continue;
      const event: OntologyQuoteEvent = {
        paragraph_id: mention.paragraph_id,
        quote: mention.quote,
        kind: /quot|statement|declared|declares/i.test(mention.role) ? "direct_quote" : "reported_speech",
        source: "entity_mention",
        justification: entity.justification,
      };
      if (entity.kind === "figure") {
        event.speaker = entity.canonical_name;
        event.quoted_person = entity.canonical_name;
      } else if (entity.kind === "group") {
        event.quoted_author = entity.canonical_name;
      }
      events.push(event);
    }
  }
  return events;
}

export function quoteEventsFromOntology(work: OntologyWork): OntologyQuoteEvent[] {
  return [
    ...quoteEventsFromCitations(work),
    ...quoteEventsFromEntityMentions(work),
    ...(work.quote_events ?? []),
  ];
}

export function validateOntologyGrounding(
  work: OntologyWork,
  paragraphs: GroundParagraph[],
): GroundingError[] {
  const byId = new Map(paragraphs.map((p) => [p.id, p.text]));
  const errors: GroundingError[] = [];

  const check = (path: string, paragraph_id: string, quote: string) => {
    const text = byId.get(paragraph_id);
    if (text === undefined) {
      errors.push({ path, paragraph_id, reason: "missing_paragraph", quote });
      return;
    }
    if (!quoteAppearsInParagraph(quote, text)) {
      errors.push({ path, paragraph_id, reason: "quote_not_found", quote });
    }
  };

  work.entities.forEach((entity, entityIndex) => {
    entity.mentions.forEach((mention, mentionIndex) => {
      check(`entities.${entityIndex}.mentions.${mentionIndex}`, mention.paragraph_id, mention.quote);
    });
  });
  work.themes.forEach((theme, themeIndex) => {
    theme.mentions.forEach((mention, mentionIndex) => {
      check(`themes.${themeIndex}.mentions.${mentionIndex}`, mention.paragraph_id, mention.quote);
    });
  });
  work.citations.forEach((citation, citationIndex) => {
    check(`citations.${citationIndex}`, citation.paragraph_id, citation.quote);
  });
  (work.quote_events ?? []).forEach((event, eventIndex) => {
    check(`quote_events.${eventIndex}`, event.paragraph_id, event.quote);
  });

  return errors;
}
