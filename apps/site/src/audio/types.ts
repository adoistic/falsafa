/**
 * Shared types for the audio layer. The data contract is produced by
 * falsafa-audio/pipeline/align_merge.py and served from /audio/align/.
 * All times are milliseconds from the start of the referenced stream
 * unless a name says otherwise ("chapterMs" = position within the
 * chapter's stitched span sequence).
 */

/** One HLS stream (a voice track; epics have one per book). */
export interface StreamRef {
  id: string;
  url: string;
  dur: number;
}

/** align/<work>/book.json */
export interface Book {
  v: 1;
  slug: string;
  streams: StreamRef[];
  chapters: BookChapter[];
}

export interface BookChapter {
  ch: string;
  title: string;
  dur: number;
  /** [streamIdx, startMs, endMs] in reading order; mixed works interleave. */
  spans: [number, number, number][];
}

/** align/<work>/ch/<chapter>.json */
export interface ChapterAlign {
  v: 1;
  work: string;
  ch: string;
  streams: StreamRef[];
  blocks: AlignBlock[];
}

/** One source paragraph with word timings. */
export interface AlignBlock {
  /** DOM paragraph id (p-xxxxxx) in the reader page, when known. */
  p: string | null;
  kind: "verse" | "prose";
  /** Index into ChapterAlign.streams. */
  stream: number;
  s: number;
  e: number;
  lines: AlignLine[];
}

export interface AlignLine {
  s: number;
  e: number;
  /** The line's text (verse line or prose sentence). */
  t: string;
  /** [startMs, endMs, charOff, charLen] per word, offsets into `t`. */
  w: [number, number, number, number][];
}

/** Build-time mount payload rendered into the page by AudioMode.astro. */
export interface MountData {
  work: string;
  ch: string;
  workTitle: string;
  chTitle: string;
  author: string;
  cover: string | null;
  durMs: number;
  /** Stream URLs known statically so a deck can be primed inside the
   *  first user gesture, before any JSON fetch resolves. */
  streams: { id: string; url: string }[];
}

export type PlayerMode = "read" | "listen" | "along";

export interface EngineEvents {
  /** Playback state or mode changed (play/pause/loading/chapter). */
  state: () => void;
  /** ~4 Hz while playing: chapterMs advanced. */
  time: (chapterMs: number) => void;
  /** A different chapter became active (auto-advance). */
  chapter: (ch: string) => void;
}
