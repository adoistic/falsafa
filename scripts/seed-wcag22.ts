#!/usr/bin/env bun
// scripts/seed-wcag22.ts — one-shot YAML seeder for WCAG 2.2 SCs.
// Source: https://www.w3.org/TR/WCAG22/#all-success-criteria (2023-10-05 recommendation).
import { writeFileSync, mkdirSync } from "node:fs";

type Level = "A" | "AA" | "AAA";
const SCS: Array<{ id: string; name: string; level: Level }> = [
  { id: "1.1.1", name: "Non-text Content", level: "A" },
  { id: "1.2.1", name: "Audio-only and Video-only (Prerecorded)", level: "A" },
  { id: "1.2.2", name: "Captions (Prerecorded)", level: "A" },
  { id: "1.2.3", name: "Audio Description or Media Alternative (Prerecorded)", level: "A" },
  { id: "1.3.1", name: "Info and Relationships", level: "A" },
  { id: "1.3.2", name: "Meaningful Sequence", level: "A" },
  { id: "1.3.3", name: "Sensory Characteristics", level: "A" },
  { id: "1.4.1", name: "Use of Color", level: "A" },
  { id: "1.4.2", name: "Audio Control", level: "A" },
  { id: "2.1.1", name: "Keyboard", level: "A" },
  { id: "2.1.2", name: "No Keyboard Trap", level: "A" },
  { id: "2.1.4", name: "Character Key Shortcuts", level: "A" },
  { id: "2.2.1", name: "Timing Adjustable", level: "A" },
  { id: "2.2.2", name: "Pause, Stop, Hide", level: "A" },
  { id: "2.3.1", name: "Three Flashes or Below Threshold", level: "A" },
  { id: "2.4.1", name: "Bypass Blocks", level: "A" },
  { id: "2.4.2", name: "Page Titled", level: "A" },
  { id: "2.4.3", name: "Focus Order", level: "A" },
  { id: "2.4.4", name: "Link Purpose (In Context)", level: "A" },
  { id: "2.5.1", name: "Pointer Gestures", level: "A" },
  { id: "2.5.2", name: "Pointer Cancellation", level: "A" },
  { id: "2.5.3", name: "Label in Name", level: "A" },
  { id: "2.5.4", name: "Motion Actuation", level: "A" },
  { id: "3.1.1", name: "Language of Page", level: "A" },
  { id: "3.2.1", name: "On Focus", level: "A" },
  { id: "3.2.2", name: "On Input", level: "A" },
  { id: "3.2.6", name: "Consistent Help", level: "A" },
  { id: "3.3.1", name: "Error Identification", level: "A" },
  { id: "3.3.2", name: "Labels or Instructions", level: "A" },
  { id: "4.1.2", name: "Name, Role, Value", level: "A" },
  { id: "1.2.4", name: "Captions (Live)", level: "AA" },
  { id: "1.2.5", name: "Audio Description (Prerecorded)", level: "AA" },
  { id: "1.3.4", name: "Orientation", level: "AA" },
  { id: "1.3.5", name: "Identify Input Purpose", level: "AA" },
  { id: "1.4.3", name: "Contrast (Minimum)", level: "AA" },
  { id: "1.4.4", name: "Resize Text", level: "AA" },
  { id: "1.4.5", name: "Images of Text", level: "AA" },
  { id: "1.4.10", name: "Reflow", level: "AA" },
  { id: "1.4.11", name: "Non-text Contrast", level: "AA" },
  { id: "1.4.12", name: "Text Spacing", level: "AA" },
  { id: "1.4.13", name: "Content on Hover or Focus", level: "AA" },
  { id: "2.4.5", name: "Multiple Ways", level: "AA" },
  { id: "2.4.6", name: "Headings and Labels", level: "AA" },
  { id: "2.4.7", name: "Focus Visible", level: "AA" },
  { id: "2.4.11", name: "Focus Not Obscured (Minimum)", level: "AA" },
  { id: "2.5.7", name: "Dragging Movements", level: "AA" },
  { id: "2.5.8", name: "Target Size (Minimum)", level: "AA" },
  { id: "3.1.2", name: "Language of Parts", level: "AA" },
  { id: "3.2.3", name: "Consistent Navigation", level: "AA" },
  { id: "3.2.4", name: "Consistent Identification", level: "AA" },
  { id: "3.3.3", name: "Error Suggestion", level: "AA" },
  { id: "3.3.4", name: "Error Prevention (Legal, Financial, Data)", level: "AA" },
  { id: "3.3.7", name: "Redundant Entry", level: "AA" },
  { id: "3.3.8", name: "Accessible Authentication (Minimum)", level: "AA" },
  { id: "4.1.3", name: "Status Messages", level: "AA" },
  { id: "1.2.6", name: "Sign Language (Prerecorded)", level: "AAA" },
  { id: "1.2.7", name: "Extended Audio Description (Prerecorded)", level: "AAA" },
  { id: "1.2.8", name: "Media Alternative (Prerecorded)", level: "AAA" },
  { id: "1.2.9", name: "Audio-only (Live)", level: "AAA" },
  { id: "1.3.6", name: "Identify Purpose", level: "AAA" },
  { id: "1.4.6", name: "Contrast (Enhanced)", level: "AAA" },
  { id: "1.4.7", name: "Low or No Background Audio", level: "AAA" },
  { id: "1.4.8", name: "Visual Presentation", level: "AAA" },
  { id: "1.4.9", name: "Images of Text (No Exception)", level: "AAA" },
  { id: "2.1.3", name: "Keyboard (No Exception)", level: "AAA" },
  { id: "2.2.3", name: "No Timing", level: "AAA" },
  { id: "2.2.4", name: "Interruptions", level: "AAA" },
  { id: "2.2.5", name: "Re-authenticating", level: "AAA" },
  { id: "2.2.6", name: "Timeouts", level: "AAA" },
  { id: "2.3.2", name: "Three Flashes", level: "AAA" },
  { id: "2.3.3", name: "Animation from Interactions", level: "AAA" },
  { id: "2.4.8", name: "Location", level: "AAA" },
  { id: "2.4.9", name: "Link Purpose (Link Only)", level: "AAA" },
  { id: "2.4.10", name: "Section Headings", level: "AAA" },
  { id: "2.4.12", name: "Focus Not Obscured (Enhanced)", level: "AAA" },
  { id: "2.4.13", name: "Focus Appearance", level: "AAA" },
  { id: "2.5.5", name: "Target Size (Enhanced)", level: "AAA" },
  { id: "2.5.6", name: "Concurrent Input Mechanisms", level: "AAA" },
  { id: "3.1.3", name: "Unusual Words", level: "AAA" },
  { id: "3.1.4", name: "Abbreviations", level: "AAA" },
  { id: "3.1.5", name: "Reading Level", level: "AAA" },
  { id: "3.1.6", name: "Pronunciation", level: "AAA" },
  { id: "3.2.5", name: "Change on Request", level: "AAA" },
  { id: "3.3.5", name: "Help", level: "AAA" },
  { id: "3.3.6", name: "Error Prevention (All)", level: "AAA" },
  { id: "3.3.9", name: "Accessible Authentication (Enhanced)", level: "AAA" },
];

const EXCEPTIONS: Record<string, { exception: string; notes: string }> = {
  "1.2.1": { exception: "no-audio-or-video-content", notes: "Falsafa is a text-only reading platform. No audio or video content is published." },
  "1.2.2": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.3": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.4": { exception: "no-audio-or-video-content", notes: "No live media." },
  "1.2.5": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.6": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.7": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.8": { exception: "no-audio-or-video-content", notes: "No video content." },
  "1.2.9": { exception: "no-audio-or-video-content", notes: "No live media." },
  "1.4.2": { exception: "no-audio-or-video-content", notes: "No auto-playing audio." },
  "1.4.7": { exception: "no-audio-or-video-content", notes: "No audio." },
  "2.2.5": { exception: "no-authentication", notes: "Site has no authentication of any kind." },
  "3.3.7": { exception: "no-authentication", notes: "No re-entry forms; site is read-only." },
  "3.3.8": { exception: "no-authentication", notes: "No authentication." },
  "3.3.9": { exception: "no-authentication", notes: "No authentication." },
  "3.1.3": { exception: "content-type", notes: "Falsafa publishes primary-source philosophy across six languages. The corpus is built on technical and unusual vocabulary; identifying every term is contrary to the project's editorial purpose. Partial mitigation planned in V2 via glossary popovers (read_wiki)." },
  "3.1.5": { exception: "content-type", notes: "Falsafa publishes graduate-level primary-source philosophy across six languages. Lowering reading level would require rewriting the corpus and is contrary to the project's editorial purpose. Mitigations: chapter summaries via read_wiki MCP tool; cross-tradition links via TF-IDF." },
  "3.1.6": { exception: "content-type", notes: "Pronunciation aids for non-English terms across six languages (Urdu, Sanskrit, Old English, French, German, Old Javanese) would require pronunciation curation per term per language — content work explicitly deferred. IPA inline annotations may land in V2 or V3." },
};

function renderCriterion(sc: { id: string; name: string; level: Level }): string {
  const exc = EXCEPTIONS[sc.id];
  const lines: string[] = [];
  lines.push(`  - id: "${sc.id}"`);
  lines.push(`    name: ${sc.name}`);
  lines.push(`    level: ${sc.level}`);
  if (exc) {
    lines.push(`    status: not-applicable`);
    lines.push(`    exception: ${exc.exception}`);
    lines.push(`    notes: >-`);
    lines.push(`      ${exc.notes}`);
  } else {
    lines.push(`    status: does-not-support`);
    lines.push(`    notes: "TBD V1"`);
  }
  lines.push(`    evidence: []`);
  lines.push(`    commit: "0000000"`);
  return lines.join("\n");
}

const HEADER = `# Falsafa accessibility conformance — single source of truth.
# Generated VPAT 2.5 INT + EN 301 549 Annex F + on-site matrix all read this file.
# Seed bootstrapped by scripts/seed-wcag22.ts; hand-edit thereafter.
# Spec: docs/superpowers/specs/2026-05-14-accessibility-design.md

meta:
  standard: WCAG 2.2
  conformance_level: AA
  partial_aaa: true
  last_review: "2026-05-14"
  next_review: "2026-08-14"
  contact: accessibility@thothica.com
  vpat_version: "2.5 INT"
  jurisdictions: [india, eu, us]

# WCAG 2.2 — 86 success criteria (30 A + 25 AA + 31 AAA)
criteria:
`;

const SECTION_508 = `
# Section 508 functional performance criteria (Rev. 2017)
section_508:
  - id: "302.1"
    name: Without Vision
    status: does-not-support
    notes: "TBD V1 — proved by VoiceOver + NVDA audio recordings"
    evidence: []
  - id: "302.2"
    name: With Limited Vision
    status: does-not-support
    notes: "TBD V1"
    evidence: []
  - id: "302.3"
    name: Without Perception of Color
    status: does-not-support
    notes: "TBD V1"
    evidence: []
  - id: "302.4"
    name: Without Hearing
    status: supports
    notes: No audio content is published. Site is fully usable without hearing.
    evidence: []
  - id: "302.5"
    name: With Limited Hearing
    status: supports
    notes: No audio content is published.
    evidence: []
  - id: "302.6"
    name: Without Speech
    status: supports
    notes: No speech-input or speech-output requirements.
    evidence: []
  - id: "302.7"
    name: With Limited Manipulation
    status: does-not-support
    notes: "TBD V1 — proved by keyboard-only Playwright journeys"
    evidence: []
  - id: "302.8"
    name: With Limited Reach and Strength
    status: does-not-support
    notes: "TBD V1"
    evidence: []
  - id: "302.9"
    name: With Limited Language, Cognitive, and Learning Abilities
    status: partial
    notes: >-
      Falsafa publishes graduate-level primary-source philosophy. Reading level is content-type-fixed (WCAG 3.1.5 exception). Mitigations include chapter summaries via the read_wiki MCP tool.
    evidence: []
`;

const EN_301_549 = `
# EN 301 549 v3.2.1 additional requirements (clauses 5-13)
en_301_549:
  - clause: "5.2"
    name: Activation of accessibility features
    status: does-not-support
    notes: "TBD V1 — system-preference auto-detection (Chunk 2 B.5)"
    evidence: []
  - clause: "5.3"
    name: Biometrics
    status: not-applicable
    notes: No biometric authentication. Site has no authentication of any kind.
    evidence: []
  - clause: "5.4"
    name: Preservation of accessibility information during conversion
    status: not-applicable
    notes: Site does not perform document-to-document conversion.
    evidence: []
  - clause: "9"
    name: "Web (refers to WCAG 2.1)"
    status: does-not-support
    notes: "TBD V1 — superset claim via WCAG 2.2 AA"
    evidence: []
  - clause: "11"
    name: Software (non-web)
    status: not-applicable
    notes: Falsafa is a web product. The MCP package is covered separately if/when its UI grows.
    evidence: []
  - clause: "12.1"
    name: Product documentation
    status: does-not-support
    notes: "TBD V1 — README + /accessibility page satisfy this"
    evidence: []
  - clause: "12.2"
    name: Support services
    status: supports
    notes: Accessibility issues may be reported via mailto:accessibility@thothica.com or GitHub issue.
    evidence: []
`;

mkdirSync("docs/accessibility/manual-tests", { recursive: true });
const body = SCS.map(renderCriterion).join("\n\n");
const out = HEADER + body + "\n" + SECTION_508 + EN_301_549;
writeFileSync("docs/accessibility/conformance.yaml", out);
console.log(`Seeded ${SCS.length} WCAG 2.2 SCs + 9 Section 508 + 7 EN 301 549 entries.`);
