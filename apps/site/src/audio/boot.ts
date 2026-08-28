/**
 * Audio boot — the only audio code that loads on every chapter page with
 * audio. Wires the Read / Listen / Read-along mode pills and lazy-loads the
 * engine + UI (and hls.js where needed) on first interaction, so a reader
 * who never touches audio pays nothing beyond this module.
 */
import type { MountData, PlayerMode } from "./types";
import type { Engine } from "./engine";
import type { Bar } from "./bar";
import type { Lyrics } from "./lyrics";

let engine: Engine | null = null;
let bar: Bar | null = null;
let lyrics: Lyrics | null = null;
let starting = false;

export function boot() {
  const mountEl = document.getElementById("falsafa-audio");
  if (!mountEl) return;
  const mount: MountData = JSON.parse(mountEl.dataset.audio!);
  const pills = Array.from(
    mountEl.querySelectorAll<HTMLButtonElement>(".mode-switcher [data-mode]"),
  );

  const setMode = (m: PlayerMode) => {
    for (const p of pills) {
      const on = p.dataset.mode === m;
      if (on) p.setAttribute("aria-current", "true");
      else p.removeAttribute("aria-current");
    }
    bar?.setAlongActive(m === "along");
  };

  // Warm the data cache the moment intent appears (press, not click) — the
  // sidecar fetch then races the gesture instead of following it.
  const warm = () => {
    fetch(`/audio/align/${mount.work}/book.json`).catch(() => {});
    fetch(`/audio/align/${mount.work}/ch/${mount.ch}.json`).catch(() => {});
  };
  let warmed = false;
  for (const p of pills) {
    p.addEventListener("pointerdown", () => { if (!warmed) { warmed = true; warm(); } });
    p.addEventListener("focus", () => { if (!warmed) { warmed = true; warm(); } });
  }

  async function ensureEngine(): Promise<{ e: Engine; b: Bar; l: Lyrics }> {
    if (engine && bar && lyrics) return { e: engine, b: bar, l: lyrics };
    const [{ Engine }, { Bar }, { Lyrics }] = await Promise.all([
      import("./engine"), import("./bar"), import("./lyrics"),
    ]);
    engine = new Engine(mount, mountEl!);
    (window as any).__falsafaAudio = engine; // debugging/console handle
    // prime must run in the *current* gesture's call stack — ensureEngine is
    // awaited from the click handler, so this is still within user activation
    engine.primeDecks();
    bar = new Bar(engine, {
      onAlongToggle: () => {
        if (lyrics!.isOpen()) lyrics!.hide();
        else { lyrics!.show(); setMode("along"); }
      },
      onClose: () => {
        lyrics?.isOpen() && lyrics.hide();
        engine?.stop();
        engine = null; bar = null; lyrics = null;
        setMode("read");
      },
    });
    lyrics = new Lyrics(engine, { onClose: () => setMode("listen") });
    return { e: engine, b: bar, l: lyrics };
  }

  async function enter(m: PlayerMode) {
    if (m === "read") {
      lyrics?.isOpen() && lyrics.hide();
      engine?.pause();
      setMode("read");
      return;
    }
    if (starting) return;
    const fresh = !engine;
    starting = true;
    try {
      const { e, l } = await ensureEngine();
      if (m === "along") { l.show(); }
      else if (l.isOpen()) l.hide();
      setMode(m);
      // `align` is only set once a chapter fully loaded — retry start() after
      // any earlier failure instead of toggling a deck parked at 0:00
      if (fresh || !e.align) await e.start();
      else if (!e.playing) await e.toggle();
    } catch (err) {
      console.error("[audio]", err);
      setMode("read");
    } finally {
      starting = false;
    }
  }

  for (const p of pills) {
    p.addEventListener("click", () => enter(p.dataset.mode as PlayerMode));
  }

  // Space toggles playback once a session exists (unless typing/focused on a control)
  document.addEventListener("keydown", (ev) => {
    if (!engine) return;
    const t = ev.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable], dialog")) return;
    if (ev.key === " " && !t.closest("button, a")) {
      ev.preventDefault();
      engine.toggle();
    } else if (ev.key === "ArrowLeft" && ev.shiftKey) engine.skip(-15);
    else if (ev.key === "ArrowRight" && ev.shiftKey) engine.skip(30);
  });
}

boot();
