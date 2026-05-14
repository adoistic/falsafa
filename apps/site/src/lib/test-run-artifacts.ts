// Reads docs/accessibility/test-runs/ at Astro build time.
// Returns the 10 most recent runs across all journeys.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface TestRun {
  journey: string;
  sha: string;
  timestamp: number;
  hasTranscriptSynthetic: boolean;
  hasTranscriptVoiceOver: boolean;
  hasTranscriptNvda: boolean;
  hasAudioVoiceOver: boolean;
  hasAudioNvda: boolean;
  hasVideo: boolean;
}

export interface TestRunSummary {
  recent: TestRun[];
  latestTimestamp: string | null;
  latestSha: string | null;
}

export async function latestRuns(): Promise<TestRunSummary> {
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(
    new URL("../../../../docs/accessibility/test-runs", import.meta.url),
  );
  if (!existsSync(root)) {
    return { recent: [], latestTimestamp: null, latestSha: null };
  }

  const all: TestRun[] = [];
  for (const journey of readdirSync(root)) {
    if (journey.startsWith("_") || journey === "contrast") continue;
    const jDir = join(root, journey);
    if (!statSync(jDir).isDirectory()) continue;
    for (const sha of readdirSync(jDir)) {
      const sDir = join(jDir, sha);
      if (!statSync(sDir).isDirectory()) continue;
      const has = (f: string): boolean => existsSync(join(sDir, f));
      all.push({
        journey,
        sha,
        timestamp: statSync(sDir).mtimeMs,
        hasTranscriptSynthetic: has("transcript-synthetic.md"),
        hasTranscriptVoiceOver: has("transcript-voiceover.md"),
        hasTranscriptNvda: has("transcript-nvda.md"),
        hasAudioVoiceOver: has("audio-voiceover.mp3"),
        hasAudioNvda: has("audio-nvda.mp3"),
        hasVideo: has("video.mp4"),
      });
    }
  }
  all.sort((a, b) => b.timestamp - a.timestamp);
  const latest = all[0];
  return {
    recent: all.slice(0, 10),
    latestTimestamp: latest ? new Date(latest.timestamp).toISOString() : null,
    latestSha: latest?.sha ?? null,
  };
}
