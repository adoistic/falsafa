/**
 * Read-along view — a full-page reading surface that follows the voice.
 *
 * Deliberately closer to a book page than to karaoke: the chapter renders as
 * continuous prose/verse in the reader's own serif; sentences (prose) or
 * poetic lines (verse) are the structural unit; inside the active line a
 * 2-3 word chunk carries a quiet highlighter wash that steps with speech.
 * Three layers of ink opacity (past / active / upcoming), never bold-swaps,
 * never layout shifts. Auto-scroll keeps the active line ~34% from the top
 * and yields to the reader's own scrolling (a return chip brings it back).
 */
import type { Engine } from "./engine";
import type { AlignLine } from "./types";
import { icons } from "./icons";

interface Chunk {
  el: HTMLElement;
  s: number; // chapter ms
  e: number;
  lineEl: HTMLElement;
}

const CHUNK_MAX_WORDS = 3;
const CHUNK_MAX_MS = 1300;

export class Lyrics {
  root: HTMLElement;
  private engine: Engine;
  private scroller: HTMLElement;
  private content: HTMLElement;
  private returnChip: HTMLElement;
  private chunks: Chunk[] = [];
  private activeChunk = -1;
  private activeLine: HTMLElement | null = null;
  private follow = true;
  private lastAutoScroll = 0;
  private open = false;
  private onClose: () => void;
  private get reduced() {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  constructor(engine: Engine, opts: { onClose: () => void }) {
    this.engine = engine;
    this.onClose = opts.onClose;
    this.root = document.createElement("div");
    this.root.className = "lyrics";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Read along");
    this.root.innerHTML = `
      <header class="lyrics-head">
        <span class="lyrics-kicker">read along</span>
        <span class="lyrics-source"></span>
        <button class="lyrics-close audio-btn" aria-label="Back to reading">${icons.close}</button>
      </header>
      <div class="lyrics-scroll" tabindex="0" role="region" aria-label="Chapter text, following the narration">
        <div class="lyrics-content"></div>
      </div>
      <button class="lyrics-return" hidden>${icons.chevronDown} Return to the voice</button>`;
    this.scroller = this.root.querySelector(".lyrics-scroll") as HTMLElement;
    this.content = this.root.querySelector(".lyrics-content") as HTMLElement;
    this.returnChip = this.root.querySelector(".lyrics-return") as HTMLElement;
    document.body.appendChild(this.root);

    (this.root.querySelector(".lyrics-close") as HTMLElement)
      .addEventListener("click", () => this.hide());
    this.returnChip.addEventListener("click", () => {
      this.follow = true;
      this.returnChip.hidden = true;
      this.scrollToActive(true);
    });
    // Reader-initiated scrolling suspends auto-follow. A bare scroll event
    // counts as the reader's only when a real input gesture (wheel, touch,
    // scrollbar mousedown, keys) happened just before — programmatic
    // scrolls (render, animation, resize clamps) never carry one.
    let lastGesture = 0;
    for (const ev of ["wheel", "touchstart", "mousedown", "keydown"] as const) {
      this.scroller.addEventListener(ev, () => { lastGesture = Date.now(); },
        { passive: true });
    }
    for (const ev of ["wheel", "touchmove"] as const) {
      this.scroller.addEventListener(ev, () => this.suspendFollow(), { passive: true });
    }
    this.scroller.addEventListener("scroll", () => {
      if (Date.now() - this.lastAutoScroll > 700 &&
          Date.now() - lastGesture < 1500) this.suspendFollow();
    }, { passive: true });

    this.content.addEventListener("click", (e) => {
      const ln = (e.target as HTMLElement).closest("[data-cms]") as HTMLElement | null;
      if (!ln) return;
      this.follow = true;
      this.returnChip.hidden = true;
      this.engine.seekChapter(Number(ln.dataset.cms));
    });

    engine.on("time", (ms: number) => { if (this.open) this.sync(ms); });
    engine.on("chapter", () => { if (this.open) this.render(); });

    document.addEventListener("keydown", (ev) => {
      if (this.open && ev.key === "Escape") { ev.stopPropagation(); this.hide(); }
    });
  }

  private lastFocus: HTMLElement | null = null;

  private suspendFollow() {
    if (!this.follow) return;
    this.follow = false;
    this.returnChip.hidden = false;
    cancelAnimationFrame(this.scrollAnim);   // stop fighting the reader
  }

  show() {
    this.open = true;
    this.follow = true;
    this.returnChip.hidden = true;
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.render();
    this.root.classList.add("lyrics-in");
    document.body.classList.add("lyrics-open");
    this.scroller.focus({ preventScroll: true });
    this.sync(this.engine.chapterMs(), true);
  }

  hide() {
    this.open = false;
    this.root.classList.remove("lyrics-in");
    document.body.classList.remove("lyrics-open");
    this.lastFocus?.focus?.();
    this.onClose();
  }

  isOpen() { return this.open; }

  /** Build the chapter surface from the alignment sidecar. */
  private render() {
    const align = this.engine.align;
    const c = this.engine.chapter();
    this.chunks = [];
    this.activeChunk = -1;
    this.activeLine = null;
    // wiping/refilling content fires scroll events on the scroller; they are
    // ours, not the reader's — don't let them suspend auto-follow
    this.lastAutoScroll = Date.now();
    this.follow = true;
    this.returnChip.hidden = true;
    const w = this.engine.mount.workTitle;
    (this.root.querySelector(".lyrics-source") as HTMLElement).textContent =
      c && c.title !== w ? `${w} — ${c.title}` : w;
    this.content.innerHTML = "";
    if (!align) return;

    const frag = document.createDocumentFragment();
    for (const block of align.blocks) {
      const streamUrl = align.streams[block.stream].url;
      const p = document.createElement("p");
      p.className = block.kind === "verse" ? "lyr-p lyr-verse" : "lyr-p";
      for (const line of block.lines) {
        const lineEl = this.renderLine(line, streamUrl);
        if (lineEl) p.appendChild(lineEl);
        if (block.kind === "prose") p.appendChild(document.createTextNode(" "));
      }
      if (p.childNodes.length) frag.appendChild(p);
    }
    this.content.appendChild(frag);
    this.chunks.sort((a, b) => a.s - b.s);
  }

  private renderLine(line: AlignLine, streamUrl: string): HTMLElement | null {
    const cms = this.engine.chapterTimeOf(streamUrl, line.s);
    if (cms === null) return null;
    const el = document.createElement("span");
    el.className = "lyr-ln";
    el.dataset.cms = String(Math.max(0, Math.round(cms)));

    // group words into chunks: <=3 words, <=1.3s
    const words = line.w;
    let i = 0;
    let cursor = 0;
    while (i < words.length) {
      let j = i;
      while (
        j + 1 < words.length &&
        j - i + 1 < CHUNK_MAX_WORDS &&
        words[j + 1][1] - words[i][0] <= CHUNK_MAX_MS
      ) j++;
      const [s0, , off0] = words[i];
      const [, e1, off1, len1] = words[j];
      // whitespace / stray text between previous chunk and this one
      if (off0 > cursor) el.appendChild(document.createTextNode(line.t.slice(cursor, off0)));
      const ck = document.createElement("span");
      ck.className = "lyr-ck";
      ck.textContent = line.t.slice(off0, off1 + len1);
      el.appendChild(ck);
      const sMs = this.engine.chapterTimeOf(streamUrl, s0);
      const eMs = this.engine.chapterTimeOf(streamUrl, e1);
      if (sMs !== null && eMs !== null) {
        this.chunks.push({ el: ck, s: sMs, e: eMs, lineEl: el });
      }
      cursor = off1 + len1;
      i = j + 1;
    }
    if (cursor < line.t.length) {
      el.appendChild(document.createTextNode(line.t.slice(cursor)));
    }
    return el;
  }

  /** Advance highlight to the chunk containing chapter-time ms. */
  private sync(ms: number, force = false) {
    if (!this.chunks.length) return;
    // before the first chunk begins, nothing should be lit yet
    if (ms < this.chunks[0].s - 250) {
      if (this.activeChunk >= 0) this.chunks[this.activeChunk].el.classList.remove("on");
      this.activeChunk = -1;
      return;
    }
    // binary search: last chunk with s <= ms
    let lo = 0, hi = this.chunks.length - 1, idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.chunks[mid].s <= ms) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx === this.activeChunk && !force) return;

    const prev = this.chunks[this.activeChunk];
    const cur = this.chunks[idx];
    if (prev) prev.el.classList.remove("on");
    cur.el.classList.add("on");
    this.activeChunk = idx;

    if (cur.lineEl !== this.activeLine) {
      if (this.activeLine) {
        this.activeLine.classList.remove("on");
        this.activeLine.classList.add("past");
      }
      // everything before stays "past"; upcoming lines keep default styling
      cur.lineEl.classList.remove("past");
      cur.lineEl.classList.add("on");
      this.activeLine = cur.lineEl;
      if (this.follow) this.scrollToActive();
    }
  }

  private scrollAnim = 0;

  private scrollToActive(instant = false) {
    if (!this.activeLine) return;
    const lineRect = this.activeLine.getBoundingClientRect();
    const scRect = this.scroller.getBoundingClientRect();
    const target = Math.max(0, this.scroller.scrollTop + (lineRect.top - scRect.top)
      - scRect.height * 0.34);
    cancelAnimationFrame(this.scrollAnim);
    this.lastAutoScroll = Date.now();
    if (this.reduced || instant) {
      this.scroller.scrollTop = target;
      return;
    }
    // Hand-rolled animation: element scrollTo({behavior:"smooth"}) silently
    // no-ops in Chromium when the page has html{scroll-behavior:smooth}
    // (same bug the citation scroller works around in Reader.astro).
    const from = this.scroller.scrollTop;
    const dist = target - from;
    if (Math.abs(dist) < 2) return;
    const dur = Math.min(650, 250 + Math.abs(dist) * 0.25);
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      this.scroller.scrollTop = from + dist * ease;
      this.lastAutoScroll = Date.now();
      if (p < 1) this.scrollAnim = requestAnimationFrame(step);
    };
    this.scrollAnim = requestAnimationFrame(step);
  }
}
