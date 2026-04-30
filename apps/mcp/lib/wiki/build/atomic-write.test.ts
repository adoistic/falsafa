import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "falsafa-atomic-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("atomicWriteFile", () => {
  test("writes content to the target path", () => {
    const target = join(tmp, "out.md");
    atomicWriteFile(target, "hello\nworld\n");
    expect(readFileSync(target, "utf-8")).toBe("hello\nworld\n");
  });

  test("creates parent directories as needed", () => {
    const target = join(tmp, "deep/nested/dir/out.md");
    atomicWriteFile(target, "nested\n");
    expect(readFileSync(target, "utf-8")).toBe("nested\n");
  });

  test("overwrites existing file", () => {
    const target = join(tmp, "out.md");
    atomicWriteFile(target, "first\n");
    atomicWriteFile(target, "second\n");
    expect(readFileSync(target, "utf-8")).toBe("second\n");
  });

  test("does not leave .tmp file behind on success", () => {
    const target = join(tmp, "out.md");
    atomicWriteFile(target, "content\n");
    // No leftover tmp files in the parent dir
    const tmpFiles = require("node:fs")
      .readdirSync(tmp)
      .filter((f: string) => f.includes(".tmp"));
    expect(tmpFiles).toEqual([]);
  });

  test("returns true if content changed, false if identical", () => {
    const target = join(tmp, "out.md");
    expect(atomicWriteFile(target, "first\n")).toBe(true); // first write
    expect(atomicWriteFile(target, "first\n")).toBe(false); // no change
    expect(atomicWriteFile(target, "different\n")).toBe(true); // change
  });

  test("returns true on first write to nonexistent target", () => {
    const target = join(tmp, "fresh.md");
    expect(existsSync(target)).toBe(false);
    expect(atomicWriteFile(target, "x\n")).toBe(true);
  });
});
