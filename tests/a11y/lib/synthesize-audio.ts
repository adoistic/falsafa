#!/usr/bin/env bun
// Synthesize an MP3 from a Markdown transcript using espeak-ng.
// Linux CI fallback when real screen-reader audio isn't available.
import { existsSync } from "node:fs";
import { readdir, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

async function main(): Promise<void> {
  const root = "docs/accessibility/test-runs";
  if (!existsSync(root)) return;
  for (const journey of await readdir(root)) {
    const journeyDir = resolve(root, journey);
    for (const run of await readdir(journeyDir)) {
      const runDir = join(journeyDir, run);
      const transcriptPath = join(runDir, "transcript-synthetic.md");
      if (!existsSync(transcriptPath)) continue;
      const out = join(runDir, "audio-synthetic.mp3");
      const text = (await readFile(transcriptPath, "utf8"))
        .replace(/^#.*$/gm, "")
        .trim();
      if (!text) continue;
      const wav = out.replace(/\.mp3$/, ".wav");
      const espeak = spawnSync("espeak-ng", ["-w", wav, "-s", "180", text], {
        stdio: "inherit",
      });
      if (espeak.status !== 0) {
        console.warn(`espeak-ng not available; skipping ${journey}/${run}`);
        continue;
      }
      const ffmpeg = spawnSync(
        "ffmpeg",
        ["-y", "-i", wav, "-codec:a", "libmp3lame", out],
        { stdio: "inherit" },
      );
      await unlink(wav).catch(() => {});
      if (ffmpeg.status !== 0) {
        console.warn(`ffmpeg failed; wav kept at ${wav}`);
        continue;
      }
      console.log(`Synthesized ${out}`);
    }
  }
}

if (import.meta.main) await main();
