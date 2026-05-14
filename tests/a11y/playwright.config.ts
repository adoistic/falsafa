import { defineConfig } from "@playwright/test";

const baseURL = process.env.A11Y_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "./journeys",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "../../docs/accessibility/test-runs/_playwright-output",
  use: {
    baseURL,
    headless: true,
    trace: "on-first-retry",
    video: "on",
    screenshot: "on",
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
    colorScheme: "light",
  },
  projects: [
    {
      name: "synthetic",
      use: { browserName: "chromium" },
    },
    {
      name: "voiceover",
      testMatch: /.*\.spec\.ts$/,
      use: { browserName: "webkit" },
    },
    {
      name: "nvda",
      testMatch: /.*\.spec\.ts$/,
      use: { browserName: "chromium" },
    },
  ],
});
