/**
 * Atomic file write helper. Used by the wiki build pipeline so a partial
 * build (Ctrl-C, OOM, disk full mid-write) leaves no half-formed wiki
 * files. Mirrors the pattern in apps/mcp/eval/run-openrouter.ts'
 * atomicWriteJson.
 *
 * Strategy: write to <target>.tmp-<pid>-<ms> first, then rename onto the
 * final path. POSIX rename is atomic on the same filesystem; either the
 * old file or the new one is observable, never a partial.
 *
 * Returns true when the file's content changed (or didn't exist before),
 * false when the on-disk content was already identical. Lets the caller
 * count "files actually written" vs "files unchanged" without diffing.
 *
 * Creates parent directories as needed. Cleans up the .tmp file on
 * success.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export function atomicWriteFile(target: string, content: string): boolean {
  // Skip the write entirely if content is identical — keeps mtimes stable
  // and lets git treat unchanged files as unchanged. The caller still gets
  // an honest "did anything change" return value.
  if (existsSync(target)) {
    try {
      const existing = readFileSync(target, "utf-8");
      if (existing === content) return false;
    } catch {
      // Fall through to overwrite path
    }
  }

  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content);
  try {
    renameSync(tmp, target);
  } catch (err) {
    // Try to clean up the tmp on failure
    try {
      unlinkSync(tmp);
    } catch {
      // ignore — original error is the interesting one
    }
    throw err;
  }
  return true;
}
