import { z } from "zod";

export const EvidenceKindSchema = z.enum(["source", "test", "artifact"]);

export const EvidenceSchema = z
  .object({
    kind: EvidenceKindSchema,
    path: z.string().min(1),
    lines: z
      .string()
      .regex(/^\d+(-\d+)?(,\d+(-\d+)?)*$/)
      .optional(),
    anchor: z.string().min(1).optional(),
  })
  .refine((e) => e.kind === "artifact" || e.lines || e.anchor, {
    message: "source/test evidence requires lines or anchor",
  });

export const StatusSchema = z.enum([
  "supports",
  "partial",
  "not-applicable",
  "does-not-support",
]);

export const LevelSchema = z.enum(["A", "AA", "AAA"]);

export const ConformanceCriterionSchema = z
  .object({
    id: z.string().regex(/^\d+\.\d+\.\d+$/),
    name: z.string().min(1),
    level: LevelSchema,
    status: StatusSchema,
    exception: z.string().optional(),
    notes: z.string().min(1),
    evidence: z.array(EvidenceSchema),
    commit: z.string().regex(/^([0-9a-f]{7,40}|HEAD)$/),
  })
  .refine((c) => c.status !== "supports" || c.evidence.length > 0, {
    message: "status:supports requires at least one evidence entry",
  })
  .refine((c) => c.status !== "not-applicable" || c.exception, {
    message: "status:not-applicable requires an exception field",
  });

export const MetaSchema = z.object({
  standard: z.literal("WCAG 2.2"),
  conformance_level: LevelSchema,
  partial_aaa: z.boolean(),
  last_review: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  next_review: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contact: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: "must be an email" }),
  vpat_version: z.string().min(1),
  jurisdictions: z.array(z.enum(["india", "eu", "us"])).min(1),
});

export const Section508EntrySchema = z.object({
  id: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
  name: z.string().min(1),
  status: StatusSchema,
  notes: z.string().optional(),
  evidence: z.array(EvidenceSchema),
});

export const EN301549EntrySchema = z.object({
  clause: z.string().regex(/^\d+(\.\d+)*$/),
  name: z.string().min(1),
  status: StatusSchema,
  notes: z.string().optional(),
  evidence: z.array(EvidenceSchema),
});

export const ConformanceDocSchema = z.object({
  meta: MetaSchema,
  criteria: z.array(ConformanceCriterionSchema),
  section_508: z.array(Section508EntrySchema),
  en_301_549: z.array(EN301549EntrySchema),
});

export type ConformanceDoc = z.infer<typeof ConformanceDocSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Status = z.infer<typeof StatusSchema>;
