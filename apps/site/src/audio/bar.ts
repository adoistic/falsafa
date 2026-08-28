/**
 * The listening bar — fixed to the bottom of the page while audio is active.
 * Material follows the site's consent-banner precedent: opaque paper, top
 * hairline, soft upward shadow, slide-up entrance. The scrubber is the 2px
 * hairline at the bar's very top edge (rule track, terracotta fill), with a
 * generous invisible hit area for touch.
 */
import type { Engine } from "./engine";
import { RATES } from "./engine";
import { icons } from "./icons";

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

export class Bar {
  root: HTMLElement;
  private engine: Engine;
  private els: Record<string, HTMLElement> = {};
  private scrubbing = false;
  private onAlongToggle: () => void;
  private onClose: () => void;

  constructor(engine: Engine, opts: { onAlongToggle: () => void; onClose: () => void }) {
    this.engine = engine;
    this.onAlongToggle = opts.onAlongToggle;
    this.onClose = opts.onClose;
    this.root = document.createElement("div");
    this.root.className = "audio-bar";
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Audio player");
    this.render();
    document.body.appendChild(this.root);
    document.body.classList.add("has-audio-bar");
    requestAnimationFrame(() => this.root.classList.add("audio-bar-in"));

    engine.on("state", () => this.sync());
    engine.on("time", (ms: number) => this.time(ms));
    engine.on("chapter", () => this.chapterInfo());
  }

  private render() {
    const m = this.engine.mount;
    this.root.innerHTML = `
      <span class="audio-live" aria-live="polite"></span>
      <div class="audio-scrub" role="slider" aria-label="Seek" tabindex="0"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
           aria-valuetext="0:00">
        <div class="audio-scrub-track"><div class="audio-scrub-fill"></div></div>
        <div class="audio-scrub-tip" hidden></div>
      </div>
      <div class="audio-bar-inner">
        <div class="audio-left">
          ${m.cover ? `<img class="audio-cover" src="${m.cover}" alt="" loading="lazy">` : ""}
          <div class="audio-titles">
            <a class="audio-ch-title" href="#"></a>
            <span class="audio-work-line"></span>
          </div>
        </div>
        <div class="audio-transport">
          <button class="audio-btn" data-a="back" aria-label="Back 15 seconds">${icons.back15}</button>
          <button class="audio-btn audio-btn-play" data-a="toggle" aria-label="Play">${icons.play}</button>
          <button class="audio-btn" data-a="fwd" aria-label="Forward 30 seconds">${icons.fwd30}</button>
        </div>
        <div class="audio-right">
          <span class="audio-time"><span class="audio-time-cur">0:00</span><span class="audio-time-sep"> / </span><span class="audio-time-dur">0:00</span></span>
          <div class="audio-rate-wrap">
            <button class="audio-btn audio-rate" data-a="rate" aria-haspopup="menu" aria-expanded="false" aria-label="Playback speed">1×</button>
            <div class="audio-rate-menu" role="menu" hidden></div>
          </div>
          <button class="audio-btn" data-a="along" aria-label="Read along" aria-pressed="false">${icons.lines}</button>
          <button class="audio-btn" data-a="close" aria-label="Stop listening">${icons.close}</button>
        </div>
      </div>`;
    const q = (sel: string) => this.root.querySelector(sel) as HTMLElement;
    this.els = {
      scrub: q(".audio-scrub"), fill: q(".audio-scrub-fill"), tip: q(".audio-scrub-tip"),
      chTitle: q(".audio-ch-title"), workLine: q(".audio-work-line"),
      play: q('[data-a="toggle"]'), cur: q(".audio-time-cur"), dur: q(".audio-time-dur"),
      rate: q(".audio-rate"), rateMenu: q(".audio-rate-menu"), along: q('[data-a="along"]'),
      live: q(".audio-live"),
    };
    this.chapterInfo();
    this.wire();
    this.sync();
  }

  private wire() {
    this.root.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null;
      if (!btn) return;
      const a = btn.dataset.a;
      if (a === "toggle") this.engine.toggle();
      else if (a === "back") this.engine.skip(-15);
      else if (a === "fwd") this.engine.skip(30);
      else if (a === "along") this.onAlongToggle();
      else if (a === "close") this.close();
      else if (a === "rate") this.toggleRateMenu();
    });

    // scrubber
    const scrub = this.els.scrub;
    const pctFromEvent = (ev: PointerEvent) => {
      const r = scrub.getBoundingClientRect();
      return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    };
    scrub.addEventListener("pointerdown", (ev) => {
      this.scrubbing = true;
      scrub.setPointerCapture(ev.pointerId);
      this.scrubPreview(pctFromEvent(ev));
    });
    scrub.addEventListener("pointermove", (ev) => {
      if (this.scrubbing) this.scrubPreview(pctFromEvent(ev));
    });
    const commit = (ev: PointerEvent) => {
      if (!this.scrubbing) return;
      this.scrubbing = false;
      this.els.tip.hidden = true;
      this.engine.seekChapter(pctFromEvent(ev) * this.engine.chapterDur());
    };
    scrub.addEventListener("pointerup", commit);
    scrub.addEventListener("pointercancel", () => {
      this.scrubbing = false; this.els.tip.hidden = true;
    });
    scrub.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
        ev.preventDefault(); this.engine.skip(-15);
      } else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
        ev.preventDefault(); this.engine.skip(30);
      } else if (ev.key === "Home") {
        ev.preventDefault(); this.engine.seekChapter(0);
      } else if (ev.key === "End") {
        ev.preventDefault(); this.engine.seekChapter(this.engine.chapterDur() - 5000);
      }
    });

    document.addEventListener("click", (e) => {
      if (!this.els.rateMenu.hidden &&
          !(e.target as HTMLElement).closest(".audio-rate-wrap")) {
        this.hideRateMenu();
      }
    });
  }

  private scrubPreview(pct: number) {
    this.els.fill.style.width = `${pct * 100}%`;
    const tip = this.els.tip;
    tip.hidden = false;
    tip.textContent = fmt(pct * this.engine.chapterDur());
    tip.style.left = `${pct * 100}%`;
  }

  private toggleRateMenu() {
    const menu = this.els.rateMenu;
    if (!menu.hidden) return this.hideRateMenu();
    menu.innerHTML = RATES.map((r) =>
      `<button role="menuitemradio" aria-checked="${r === this.engine.rate}" data-r="${r}">${r}×</button>`,
    ).join("");
    menu.hidden = false;
    this.els.rate.setAttribute("aria-expanded", "true");
    const items = [...menu.querySelectorAll<HTMLButtonElement>("[data-r]")];
    for (const b of items) {
      b.addEventListener("click", () => {
        this.engine.setRate(Number(b.dataset.r));
        this.hideRateMenu();
        this.els.rate.focus();
      });
    }
    menu.addEventListener("keydown", (ev) => {
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (ev.key === "ArrowDown") { ev.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      else if (ev.key === "Escape") { ev.stopPropagation(); this.hideRateMenu(); this.els.rate.focus(); }
      else if (ev.key === "Tab") this.hideRateMenu();
    });
    (items.find((b) => b.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
  }

  private hideRateMenu() {
    this.els.rateMenu.hidden = true;
    this.els.rate.setAttribute("aria-expanded", "false");
  }

  private chapterInfo() {
    const m = this.engine.mount;
    const c = this.engine.chapter();
    (this.els.chTitle as HTMLAnchorElement).textContent = c?.title || m.chTitle;
    (this.els.chTitle as HTMLAnchorElement).href =
      c ? `/works/${m.work}/${c.ch}/translation/` : "#";
    this.els.workLine.textContent = `${m.workTitle} · ${m.author}`;
    this.els.dur.textContent = fmt(this.engine.chapterDur());
  }

  private lastAnnounced = "";

  private sync() {
    const { playing, loading } = this.engine;
    this.els.play.innerHTML = loading ? icons.spinner : playing ? icons.pause : icons.play;
    this.els.play.classList.toggle("audio-loading", loading);
    this.els.play.setAttribute("aria-label", playing ? "Pause" : "Play");
    this.els.rate.textContent = `${this.engine.rate}×`;
    this.els.dur.textContent = fmt(this.engine.chapterDur());
    const state = loading ? "Loading" : playing ? "Playing" : "Paused";
    if (state !== this.lastAnnounced) {
      this.lastAnnounced = state;
      this.els.live.textContent =
        `${state} — ${this.engine.chapter()?.title ?? this.engine.mount.chTitle}`;
    }
  }

  setAlongActive(v: boolean) {
    this.els.along.setAttribute("aria-pressed", String(v));
    this.els.along.classList.toggle("audio-btn-active", v);
  }

  private time(ms: number) {
    if (this.scrubbing) return;
    this.els.cur.textContent = fmt(ms);
    const pct = this.engine.chapterDur() ? (ms / this.engine.chapterDur()) * 100 : 0;
    this.els.fill.style.width = `${pct}%`;
    this.els.scrub.setAttribute("aria-valuenow", pct.toFixed(1));
    this.els.scrub.setAttribute(
      "aria-valuetext", `${fmt(ms)} of ${fmt(this.engine.chapterDur())}`);
  }

  private close() {
    this.engine.pause();
    this.onClose();
    this.root.classList.remove("audio-bar-in");
    document.body.classList.remove("has-audio-bar");
    setTimeout(() => this.root.remove(), 450);
  }
}
