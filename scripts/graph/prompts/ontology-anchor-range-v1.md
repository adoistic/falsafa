# Ontology Anchor-Range Prompt

Date: 2026-07-01

This prompt is for extracting ontology from a window of corpus text without asking the model to copy exact quotes. The model should identify ontology items and anchor them to paragraph ids or paragraph ranges. A deterministic local pipeline attaches exact quote arrays afterward.

## Prompt Template

```text
You are reading a passage from a structured corpus of philosophy, religion, law, literature, political thought, social theory, and intellectual history.

Work: <WORK_TITLE>
Author/attribution: <AUTHOR_OR_ATTRIBUTION>
Genre/tradition: <GENRE_OR_TRADITION_IF_KNOWN>
Language/source status: <LANGUAGE_OR_TRANSLATION_INFO_IF_KNOWN>
Section/window: <SECTION_OR_WINDOW_LABEL>
Corpus id: <WORK_SLUG>

The source below is divided into paragraphs. Each paragraph begins with a stable paragraph id, followed by the paragraph text. These paragraph ids are the evidence anchors. Do not copy exact quotes. Do not create quote fields. Your job is to identify what is present in the passage and anchor each item to the paragraph id, paragraph ids, or paragraph range where it appears.

Ontology here means a structured map of the passage:
- the people, gods, groups, places, objects, events, animals, and ideas that appear;
- the themes or concerns the passage is about;
- the works, authors, scriptures, schools, doctrines, traditions, or authorities the passage cites or invokes;
- the acts of quoting, reporting speech, asking, answering, accusing, naming a doctrine, stating a rule, or invoking an authority.

Extract everything present in the passage. Do not limit yourself to only the most important items. Do not omit minor entities if they are actually present.

Evidence must be anchored by paragraph references only. Do not include quote fields. Do not copy source text into quote fields. A deterministic local pipeline will attach exact quote arrays after the model response.

Evidence can appear in different shapes:
- A single paragraph can support an item.
- Several non-consecutive paragraphs can support an item.
- A consecutive paragraph range can support an item when an argument, description, rule, narrative, or dialogue exchange unfolds continuously.
- Hybrid evidence is common: an item may have one isolated paragraph, then a consecutive range elsewhere, then another isolated paragraph later. Represent this as multiple evidence objects.
- A theme may be supported by one explicit statement, by several scattered passages, or by a range where the concern develops over time.
- A citation may occur in one paragraph, while the stance toward it is explained in nearby paragraphs. Use multiple evidence objects if needed.
- A quote event may be a direct speech act in one paragraph, a reported speech act across several paragraphs, or a cited authority introduced in one paragraph and interpreted in another.
- A recurring entity may have many evidence objects, each with a different role, such as first introduction, description, accusation, rebuttal, rule application, or later restatement.

Use one evidence object per evidence shape:
- Use anchor_type "paragraph_ids" when the evidence is in one or more specific non-consecutive paragraphs.
- Use anchor_type "paragraph_range" when the evidence unfolds across consecutive paragraphs.
- If evidence is hybrid, use multiple evidence objects. Do not mix paragraph_ids and paragraph_range in the same evidence object.
- paragraph_range is inclusive.
- evidence_hint should be a short natural-language description of what the relevant passage contains.
- role should explain how that passage supports the item.

Return ONLY valid JSON matching this top-level shape:

{
  "work_slug": "<WORK_SLUG>",
  "extracted_at": "2026-07-01T00:00:00.000Z",
  "ontology_version": "anchor-range-v1",
  "window_chapters": ["<SECTION_OR_WINDOW_LABEL>"],
  "entities": [],
  "themes": [],
  "citations": [],
  "quote_events": []
}

Evidence object shape:

{
  "anchor_type": "paragraph_ids | paragraph_range",
  "paragraph_ids": ["string"],
  "paragraph_range": {
    "start": "string",
    "end": "string"
  },
  "evidence_hint": "string",
  "role": "string"
}

Rules for evidence objects:
- If anchor_type is "paragraph_ids", include paragraph_ids and omit paragraph_range.
- If anchor_type is "paragraph_range", include paragraph_range and omit paragraph_ids.
- If multiple separate evidence locations support the same item, create multiple evidence objects.
- Every paragraph id must be one of the allowed paragraph ids listed below.
- Do not invent paragraph ids.
- Do not include exact source quotes.

Entity object shape:

{
  "canonical_name": "string",
  "surface_names": ["string"],
  "kind": "figure | animal | place | group | idea | object | event",
  "figure_kind": "historical | mythological | deity",
  "evidence": [],
  "description": "string",
  "justification": "string"
}

Omit figure_kind when kind is not figure.

Entities:
- figure: named persons, gods, sages, heroes, authors, speakers, rulers, interlocutors, or personified agents.
- animal: animals or creature-types when treated as creatures, ritual categories, examples, or objects of classification.
- place: cities, countries, regions, rivers, worlds, courts, prisons, sacred sites, or spatial settings.
- group: peoples, castes, classes, audiences, accusers, citizens, sects, professions, kin groups, political bodies.
- idea: abstract concepts, doctrines, virtues, vices, laws, duties, forms of knowledge, forms of impurity, justice, freedom, wisdom, penance.
- object: books, texts as physical/scriptural objects, weapons, ritual implements, money, food, mantras, ships, vessels.
- event: trials, accusations, sacrifices, deaths, journeys, punishments, vows, battles, rituals, acts of purification.

Theme object shape:

{
  "topic": "string",
  "implicit": true,
  "evidence": [],
  "justification": "string"
}

Themes:
- A theme is what the passage is about, not merely a named thing inside it.
- Themes can be explicit or implicit.
- A theme is explicit when the passage names the concern directly.
- A theme is implicit when the passage is clearly organized around the concern even if the exact word is not used.
- Themes are separate from entities. Do not put themes in the entities array.

Citation object shape:

{
  "cited_work": "string",
  "cited_author": "string",
  "stance": "endorse | refute | extend | authority | neutral",
  "evidence": [],
  "justification": "string"
}

Citations:
- A citation is any invocation of another work, author, scripture, school, tradition, legal authority, poetic authority, oracle, doctrine, named teaching, or recognized textual source.
- Use "endorse" when the passage agrees with or supports the cited source.
- Use "refute" when the passage argues against it or treats it as false.
- Use "extend" when the passage develops, elaborates, or continues it.
- Use "authority" when the passage relies on it as a source of legitimacy.
- Use "neutral" when the passage merely identifies or reports it.

Quote event object shape:

{
  "kind": "direct_quote | reported_speech | citation_quote",
  "speaker": "string",
  "quoted_person": "string",
  "quoted_work": "string",
  "quoted_author": "string",
  "stance": "endorse | refute | extend | authority | neutral",
  "source": "manual",
  "evidence": [],
  "justification": "string"
}

Omit unknown optional speaker, quoted_person, quoted_work, quoted_author, and stance fields.

Quote events:
- A quote event is a passage-level act of speech or textual invocation.
- Create quote events for direct speech.
- Create quote events for reported speech.
- Create quote events for accusations stated as speech.
- Create quote events for an oracle, law, scripture, or authority being reported.
- Create quote events for a doctrine being attributed to someone.
- Create quote events for a work or author being cited.
- Create quote events for a legal formula, vow, rule, or command being stated.
- Create quote events for an interlocutor's question or answer when the dialogue structure matters.
- Every citation must also have a corresponding quote_event with kind "citation_quote".

Allowed paragraph ids:
<ALLOWED_PARAGRAPH_IDS>

SOURCE:
<PARAGRAPH_ID>	<PARAGRAPH_TEXT>

<PARAGRAPH_ID>	<PARAGRAPH_TEXT>
```

## Deterministic Enrichment

After the model returns JSON, the local pipeline should:

1. Validate all top-level arrays exist.
2. Validate each evidence object has exactly one anchor type.
3. Validate every paragraph id exists in the source window.
4. Expand paragraph ranges using the source window order.
5. Deduplicate paragraph ids within each evidence object.
6. Attach quote arrays per evidence object.
7. Select quotes using canonical names, surface names, topic, cited work, cited author, speaker, quoted person, quoted work, quoted author, evidence_hint, and role.
8. Mark each quote with selection_method and selection_score.
9. If no strong sentence match exists, attach paragraph-level evidence rather than pretending a precise snippet was found.
10. Preserve evidence objects separately so hybrid evidence remains inspectable.

## Full JSON Schema

Use this schema to validate the model output before deterministic enrichment:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://falsafa.ai/schemas/ontology-anchor-range-v1.json",
  "title": "Ontology Anchor Range Output",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "work_slug",
    "extracted_at",
    "ontology_version",
    "window_chapters",
    "entities",
    "themes",
    "citations",
    "quote_events"
  ],
  "properties": {
    "work_slug": {
      "type": "string",
      "minLength": 1
    },
    "extracted_at": {
      "type": "string",
      "format": "date-time"
    },
    "ontology_version": {
      "const": "anchor-range-v1"
    },
    "window_chapters": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "minItems": 1
    },
    "entities": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/entity"
      }
    },
    "themes": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/theme"
      }
    },
    "citations": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/citation"
      }
    },
    "quote_events": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/quote_event"
      }
    }
  },
  "$defs": {
    "evidence": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "anchor_type",
        "evidence_hint",
        "role"
      ],
      "properties": {
        "anchor_type": {
          "enum": [
            "paragraph_ids",
            "paragraph_range"
          ]
        },
        "paragraph_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "minItems": 1
        },
        "paragraph_range": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "start",
            "end"
          ],
          "properties": {
            "start": {
              "type": "string",
              "minLength": 1
            },
            "end": {
              "type": "string",
              "minLength": 1
            }
          }
        },
        "evidence_hint": {
          "type": "string",
          "minLength": 1
        },
        "role": {
          "type": "string",
          "minLength": 1
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "anchor_type": {
                "const": "paragraph_ids"
              }
            },
            "required": [
              "anchor_type"
            ]
          },
          "then": {
            "required": [
              "paragraph_ids"
            ],
            "not": {
              "required": [
                "paragraph_range"
              ]
            }
          }
        },
        {
          "if": {
            "properties": {
              "anchor_type": {
                "const": "paragraph_range"
              }
            },
            "required": [
              "anchor_type"
            ]
          },
          "then": {
            "required": [
              "paragraph_range"
            ],
            "not": {
              "required": [
                "paragraph_ids"
              ]
            }
          }
        }
      ]
    },
    "entity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "canonical_name",
        "surface_names",
        "kind",
        "evidence",
        "description",
        "justification"
      ],
      "properties": {
        "canonical_name": {
          "type": "string",
          "minLength": 1
        },
        "surface_names": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "minItems": 1
        },
        "kind": {
          "enum": [
            "figure",
            "animal",
            "place",
            "group",
            "idea",
            "object",
            "event"
          ]
        },
        "figure_kind": {
          "enum": [
            "historical",
            "mythological",
            "deity"
          ]
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/evidence"
          },
          "minItems": 1
        },
        "description": {
          "type": "string",
          "minLength": 1
        },
        "justification": {
          "type": "string",
          "minLength": 1
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "kind": {
                "const": "figure"
              }
            },
            "required": [
              "kind"
            ]
          },
          "then": {
            "required": [
              "figure_kind"
            ]
          },
          "else": {
            "not": {
              "required": [
                "figure_kind"
              ]
            }
          }
        }
      ]
    },
    "theme": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "topic",
        "implicit",
        "evidence",
        "justification"
      ],
      "properties": {
        "topic": {
          "type": "string",
          "minLength": 1
        },
        "implicit": {
          "type": "boolean"
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/evidence"
          },
          "minItems": 1
        },
        "justification": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "citation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "cited_work",
        "cited_author",
        "stance",
        "evidence",
        "justification"
      ],
      "properties": {
        "cited_work": {
          "type": "string"
        },
        "cited_author": {
          "type": "string"
        },
        "stance": {
          "$ref": "#/$defs/stance"
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/evidence"
          },
          "minItems": 1
        },
        "justification": {
          "type": "string",
          "minLength": 1
        }
      },
      "anyOf": [
        {
          "properties": {
            "cited_work": {
              "minLength": 1
            }
          }
        },
        {
          "properties": {
            "cited_author": {
              "minLength": 1
            }
          }
        }
      ]
    },
    "quote_event": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "source",
        "evidence",
        "justification"
      ],
      "properties": {
        "kind": {
          "enum": [
            "direct_quote",
            "reported_speech",
            "citation_quote"
          ]
        },
        "speaker": {
          "type": "string",
          "minLength": 1
        },
        "quoted_person": {
          "type": "string",
          "minLength": 1
        },
        "quoted_work": {
          "type": "string",
          "minLength": 1
        },
        "quoted_author": {
          "type": "string",
          "minLength": 1
        },
        "stance": {
          "$ref": "#/$defs/stance"
        },
        "source": {
          "const": "manual"
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/evidence"
          },
          "minItems": 1
        },
        "justification": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "stance": {
      "enum": [
        "endorse",
        "refute",
        "extend",
        "authority",
        "neutral"
      ]
    }
  }
}
```
