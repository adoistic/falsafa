import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

// Falsafa site — fully static, deploys to Vercel free tier.
// View transitions for the "feels like a single document" reading experience.
// Preact powers the interactive launch islands (BYOK demo, eval explorer).
export default defineConfig({
  site: "https://falsafa.app",
  output: "static",
  trailingSlash: "always",
  integrations: [preact()],
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
      fs: {
        // Allow reading from the corpus directory at the monorepo root
        allow: ["../.."],
      },
    },
  },
});
