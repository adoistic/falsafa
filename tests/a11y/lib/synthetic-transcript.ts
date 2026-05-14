import type { Locator, Page } from "@playwright/test";

export interface TranscriptEntry {
  role: string;
  name: string;
  state: string[];
}

export function formatTranscriptLine(index: number, entry: TranscriptEntry): string {
  const states = entry.state.length > 0 ? ", " + entry.state.join(", ") : "";
  if (!entry.name) return `[${index}] ${entry.role}${states}`;
  return `[${index}] ${entry.role}${states}: "${entry.name}"`;
}

export async function captureSyntheticTranscript(
  page: Page,
  maxSteps = 50,
): Promise<TranscriptEntry[]> {
  const entries: TranscriptEntry[] = [];
  await page.keyboard.press("Tab");
  for (let i = 0; i < maxSteps; i++) {
    const focused = page.locator(":focus");
    if ((await focused.count()) === 0) break;
    const entry = await entryFromLocator(focused);
    if (entry) {
      const seen = entries.some(
        (e) =>
          e.role === entry.role &&
          e.name === entry.name &&
          e.state.join(",") === entry.state.join(","),
      );
      if (seen) break;
      entries.push(entry);
    }
    await page.keyboard.press("Tab");
  }
  return entries;
}

async function entryFromLocator(loc: Locator): Promise<TranscriptEntry | null> {
  const handle = await loc.elementHandle();
  if (!handle) return null;
  const role =
    (await handle.getAttribute("role")) ??
    (await handle.evaluate((el) => el.tagName.toLowerCase()));
  const name =
    (await handle.getAttribute("aria-label")) ??
    (await handle.evaluate((el) => el.textContent?.trim() ?? "")) ??
    "";
  const state: string[] = [];
  if ((await handle.getAttribute("aria-expanded")) === "true") state.push("expanded");
  if ((await handle.getAttribute("aria-selected")) === "true") state.push("selected");
  if ((await handle.getAttribute("aria-checked")) === "true") state.push("checked");
  if ((await handle.getAttribute("aria-disabled")) === "true") state.push("disabled");
  if ((await handle.getAttribute("disabled")) !== null) state.push("disabled");
  return { role, name, state };
}
