/**
 * First-run corpus download. The corpus outgrew the npm tarball (879 works,
 * ~800 MB unpacked), so the package ships code only and pulls the corpus
 * snapshot from a GitHub Release on first run, caching it under the user's
 * cache directory. Verified by sha256 before extraction. After extraction,
 * an FTS5 search index is built locally when node:sqlite is available; the
 * server falls back to the filesystem scan without it.
 *
 * All progress goes to stderr: stdout belongs to the MCP protocol.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const CORPUS_RELEASE = {
  tag: "corpus-2026-06-11b",
  asset: "falsafa-corpus.tar.gz",
  sha256: "b5501638e5831451506da8d998e6cc74abd9968606cb3671ff87209ac3e0c425",
  works: 945,
};

const RELEASE_URL = `https://github.com/adoistic/falsafa/releases/download/${CORPUS_RELEASE.tag}/${CORPUS_RELEASE.asset}`;

export function cacheDir(): string {
  const base =
    process.env["XDG_CACHE_HOME"] ??
    (process.platform === "darwin" ? join(homedir(), "Library", "Caches") : join(homedir(), ".cache"));
  return join(base, "falsafa", CORPUS_RELEASE.tag);
}

/** The cached corpus path if it exists and looks whole, else null. */
export function cachedCorpus(): string | null {
  const dir = join(cacheDir(), "corpus");
  return existsSync(join(dir, "manifest.json")) ? dir : null;
}

export async function downloadCorpus(): Promise<string> {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const tarPath = join(dir, CORPUS_RELEASE.asset);

  console.error(
    `falsafa: first run downloads the corpus snapshot (${CORPUS_RELEASE.works} works, ~185 MB compressed, ~800 MB on disk)`,
  );
  console.error(`falsafa: ${RELEASE_URL}`);
  console.error(`falsafa: caching under ${dir}`);

  const res = await fetch(RELEASE_URL, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`corpus download failed: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tarPath));

  const hash = createHash("sha256").update(readFileSync(tarPath)).digest("hex");
  if (hash !== CORPUS_RELEASE.sha256) {
    rmSync(tarPath, { force: true });
    throw new Error(`corpus checksum mismatch: expected ${CORPUS_RELEASE.sha256}, got ${hash}`);
  }
  console.error("falsafa: checksum verified, extracting");

  const extractDir = join(dir, "extract-tmp");
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarPath, "-C", extractDir]);
  renameSync(join(extractDir, "corpus"), join(dir, "corpus"));
  rmSync(extractDir, { recursive: true, force: true });
  rmSync(tarPath, { force: true });

  buildSearchIndex(join(dir, "corpus"));
  return join(dir, "corpus");
}

/**
 * Build the FTS5 index locally from the paragraph sidecars. Quietly skipped
 * when node:sqlite is unavailable; search falls back to the scan.
 */
export function buildSearchIndex(corpusDir: string): void {
  const dbPath = join(corpusDir, "search.db");
  if (existsSync(dbPath)) return;
  let DatabaseSync: any;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    console.error("falsafa: node:sqlite unavailable; search uses the filesystem scan");
    return;
  }
  console.error("falsafa: building the search index (one-time, a minute or so)");
  try {
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
    db.exec(
      "CREATE VIRTUAL TABLE hits USING fts5(text, work_slug UNINDEXED, work_title UNINDEXED, chapter_number UNINDEXED, chapter_title UNINDEXED, chapter_slug UNINDEXED, variant UNINDEXED, language UNINDEXED, paragraph_id UNINDEXED, tokenize = 'porter unicode61');",
    );
    const manifest = JSON.parse(readFileSync(join(corpusDir, "manifest.json"), "utf-8"));
    const ins = db.prepare(
      "INSERT INTO hits (text, work_slug, work_title, chapter_number, chapter_title, chapter_slug, variant, language, paragraph_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const work of manifest.works) {
      const chaptersDir = join(corpusDir, "works", work.slug, "chapters");
      if (!existsSync(chaptersDir)) continue;
      db.exec("BEGIN");
      for (const chSlug of readdirSync(chaptersDir)) {
        const metaPath = join(chaptersDir, chSlug, "meta.json");
        if (!existsSync(metaPath)) continue;
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        for (const v of meta.variants) {
          const sidecar = join(chaptersDir, chSlug, v.file.replace(/\.md$/, ".paragraphs.json"));
          if (!existsSync(sidecar)) continue;
          for (const p of JSON.parse(readFileSync(sidecar, "utf-8"))) {
            ins.run(
              p.text,
              work.slug,
              work.title,
              meta.chapter_number,
              meta.chapter_title,
              chSlug,
              v.content_type,
              v.language?.toLowerCase() ?? "",
              p.id,
            );
          }
        }
      }
      db.exec("COMMIT");
    }
    db.exec("INSERT INTO hits(hits) VALUES('optimize');");
    db.close();
    console.error("falsafa: search index ready");
  } catch (e) {
    rmSync(dbPath, { force: true });
    console.error(`falsafa: index build failed (${(e as Error).message}); search uses the scan`);
  }
}
