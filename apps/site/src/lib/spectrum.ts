/**
 * Homepage "spectrum" view-model: turn per-era work counts into an ordered,
 * scaled set of bars for the era-distribution timeline on the homepage.
 *
 * Pure + deterministic (no disk access) so it unit-tests cleanly. The page
 * passes `manifest().eras`; tests pass a fake map.
 */
import type { Manifest } from "./corpus";

export interface SpectrumBar {
  /** Display label, e.g. "Late Antiquity". */
  label: string;
  /** Era slug for the /eras/<slug>/ link, e.g. "late-antiquity". */
  slug: string;
  /** Number of works in this era. */
  count: number;
  /** Scaled bar height in px for the desktop vertical chart. */
  heightPx: number;
  /** count / max, 0..1 — used for the mobile horizontal bar width. */
  fraction: number;
  /** True for the tallest era — gets focal styling. */
  isPeak: boolean;
}

/** Tallest bar (px) at desktop width. */
export const BAR_MAX_PX = 140;
/** Shortest visible bar (px) — floor so tiny eras don't vanish. */
export const BAR_MIN_PX = 6;

/**
 * Chronological era order. Eras absent from the manifest (or with zero works)
 * are skipped; eras not listed here (e.g. "Unknown") are excluded by design —
 * they have no position on a timeline.
 */
const ERA_ORDER = [
  "Ancient",
  "Classical",
  "Hellenistic",
  "Imperial",
  "Late Antiquity",
  "Medieval",
  "Renaissance",
  "Enlightenment",
  "19th Century",
  "20th Century",
] as const;

const toSlug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function buildSpectrum(eras: Manifest["eras"]): SpectrumBar[] {
  const present = ERA_ORDER.map((label) => ({
    label,
    slug: toSlug(label),
    count: eras[toSlug(label)]?.works.length ?? 0,
  })).filter((e) => e.count > 0);

  const max = Math.max(1, ...present.map((e) => e.count));

  return present.map((e) => ({
    label: e.label,
    slug: e.slug,
    count: e.count,
    fraction: e.count / max,
    heightPx: Math.max(BAR_MIN_PX, Math.round((e.count / max) * BAR_MAX_PX)),
    isPeak: e.count === max,
  }));
}
