import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";
import { includeInSitemap } from "./src/lib/sitemap-exclude.mjs";

// Falsafa site — fully static; built locally and served by a Cloudflare Worker
// from R2 (see /DEPLOY.md). No Netlify/Vercel/PaaS build step.
// View transitions for the "feels like a single document" reading experience.
// Preact powers the interactive launch islands (BYOK demo, eval explorer).
export default defineConfig({
  site: "https://falsafa.ai",
  output: "static",
  trailingSlash: "always",
  // The sitemap claims only pages that are meant to be indexed: no noindex
  // surfaces, no redirect stubs. See src/lib/sitemap-exclude.mjs.
  integrations: [preact(), sitemap({ filter: includeInSitemap })],
  build: {
    format: "directory",
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "viewport",
  },
  experimental: {
    contentIntellisense: true,
  },
  vite: {
    server: {
      // Audio streams + alignment sidecars live in the falsafa-audio R2
      // bucket behind the production Worker; in dev, same-origin /audio/*
      // requests proxy there so the player works against real streams.
      proxy: {
        "/audio": {
          target: "https://falsafa.ai",
          changeOrigin: true,
        },
      },
      fs: {
        // Allow reading from the corpus directory at the monorepo root
        allow: ["../.."],
      },
      watch: {
        // The atlas synthesis artifacts are thousands of derived JSON files
        // (corpus/graph/atlas/entities/*) read at build time only — watching
        // them blows the macOS file-descriptor limit (EMFILE) in dev.
        ignored: ["**/corpus/**", "**/t2work/**", "**/atlas/data/**"],
      },
    },
    optimizeDeps: {
      // The AI SDK and provider packages are only imported inside
      // lazy-loaded BYOK provider adapters (src/islands/byok/providers/*.ts).
      // Vite's auto-discovery can drop them from the optimizer cache when
      // an unrelated dep gets added (e.g., installing marked-footnote
      // triggered a re-scan that produced a cache without these), causing
      // the dev server to serve the lazy adapter with rewritten import URLs
      // (`/node_modules/.vite/deps/@ai-sdk_openai.js?v=...`) that 404.
      // The user sees: "Failed to fetch dynamically imported module".
      // Pinning them in `include` forces pre-bundling on every start.
      include: [
        "@ai-sdk/openai",
        "ai",
        "marked",
        "marked-footnote",
        "zod",
      ],
    },
  },
});
