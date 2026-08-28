/**
 * Audio engine: dual-deck HLS playback with span scheduling.
 *
 * A work's audio lives in one or more long HLS streams (narration voice,
 * verse voice; epics have one stream per book). A chapter is a sequence of
 * SPANS — [streamIdx, startMs, endMs] in reading order — so mixed works
 * alternate voices mid-chapter. Two persistent <audio> elements ("decks")
 * make the switch seamless: while one plays a span, the other is already
 * attached and positioned at the next span's start.
 *
 * Platform rules baked in (see falsafa-audio HANDOFF research):
 * - Prefer NATIVE HLS when canPlayType says so (Safari/iOS: AVPlayer path
 *   survives screen lock best). hls.js/light is lazy-loaded elsewhere.
 * - Decks are primed (muted play/pause) inside the first user gesture so
 *   later programmatic play() calls are allowed, incl. under lock screen.
 * - Never pause on lifecycle events; UI updates ride on `timeupdate`,
 *   which keeps firing during background/locked playback.
 * - preservesPitch is the browser default — speed changes never alter pitch.
 */
import type { Book, ChapterAlign, MountData } from "./types";

const AUDIO_BASE = "/audio/align/";
const POS_KEY = (work: string) => `falsafa-audio:pos:${work}`;
const RATE_KEY = "falsafa-audio:rate";
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Span boundary guard: swap this many ms before the span's true end so a
 *  4 Hz timeupdate never overshoots into the next unit's audio. */
const BOUNDARY_MS = 120;

type HlsT = any;
let HlsMod: any = null;

function nativeHls(): boolean {
  const a = document.createElement("audio");
  return a.canPlayType("application/vnd.apple.mpegurl") !== "";
}

class Deck {
  el: HTMLAudioElement;
  hls: HlsT | null = null;
  url: string | null = null;
  private metaReady: Promise<void> | null = null;
  private destroyed = false;
  /** True while the muted unlock-play's deferred pause is still pending —
   *  the engine "claims" the deck before real playback so that deferred
   *  pause can't kill the user's first listen (it lands whenever the media
   *  actually starts, often AFTER the engine's own play()). */
  private primePending = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement("audio");
    this.el.preload = "none";
    container.appendChild(this.el);
  }

  /** Unlock the element inside a user gesture (muted play/pause). */
  prime(url: string) {
    if (this.url) return;
    this.el.muted = true;
    this.attach(url);
    this.primePending = true;
    const settle = () => {
      this.el.muted = false;
      if (this.primePending) { this.primePending = false; this.el.pause(); }
    };
    const p = this.el.play();
    if (p) p.then(settle).catch(settle);
  }

  /** The engine takes ownership before a real play — cancels prime's
   *  deferred pause and unmutes immediately. */
  claim() {
    this.primePending = false;
    this.el.muted = false;
  }

  attach(url: string) {
    if (this.url === url) return;
    this.url = url;
    this.destroyHls();
    if (nativeHls()) {
      this.el.src = url;
      this.metaReady = new Promise((res) => {
        const done = () => { this.el.removeEventListener("loadedmetadata", done); res(); };
        if (this.el.readyState >= 1) return res();
        this.el.addEventListener("loadedmetadata", done);
      });
      this.el.load();
    } else {
      this.metaReady = (async () => {
        if (!HlsMod) HlsMod = (await import("hls.js/light")).default;
        // superseded (re-attached to a different url) or destroyed while the
        // import was in flight — bail before creating an instance that would
        // fight the current one over the media element
        if (this.destroyed || this.url !== url) return;
        const hls = new HlsMod({
          startLevel: 0,
          testBandwidth: false,
          enableWorker: false,
          lowLatencyMode: false,
          maxBufferLength: 60,
          maxBufferSize: 10_000_000,
          backBufferLength: 90,
          fragLoadPolicy: { default: {
            maxTimeToFirstByteMs: 20000,
            maxLoadTimeMs: 120000,
            timeoutRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
            errorRetry: { maxNumRetry: 8, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
          } },
        });
        this.hls = hls;
        hls.on(HlsMod.Events.ERROR, (_e: any, data: any) => {
          if (!data.fatal) return;
          if (data.type === "networkError") hls.startLoad();
          else if (data.type === "mediaError") hls.recoverMediaError();
        });
        hls.loadSource(url);
        hls.attachMedia(this.el);
        await new Promise<void>((res) => {
          hls.once ? hls.once(HlsMod.Events.MANIFEST_PARSED, () => res())
                   : hls.on(HlsMod.Events.MANIFEST_PARSED, () => res());
        });
      })();
    }
  }

  async seek(sec: number) {
    await this.metaReady;
    // Native: a seek before metadata is silently dropped; metaReady guards it.
    this.el.currentTime = sec;
  }

  private destroyHls() {
    if (this.hls) { this.hls.destroy(); this.hls = null; }
  }

  destroy() {
    this.destroyed = true;
    this.destroyHls();
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.remove();
  }
}

type Listener = (...a: any[]) => void;

export class Engine {
  mount: MountData;
  book: Book | null = null;
  align: ChapterAlign | null = null;
  chapterIdx = -1;

  private decks: Deck[] = [];
  private activeDeck = 0;
  private spans: [number, number, number][] = [];
  private cum: number[] = [];
  private spanIdx = 0;
  private listeners = new Map<string, Set<Listener>>();
  private saveTimer: number | undefined;
  private alignCache = new Map<string, ChapterAlign>();

  playing = false;
  loading = false;
  rate = 1;
  /** >0 while a seek/advance is in flight — boundary checks pause then.
   *  timeupdate events keep arriving mid-await with stale spanIdx and would
   *  otherwise double-advance (the old deck then never pauses). */
  private busy = 0;
  /** Bumped by every user/system pause. Async continuations that captured a
   *  wasPlaying snapshot re-check it before play(), so a pause issued during
   *  an in-flight seek/advance (e.g. from the lock screen) is never undone. */
  private pauseEpoch = 0;
  private dead = false;
  private onVis = () => {
    if (document.visibilityState === "hidden") this.savePos();
  };
  private onPageHide = () => this.savePos();

  constructor(mount: MountData, container: HTMLElement) {
    this.mount = mount;
    const saved = Number(localStorage.getItem(RATE_KEY));
    if (RATES.includes(saved)) this.rate = saved;
    this.decks = [new Deck(container), new Deck(container)];
    for (const d of this.decks) {
      d.el.addEventListener("timeupdate", () => this.onTime(d));
      d.el.addEventListener("waiting", () => { if (d === this.active()) this.setLoading(true); });
      d.el.addEventListener("stalled", () => { if (d === this.active()) this.setLoading(true); });
      d.el.addEventListener("playing", () => { if (d === this.active()) this.setLoading(false); });
      d.el.addEventListener("canplay", () => { if (d === this.active()) this.setLoading(false); });
      d.el.addEventListener("ended", () => { if (d === this.active()) this.advanceSpan(); });
      // playback state is OWNED by the element (lock screens and hardware
      // keys can drive it directly); mirror it rather than shadowing it
      d.el.addEventListener("play", () => {
        if (d === this.active()) { this.playing = true; this.emit("state"); }
      });
      d.el.addEventListener("pause", () => {
        if (d === this.active()) { this.playing = false; this.savePos(); this.emit("state"); }
      });
    }
    document.addEventListener("visibilitychange", this.onVis);
    window.addEventListener("pagehide", this.onPageHide);
  }

  on(ev: string, fn: Listener) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(fn);
  }
  private emit(ev: string, ...a: any[]) {
    this.listeners.get(ev)?.forEach((fn) => fn(...a));
  }

  private active() { return this.decks[this.activeDeck]; }

  /** Must be called synchronously inside the first user gesture. The second
   *  deck only exists for multi-stream (mixed-voice) works — single-stream
   *  works never swap, so priming it would just double-fetch the stream. */
  primeDecks() {
    const urls = this.mount.streams.map((s) => s.url);
    this.decks[0].prime(urls[0]);
    if (urls[1]) this.decks[1].prime(urls[1]);
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const r = await fetch(AUDIO_BASE + path);
    if (!r.ok) throw new Error(`audio data ${r.status}: ${path}`);
    return r.json();
  }

  private async loadBook(): Promise<Book> {
    if (!this.book) {
      this.book = await this.fetchJson<Book>(`${this.mount.work}/book.json`);
    }
    return this.book;
  }

  private async loadAlign(ch: string): Promise<ChapterAlign> {
    let a = this.alignCache.get(ch);
    if (!a) {
      a = await this.fetchJson<ChapterAlign>(`${this.mount.work}/ch/${ch}.json`);
      this.alignCache.set(ch, a);
      if (this.alignCache.size > 4) {
        const first = this.alignCache.keys().next().value;
        if (first && first !== ch) this.alignCache.delete(first);
      }
    }
    return a;
  }

  /** Begin playback of a chapter. atMs = position within the chapter. */
  async start(ch?: string, atMs?: number) {
    this.setLoading(true);
    const book = await this.loadBook();
    const chSlug = ch ?? this.mount.ch;
    const idx = book.chapters.findIndex((c) => c.ch === chSlug);
    if (idx === -1) { this.setLoading(false); throw new Error(`no audio for ${chSlug}`); }

    // resume position: explicit atMs wins; else saved position for this chapter
    let at = atMs ?? 0;
    if (atMs === undefined) {
      const saved = this.readPos();
      if (saved && saved.ch === chSlug && saved.t > 4000 &&
          saved.t < book.chapters[idx].dur - 4000) {
        at = saved.t - 2000; // rewind a breath
      }
    }
    await this.setChapter(idx);
    await this.seekChapter(at, { thenPlay: true });
  }

  private async setChapter(idx: number) {
    const book = this.book!;
    this.chapterIdx = idx;
    const c = book.chapters[idx];
    this.spans = c.spans;
    this.cum = [];
    let acc = 0;
    for (const [, s, e] of this.spans) { this.cum.push(acc); acc += e - s; }
    this.align = await this.loadAlign(c.ch);
    this.setMediaSession();
    this.emit("chapter", c.ch);
  }

  chapter() { return this.book?.chapters[this.chapterIdx]; }
  chapterDur() { return this.chapter()?.dur ?? this.mount.durMs; }

  /** Map a (stream url, stream ms) pair into chapter time. The lyrics view
   *  uses this to place sidecar word times on the chapter's clock. */
  chapterTimeOf(streamUrl: string, ms: number): number | null {
    for (let i = 0; i < this.spans.length; i++) {
      const [si, s, e] = this.spans[i];
      if (this.streamUrl(si) === streamUrl && ms >= s - 1000 && ms <= e + 1000) {
        return this.cum[i] + Math.max(0, ms - s);
      }
    }
    return null;
  }

  /** Current position within the chapter, ms. */
  chapterMs(): number {
    const d = this.active();
    const t = d.el.currentTime * 1000;
    const [_, s] = this.spans[this.spanIdx] ?? [0, 0, 0];
    return Math.max(0, Math.min((this.cum[this.spanIdx] ?? 0) + t - s, this.chapterDur()));
  }

  /** The stream-and-time a chapter position maps to. */
  private locate(ms: number): { span: number; streamSec: number } {
    let k = 0;
    for (let i = 0; i < this.spans.length; i++) {
      if (ms >= this.cum[i]) k = i; else break;
    }
    const [, s] = this.spans[k];
    return { span: k, streamSec: (s + (ms - this.cum[k])) / 1000 };
  }

  private streamUrl(streamIdx: number): string {
    return this.book!.streams[streamIdx].url;
  }

  private deckFor(url: string): Deck {
    const found = this.decks.find((d) => d.url === url);
    if (found) return found;
    // reuse the inactive deck
    const idle = this.decks[1 - this.activeDeck];
    idle.attach(url);
    return idle;
  }

  async seekChapter(ms: number, opts: { thenPlay?: boolean } = {}) {
    this.busy++;
    try {
      if (!this.spans.length) return;   // chapter not set yet — drop the seek
      ms = Math.max(0, Math.min(ms, this.chapterDur() - 50));
      const { span, streamSec } = this.locate(ms);
      this.spanIdx = span;
      const url = this.streamUrl(this.spans[span][0]);
      const deck = this.deckFor(url);
      const wasPlaying = this.playing || !!opts.thenPlay;
      const epoch = this.pauseEpoch;
      if (deck !== this.active()) {
        this.active().el.pause();
        this.activeDeck = this.decks.indexOf(deck);
      }
      deck.attach(url);
      deck.el.playbackRate = this.rate;
      await deck.seek(streamSec);
      if (wasPlaying && epoch === this.pauseEpoch) {
        deck.claim();
        try { await deck.el.play(); this.playing = true; } catch { this.playing = false; }
      }
      this.preloadNextSpan();
      this.positionState();
      this.emit("state");
      this.emit("time", ms);
      this.savePos();
    } finally {
      this.busy--;
    }
  }

  private preloadNextSpan() {
    const next = this.spans[this.spanIdx + 1];
    if (!next) return;
    const url = this.streamUrl(next[0]);
    if (url === this.active().url) return;
    const idle = this.decks[1 - this.activeDeck];
    idle.attach(url);
    idle.el.playbackRate = this.rate;
    idle.seek(next[1] / 1000);
  }

  private onTime(d: Deck) {
    if (d !== this.active()) {
      // HARD INVARIANT: only the active deck is ever audible. Whatever race
      // (priming, preload, stray gesture) starts an idle deck, silence it.
      if (!d.el.paused) d.el.pause();
      return;
    }
    if (this.loading) this.setLoading(false); // progress implies not stalled
    const [, , e] = this.spans[this.spanIdx] ?? [0, 0, Infinity];
    if (this.busy === 0 && d.el.currentTime * 1000 >= e - BOUNDARY_MS) {
      this.advanceSpan();
      return;
    }
    this.emit("time", this.chapterMs());
    if (this.playing && this.saveTimer === undefined) {
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = undefined;
        this.savePos();
      }, 5000);
    }
  }

  private async advanceSpan() {
    if (this.busy > 0) return;
    this.busy++;
    try {
      if (this.spanIdx + 1 < this.spans.length) {
        const wasPlaying = this.playing;
        const epoch = this.pauseEpoch;
        const cur = this.spans[this.spanIdx];
        const next = this.spans[this.spanIdx + 1];
        this.spanIdx++;   // committed before any await — stale checks see it
        const url = this.streamUrl(next[0]);
        const deck = this.deckFor(url);
        if (deck !== this.active()) {
          this.active().el.pause();
          this.activeDeck = this.decks.indexOf(deck);
          deck.el.playbackRate = this.rate;
          // preload should already have parked the deck at the span start
          if (Math.abs(deck.el.currentTime * 1000 - next[1]) > 400) {
            await deck.seek(next[1] / 1000);
          }
          if (wasPlaying && epoch === this.pauseEpoch) {
            deck.claim();
            try { await deck.el.play(); } catch { /* gesture */ }
          }
        } else {
          // same stream: only seek if there is a real gap
          const gap = next[1] - cur[2];
          if (Math.abs(gap) > 250) await deck.seek(next[1] / 1000);
        }
        this.preloadNextSpan();
        this.positionState();
        this.emit("time", this.chapterMs());
        return;
      }
      // chapter finished
      const book = this.book!;
      if (this.chapterIdx + 1 < book.chapters.length) {
        await this.setChapter(this.chapterIdx + 1);
        this.busy--;                       // hand off to seekChapter's own lock
        try { await this.seekChapter(0, { thenPlay: this.playing }); }
        finally { this.busy++; }           // rebalanced by the outer finally
      } else {
        this.pause();
        this.emit("finished");
      }
    } finally {
      this.busy--;
    }
  }

  async toggle() {
    if (this.playing) this.pause();
    else {
      const d = this.active();
      d.el.playbackRate = this.rate;
      d.claim();
      try { await d.el.play(); this.playing = true; } catch { /* not allowed */ }
      this.emit("state");
    }
  }

  pause() {
    this.pauseEpoch++;
    this.active().el.pause();
    this.playing = false;
    this.savePos();
    this.positionState();
    this.emit("state");
  }

  skip(deltaSec: number) {
    return this.seekChapter(this.chapterMs() + deltaSec * 1000);
  }

  setRate(r: number) {
    this.rate = r;
    for (const d of this.decks) d.el.playbackRate = r;
    localStorage.setItem(RATE_KEY, String(r));
    this.positionState();
    this.emit("state");
  }

  async prevChapter() {
    if (this.chapterMs() > 5000 || this.chapterIdx === 0) return this.seekChapter(0);
    this.busy++;   // setChapter swaps the span table; hold boundary checks off
    try { await this.setChapter(this.chapterIdx - 1); }
    finally { this.busy--; }
    await this.seekChapter(0, { thenPlay: this.playing });
  }

  async nextChapter() {
    if (this.chapterIdx + 1 >= (this.book?.chapters.length ?? 0)) return;
    this.busy++;
    try { await this.setChapter(this.chapterIdx + 1); }
    finally { this.busy--; }
    await this.seekChapter(0, { thenPlay: this.playing });
  }

  stop() {
    this.savePos();
    this.dead = true;
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    document.removeEventListener("visibilitychange", this.onVis);
    window.removeEventListener("pagehide", this.onPageHide);
    if ("mediaSession" in navigator) {
      for (const a of ["play", "pause", "seekbackward", "seekforward", "seekto",
                       "previoustrack", "nexttrack"] as MediaSessionAction[]) {
        try { navigator.mediaSession.setActionHandler(a, null); } catch { /* ok */ }
      }
      navigator.mediaSession.metadata = null;
    }
    for (const d of this.decks) d.destroy();
    this.playing = false;
    this.emit("state");
  }

  private setLoading(v: boolean) {
    if (this.loading !== v) { this.loading = v; this.emit("state"); }
  }

  // ── persistence ──────────────────────────────────────────────────────

  private readPos(): { ch: string; t: number } | null {
    try {
      const raw = localStorage.getItem(POS_KEY(this.mount.work));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  private savePos() {
    if (this.dead) return;   // a stray timer/lifecycle event after stop()
                             // would clobber the position stop() just saved
    const c = this.chapter();
    if (!c) return;
    try {
      localStorage.setItem(POS_KEY(this.mount.work),
        JSON.stringify({ ch: c.ch, t: Math.round(this.chapterMs()), at: Date.now() }));
    } catch { /* quota */ }
  }

  // ── media session ────────────────────────────────────────────────────

  private setMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const c = this.chapter();
    const art = this.mount.cover
      ? [{ src: this.mount.cover, sizes: "512x512", type: "image/webp" }]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: c?.title || this.mount.workTitle,
      artist: `${this.mount.author} · ${this.mount.workTitle}`,
      artwork: art,
    });
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => this.toggle());
    ms.setActionHandler("pause", () => this.pause());
    ms.setActionHandler("seekbackward", (d) => this.skip(-(d.seekOffset ?? 15)));
    ms.setActionHandler("seekforward", (d) => this.skip(d.seekOffset ?? 30));
    try {
      ms.setActionHandler("seekto", (d) => {
        if (d.seekTime != null) this.seekChapter(d.seekTime * 1000);
      });
    } catch { /* older browsers */ }
    ms.setActionHandler("previoustrack", () => this.prevChapter());
    ms.setActionHandler("nexttrack", () => this.nextChapter());
    this.positionState();
  }

  private positionState() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const dur = this.chapterDur() / 1000;
    if (!Number.isFinite(dur) || dur <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: Math.min(this.chapterMs() / 1000, dur),
        playbackRate: this.rate,
      });
    } catch { /* invalid transient state */ }
  }
}
