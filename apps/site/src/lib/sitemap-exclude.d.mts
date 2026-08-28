/**
 * Types for sitemap-exclude.mjs.
 *
 * The module itself is plain .mjs because astro.config.mjs imports it before
 * any TypeScript transform is in play. Its colocated test is .ts, and under
 * the root tsconfig an untyped .mjs import is an implicit-any error, so the
 * one exported predicate is declared here rather than the test suppressing
 * the diagnostic.
 */

/** True when a built URL belongs in the sitemap as a canonical claim. */
export function includeInSitemap(url: string): boolean;
