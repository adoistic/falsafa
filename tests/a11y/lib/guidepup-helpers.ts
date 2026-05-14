import { nvda, type ScreenReader, voiceOver } from "@guidepup/guidepup";

let active: ScreenReader | null = null;

export async function startScreenReader(): Promise<ScreenReader> {
  if (active) return active;
  if (process.platform === "darwin") {
    await voiceOver.start();
    active = voiceOver;
  } else if (process.platform === "win32") {
    await nvda.start();
    active = nvda;
  } else {
    throw new Error(
      "Screen reader testing only supported on macOS (VoiceOver) or Windows (NVDA)",
    );
  }
  return active;
}

export async function stopScreenReader(): Promise<void> {
  if (!active) return;
  await active.stop();
  active = null;
}

export async function dumpScreenReaderTranscript(sr: ScreenReader): Promise<string> {
  const log = await sr.spokenPhraseLog();
  return log.map((phrase, i) => `${i + 1}. ${phrase}`).join("\n");
}
