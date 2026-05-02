import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const MCP_CONFIG = resolve(import.meta.dir, "../../../../.github/scripts/falsafa-mcp-config.json");

describe("run-claude-cli smoke", () => {
  test("invokes claude --print with mcp-config and parses JSON envelope", async () => {
    // Skipped by default (depends on claude CLI auth + npx cache).
    // Enable manually with `RUN_CLAUDE_SMOKE=1 bun test`.
    if (!process.env.RUN_CLAUDE_SMOKE) {
      console.error("skip: RUN_CLAUDE_SMOKE not set");
      return;
    }
    const proc = spawn("claude", [
      "--print",
      "--bare",
      "--mcp-config", MCP_CONFIG,
      "--allowedTools", "mcp__falsafa__list_works",
      "--output-format", "json",
    ], { stdio: ["pipe", "pipe", "pipe"], timeout: 60_000 });
    proc.stdin.write("List 3 works by Cynewulf as JSON.\n");
    proc.stdin.end();
    let stdout = "";
    proc.stdout.on("data", (c) => stdout += c.toString());
    await new Promise((res) => proc.on("close", res));
    const env = JSON.parse(stdout);
    expect(typeof env.result).toBe("string");
    expect(typeof env.usage).toBe("object");
    expect(typeof env.usage.input_tokens).toBe("number");
  });
});
