#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type ThemeTokens = Record<string, string>;
export type ParsedTokens = {
  light: ThemeTokens;
  dark?: ThemeTokens;
  sepia?: ThemeTokens;
};

interface Pair {
  fg: string;
  bg: string;
  kind: "text" | "large-text" | "ui";
  min: number;
}

const PAIRS: Pair[] = [
  { fg: "--ink", bg: "--paper", kind: "text", min: 4.5 },
  { fg: "--ink-muted", bg: "--paper", kind: "text", min: 4.5 },
  { fg: "--accent", bg: "--paper", kind: "text", min: 4.5 },
  { fg: "--accent-soft", bg: "--paper", kind: "text", min: 4.5 },
  { fg: "--rule", bg: "--paper", kind: "ui", min: 3 },
];

export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(parseHex(a));
  const lb = relLuminance(parseHex(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) throw new Error(`bad hex: ${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function parseTokens(css: string): ParsedTokens {
  return {
    light: extractBlock(css, /:root\s*\{([\s\S]*?)\}/) ?? {},
    dark: extractBlock(css, /\[data-theme=["']dark["']\]\s*\{([\s\S]*?)\}/),
    sepia: extractBlock(css, /\[data-theme=["']sepia["']\]\s*\{([\s\S]*?)\}/),
  };
}

function extractBlock(css: string, re: RegExp): ThemeTokens | undefined {
  const m = css.match(re);
  if (!m) return undefined;
  const out: ThemeTokens = {};
  for (const line of m[1]!.split("\n")) {
    const v = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
    if (v) out[v[1]!] = v[2]!.trim().replace(/\s*\/\*.*$/, "");
  }
  return out;
}

interface Failure {
  theme: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  kind: string;
}
interface AuditResult {
  passed: number;
  failures: Failure[];
}

export function auditPairs(tokens: ParsedTokens): AuditResult {
  const failures: Failure[] = [];
  let passed = 0;
  for (const themeName of Object.keys(tokens) as Array<keyof ParsedTokens>) {
    const t = tokens[themeName];
    if (!t) continue;
    for (const p of PAIRS) {
      const fg = t[p.fg];
      const bg = t[p.bg];
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio < p.min) {
        failures.push({ theme: themeName, fg: p.fg, bg: p.bg, ratio, min: p.min, kind: p.kind });
      } else {
        passed++;
      }
    }
  }
  return { passed, failures };
}

async function main(): Promise<void> {
  const css = readFileSync("apps/site/src/styles/tokens.css", "utf8");
  const tokens = parseTokens(css);
  const result = auditPairs(tokens);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(`docs/accessibility/test-runs/contrast/${ts}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "result.json"), JSON.stringify(result, null, 2));
  const latestDir = resolve("docs/accessibility/test-runs/contrast/latest");
  mkdirSync(latestDir, { recursive: true });
  writeFileSync(resolve(latestDir, "result.json"), JSON.stringify(result, null, 2));

  if (result.failures.length > 0) {
    console.error(`Contrast audit FAILED. ${result.failures.length} failures, ${result.passed} passing:`);
    for (const f of result.failures) {
      console.error(`  [${f.theme}] ${f.fg} on ${f.bg} = ${f.ratio.toFixed(2)}:1 (need ${f.min}:1 ${f.kind})`);
    }
    process.exit(1);
  }
  console.log(`Contrast audit PASSED. ${result.passed} pairs verified.`);
}

if (import.meta.main) await main();
