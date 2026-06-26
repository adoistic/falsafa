/**
 * Theme-mode resolution for the site-wide appearance switcher.
 *
 * Modes: "system" (default) follows the OS prefers-color-scheme; "light",
 * "dark", and "sepia" are explicit overrides. The chosen mode is persisted in
 * localStorage under `falsafa-prefs.theme`.
 *
 * The value applied to <html data-theme> is only ever "dark" or "sepia" —
 * "light" is the :root default (no attribute), so resolving to "light" means
 * the attribute is removed.
 */
export type ThemeMode = "system" | "light" | "dark" | "sepia";
export type EffectiveTheme = "light" | "dark" | "sepia";

/** Switcher options, in display order. "system" is first because it's default. */
export const THEME_MODES: { mode: ThemeMode; label: string }[] = [
  { mode: "system", label: "System" },
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "sepia", label: "Sepia" },
];

/**
 * Resolve a stored preference (which may be unset, "system", or unknown) to a
 * concrete theme. Explicit modes win; otherwise follow the OS dark preference.
 *
 * NB: the no-FOUC pre-paint script in Base.astro mirrors this logic inline
 * (it can't import); keep the two in sync.
 */
export function resolveTheme(
  pref: string | null | undefined,
  prefersDark: boolean,
): EffectiveTheme {
  if (pref === "light" || pref === "dark" || pref === "sepia") return pref;
  return prefersDark ? "dark" : "light";
}
