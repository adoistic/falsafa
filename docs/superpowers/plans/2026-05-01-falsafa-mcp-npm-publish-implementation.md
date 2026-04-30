# `@falsafa/mcp` v0.1.0 npm Publish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@falsafa/mcp` v0.1.0 to npm so anyone can run `npx -y @falsafa/mcp` and get a working stdio MCP server pointing at the Falsafa corpus.

**Architecture:** Two-phase. **Phase A** (local file changes): wire `prepack` script + cross-platform corpus copy + version bump + stderr startup log + LICENSE + npm-page README. **Phase B** (CI + first publish): GitHub Action triggered on `v*.*.*` tag pushes that builds, copies corpus, publishes with `--provenance`, then runs a cross-platform smoke test (ubuntu/macos/windows) that asserts `tools/list` returns 10 tools and `list_works` returns content. No runtime code changes — `apps/mcp/src/corpus.ts` already handles bundled-next-to-dist path resolution.

**Tech Stack:** Bun (build), Node 20+ (runtime), npm (registry + publish), GitHub Actions (CI), JSON-RPC 2.0 over stdio (MCP protocol), `@modelcontextprotocol/sdk` (server transport).

**Spec:** `docs/superpowers/specs/2026-05-01-falsafa-mcp-npm-publish-design.md` (spec-document-reviewer Approved 9/10; 4 polish items applied).

**CEO plan:** `~/.gstack/projects/falsafa/ceo-plans/2026-05-01-falsafa-mcp-npm-publish.md` (mode SELECTIVE EXPANSION; 9 decisions accepted).

---

## Pre-flight knowledge for the implementer

Before opening any file, the implementer should know:

1. **Working directory:** `/Users/siraj/falsafa`. Branch: `main` (no worktree).
2. **The package is at `apps/mcp/`.** When the spec says "edit `package.json`", it means `apps/mcp/package.json`. The repo-root `package.json` is the monorepo workspace coordinator — don't touch it.
3. **The corpus lives at `/Users/siraj/falsafa/corpus/` (repo root).** The package needs it copied INTO `apps/mcp/corpus/` before publish. npm sandboxes the package directory — it can't reach up to `../../corpus` at unpack time. The `prepack` script handles this.
4. **`apps/mcp/src/corpus.ts:23-39` already has `resolveCorpusRoot()`** with a 4-fallback path resolution that includes the bundled-next-to-dist case. Verified during the CEO review. **Do not modify `corpus.ts`.**
5. **`apps/mcp/src/index.ts:36` instantiates `Corpus`** as `const corpus = new Corpus()`. Insert the new stderr log line on the next line.
6. **Verified accessor names:** `corpus.rootPath` (getter, `corpus.ts:145`) and `corpus.works()` (method, `corpus.ts:157`). Both exist on the live class.
7. **Bun is the local build tool** (`bun build ./src/index.ts --target=node --outdir=./dist --format=esm`). Verified working: 218 modules → ~511KB single ESM file in 32ms.
8. **The corpus is 104MB on disk.** Compressed in the npm tarball: roughly 30-50MB.
9. **NPM scope `@falsafa` is unclaimed** as of the CEO review (registry returned 404 for `@falsafa/mcp`). Pre-flight Task 8 verifies before publish.
10. **The `apps/mcp/src/tools.ts` exports 10 tools.** When the smoke test asserts the tool list, the expected names are: `compare_works`, `find_related`, `get_metadata`, `get_passage`, `list_chapters`, `list_works`, `read_chapter`, `read_wiki`, `read_wiki_full`, `search_corpus`.

---

## File structure

| File | Status | Lines | Responsibility |
|---|---|---|---|
| `apps/mcp/scripts/copy-corpus.mjs` | NEW | ~25 | Cross-platform corpus copy via `fs.cpSync`. Runs in `prepack`. |
| `apps/mcp/LICENSE` | NEW | ~21 | Verbatim MIT copy from repo root. |
| `apps/mcp/package.json` | MODIFY | +5 fields | `prepack`, `publishConfig`, version, description, author. |
| `apps/mcp/src/index.ts` | MODIFY | +2 lines | Stderr startup log line after Corpus construction. |
| `apps/mcp/README.md` | REWRITE | ~120 | npm-page audience: install, tools, corpus, license. |
| `.github/scripts/smoke-mcp.mjs` | NEW | ~75 | JSON-RPC stdio smoke test for the published binary. |
| `.github/workflows/npm-publish.yml` | NEW | ~50 | Tag-triggered publish + cross-platform smoke matrix. |

Plus three out-of-source actions (Phase B):
- Verify `@falsafa` npm scope ownership (one shell command, document outcome).
- Provision `NPM_TOKEN` GitHub secret (npm UI + GitHub UI; one-time human step).
- Tag + push (`git tag v0.1.0 && git push origin v0.1.0`).

---

## Chunk 1: Local file changes (Phase A)

Five tasks. All work locally; no external dependencies. Each task is committable independently. Tests = `bun build` succeeds + (where applicable) `npm pack --dry-run` shows the expected file list.

### Task 1: `apps/mcp/scripts/copy-corpus.mjs` (cross-platform corpus copy)

**Files:**
- Create: `apps/mcp/scripts/copy-corpus.mjs`

- [ ] **Step 1: Create the file**

Create `/Users/siraj/falsafa/apps/mcp/scripts/copy-corpus.mjs` with this exact content:

```js
// Copy ../../corpus into ./corpus before npm pack/publish.
// Cross-platform via fs.cpSync (node 16+). Replaces `cp -r`,
// which fails on Windows when contributors run `npm pack` locally.
//
// Runs from apps/mcp/ (npm sets cwd to package dir on lifecycle scripts,
// regardless of which directory the developer ran `npm` from).
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));   // apps/mcp/scripts/
const src = resolve(here, "..", "..", "..", "corpus");   // /falsafa/corpus
const dst = resolve(here, "..", "corpus");               // apps/mcp/corpus

if (!existsSync(src)) {
  console.error(`[copy-corpus] source not found: ${src}`);
  process.exit(1);
}

// Clean dst first so removed files in src don't linger in old copies.
if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });

cpSync(src, dst, { recursive: true });
console.error(`[copy-corpus] copied ${src} → ${dst}`);
```

- [ ] **Step 2: Verify the script runs**

Run: `cd /Users/siraj/falsafa/apps/mcp && node scripts/copy-corpus.mjs`
Expected stdout/stderr:
```
[copy-corpus] copied /Users/siraj/falsafa/corpus → /Users/siraj/falsafa/apps/mcp/corpus
```

- [ ] **Step 3: Verify the corpus copy is real**

Run: `ls /Users/siraj/falsafa/apps/mcp/corpus/manifest.json && du -sh /Users/siraj/falsafa/apps/mcp/corpus`
Expected: `manifest.json` exists; total size ~104MB.

- [ ] **Step 4: Verify idempotency (run a second time, should clean + recopy)**

Run: `cd /Users/siraj/falsafa/apps/mcp && node scripts/copy-corpus.mjs && ls corpus/manifest.json`
Expected: same success message, manifest.json still present.

- [ ] **Step 5: Commit (just the script, NOT the copied corpus)**

The copied `apps/mcp/corpus/` should NOT be committed — it's a build artifact regenerated by `prepack` on every publish. Add it to `.gitignore` if it isn't already:

```bash
cd /Users/siraj/falsafa
grep -q "^apps/mcp/corpus/$" .gitignore || echo "apps/mcp/corpus/" >> .gitignore
```

Then commit only the new script:

```bash
git add apps/mcp/scripts/copy-corpus.mjs .gitignore
git commit -m "feat(mcp): cross-platform corpus copy script for npm prepack

Replaces `cp -r ../../corpus ./corpus` (which fails on Windows
contributors running npm pack locally) with fs.cpSync. Runs from
apps/mcp/scripts/ via the prepack lifecycle hook (added in a
following commit). Copied apps/mcp/corpus/ is gitignored — it's a
build artifact regenerated on every prepack."
```

### Task 2: `apps/mcp/LICENSE` (npm-required, package boundary)

**Files:**
- Create: `apps/mcp/LICENSE` (verbatim copy from repo root)

- [ ] **Step 1: Confirm repo-root LICENSE exists**

Run: `head -3 /Users/siraj/falsafa/LICENSE`
Expected output should start with `MIT License` (or similar). If it's something else, STOP and ask — don't copy something that contradicts `package.json`'s `"license": "MIT"`.

- [ ] **Step 2: Copy verbatim**

```bash
cp /Users/siraj/falsafa/LICENSE /Users/siraj/falsafa/apps/mcp/LICENSE
```

**Do not symlink.** Symlink behavior in npm pack varies; literal copy is what npm expects.

- [ ] **Step 3: Verify the copy**

Run: `diff /Users/siraj/falsafa/LICENSE /Users/siraj/falsafa/apps/mcp/LICENSE`
Expected: no output (files identical).

- [ ] **Step 4: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/mcp/LICENSE
git commit -m "feat(mcp): add LICENSE for npm package boundary

npm sandboxes the package directory at publish time. Without a
LICENSE inside apps/mcp/, the published tarball would lack one —
npm warns and contradicts package.json's \"license\": \"MIT\". This
is a verbatim copy of the repo-root LICENSE."
```

### Task 3: `apps/mcp/package.json` edits

**Files:**
- Modify: `apps/mcp/package.json` (5 changes)

- [ ] **Step 1: Read the current state**

Run: `cat /Users/siraj/falsafa/apps/mcp/package.json`
Confirm the file matches the spec's "current state" (version `0.0.1`, description starts with "Open-source MCP server", author `"Adnan"`, no `prepack` script, no `publishConfig`).

- [ ] **Step 2: Apply the 5 edits**

Edit `/Users/siraj/falsafa/apps/mcp/package.json` to apply exactly these changes:

(a) `version`: `"0.0.1"` → `"0.1.0"`

(b) `description`: replace the current value with:
```
"Open-source MCP server for the Falsafa corpus. Ten librarian-flavored tools (eight catalog tools plus read_wiki and read_wiki_full for the rule-based wiki layer) so any LLM (Claude, ChatGPT, Hermes via OpenRouter, etc.) can navigate the catalog without an API key."
```

(c) `author`: `"Adnan"` → `"Adnan Abbasi <adnan@thothica.com> (https://meetadnan.com)"`

(d) Add a new `publishConfig` field after `"files"`:
```jsonc
  "publishConfig": {
    "access": "public"
  },
```

(e) Add a new `prepack` script. Insert as the LAST script entry (after `eval:case`):
```jsonc
    "prepack": "node scripts/copy-corpus.mjs && bun build ./src/index.ts --target=node --outdir=./dist --format=esm"
```

The full final file should look exactly like the spec's Section 1 JSONC block.

- [ ] **Step 3: Verify JSON validity**

Run: `cat /Users/siraj/falsafa/apps/mcp/package.json | python3 -m json.tool > /dev/null && echo OK`
Expected: `OK`. If it errors, fix the JSON syntax.

- [ ] **Step 4: Verify the prepack hook works end-to-end**

Run: `cd /Users/siraj/falsafa/apps/mcp && bun run prepack && ls dist/index.js && ls corpus/manifest.json`
Expected:
- `[copy-corpus] copied ...` log line
- `Bundled X modules in YYms` log line
- `index.js` listed under `dist/`
- `manifest.json` listed under `corpus/`

- [ ] **Step 5: Verify the tarball would now be non-trivial**

Run: `cd /Users/siraj/falsafa/apps/mcp && npm pack --dry-run 2>&1 | tail -10`
Expected: tarball includes `dist/index.js`, `corpus/manifest.json`, `corpus/works/`, `LICENSE`, `README.md`. Total file count > 1,000. "package size" line shows > 20MB.

- [ ] **Step 6: Add `apps/mcp/dist/` to .gitignore (also a build artifact)**

```bash
cd /Users/siraj/falsafa
grep -q "^apps/mcp/dist/$" .gitignore || echo "apps/mcp/dist/" >> .gitignore
```

- [ ] **Step 7: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/mcp/package.json .gitignore
git commit -m "feat(mcp): wire prepack + publishConfig + bump to v0.1.0

Five edits to apps/mcp/package.json:
- version: 0.0.1 -> 0.1.0 (first npm publish; honest pre-paper signal)
- description: 'Eight' -> 'Ten' tools (names read_wiki + read_wiki_full)
- author: bare 'Adnan' -> 'Adnan Abbasi <adnan@thothica.com>
  (https://meetadnan.com)' (npm-standard format)
- publishConfig.access: public (scoped pkg defaults to private; npm
  publish would 402 without this — hard requirement)
- scripts.prepack: runs copy-corpus.mjs then bun build, fires on both
  npm pack --dry-run AND npm publish (parity for local sanity check)

Plus apps/mcp/dist/ gitignored (build artifact, regenerated by prepack)."
```

### Task 4: `apps/mcp/src/index.ts` startup log line

**Files:**
- Modify: `apps/mcp/src/index.ts:36-37` (insert two lines)

- [ ] **Step 1: Read the current Corpus instantiation**

Run: `sed -n '34,42p' /Users/siraj/falsafa/apps/mcp/src/index.ts`
You should see (approximately):
```ts

// ── Tools ──────────────────────────────────────────────────────────────
const corpus = new Corpus();

const TOOLS = [
```

(Exact line numbers may drift; the anchor is `const corpus = new Corpus();`.)

- [ ] **Step 2: Confirm `rootPath` and `works()` accessors still exist on Corpus**

Run: `grep -n "rootPath\|works()" /Users/siraj/falsafa/apps/mcp/src/corpus.ts | head -3`
Expected: should show a `get rootPath(): string` getter and a `works(): ManifestWork[]` method. If the names have drifted (e.g., renamed to `getRoot()`), use whatever the live class exposes — adjust the log line to match.

- [ ] **Step 3: Insert the log line right after `const corpus = new Corpus();`**

Edit `/Users/siraj/falsafa/apps/mcp/src/index.ts` to add two lines immediately after `const corpus = new Corpus();`:

```ts
const corpus = new Corpus();
const works = corpus.works();
console.error(`[falsafa-mcp] corpus loaded: ${works.length} works from ${corpus.rootPath}`);
```

The blank line after — and the rest of the file — stay as they are.

- [ ] **Step 4: Verify the build still succeeds**

Run: `cd /Users/siraj/falsafa/apps/mcp && bun build ./src/index.ts --target=node --outdir=/tmp/falsafa-build-check --format=esm 2>&1 | tail -3`
Expected: `Bundled X modules in Yms`, no errors.

- [ ] **Step 5: Verify the log line appears at runtime**

Run: `cd /Users/siraj/falsafa && node /tmp/falsafa-build-check/index.js 2>&1 < /dev/null | head -1`
Expected: `[falsafa-mcp] corpus loaded: 37 works from /Users/siraj/falsafa/corpus` (or similar — exact path depends on the resolution chain).

The process will then hang waiting for stdio input. Kill with Ctrl-C — that's normal.

Clean up: `rm -rf /tmp/falsafa-build-check`

- [ ] **Step 6: Verify existing tests still pass**

Run: `cd /Users/siraj/falsafa/apps/mcp && bun test 2>&1 | tail -3`
Expected: all tests pass (no regressions). The added log line is in the runtime path, not test path.

- [ ] **Step 7: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/mcp/src/index.ts
git commit -m "feat(mcp): stderr startup log shows corpus path resolution

When a user reports 'MCP server isn't responding,' the first question
is 'which corpus did it load?' Without this log, debugging path-
resolution issues requires asking the user to set FALSAFA_CORPUS=
and re-run. With it, stderr shows the resolved path + work count
on every startup.

stderr (not stdout): MCP transport uses stdout for JSON-RPC; logging
there breaks the protocol. stderr shows up in Claude Desktop's MCP
server logs."
```

### Task 5: `apps/mcp/README.md` rewrite for npm-page audience

**Files:**
- Modify (full rewrite): `apps/mcp/README.md`

- [ ] **Step 1: Read the current README to understand what's there**

Run: `wc -l /Users/siraj/falsafa/apps/mcp/README.md && head -30 /Users/siraj/falsafa/apps/mcp/README.md`
Expected: ~80 lines, predates the wiki layer, mentions 8 tools.

- [ ] **Step 2: Verify `read_wiki_full` algorithm list against current code**

(Per spec Section 5 reviewer note: the README will document `read_wiki_full` content. Verify the actual algorithms before locking in the prose, since npm registry copy is hard to walk back without a republish.)

Run: `ls /Users/siraj/falsafa/apps/mcp/lib/wiki/ && head -15 /Users/siraj/falsafa/apps/mcp/lib/wiki/render-full.ts 2>/dev/null`
Expected: should show modules for `ngrams`, `npmi`, `textrank`, `lexrank`, `refrains`, `stylometry`, etc. Note which ones are imported into `render-full.ts` — those are what `read_wiki_full` actually surfaces. Use the matching set in the README prose. If the renderer drops one (e.g., LexRank), don't claim it.

- [ ] **Step 3: Rewrite `apps/mcp/README.md`**

Replace the full file content with this (~120 lines):

```markdown
# Falsafa MCP

Stdio MCP server for the Falsafa corpus. Ten librarian-flavored tools so any
LLM client (Claude Desktop, Claude Code, Cursor, Codex, or any MCP-aware host)
can navigate 37 translated philosophical and classical works through
paragraph-stable citations. No API key, no setup beyond `npx`.

```bash
npx -y @falsafa/mcp
```

## Install in your daily LLM

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "falsafa": { "command": "npx", "args": ["-y", "@falsafa/mcp"] }
  }
}
```

Restart Claude Desktop. The Falsafa tools show up in the tool palette. Ask
"what works does Cynewulf have?" and the model calls `list_works({ author: "cynewulf" })`.

### Claude Code

```bash
claude mcp add falsafa npx -y @falsafa/mcp
```

### Cursor / Codex / any stdio MCP client

Point your client at the command:

```bash
npx -y @falsafa/mcp
```

## Tools

Ten tools. Eight for catalog navigation, two for the rule-based wiki layer.

- **`list_works`** — list works in the corpus with optional author / era / genre / language filters
- **`list_chapters`** — list chapters of a specific work
- **`get_metadata`** — full metadata + variant counts for a work
- **`read_chapter`** — full chapter text. Body is annotated with `[p-XXXXXX]` paragraph-id markers; use those for paragraph citations.
- **`get_passage`** — read specific paragraphs by id list or 0-indexed range. Each result has a `citation_url` ready to drop into a markdown footnote.
- **`search_corpus`** — search English bodies. Distinctive 2-3 word phrases work best.
- **`find_related`** — TF-IDF-based related chapters, with a structural fallback.
- **`compare_works`** — side-by-side pointer chapters for two works on a topic.
- **`read_wiki`** — rule-based wiki card (~280 tokens) for a work or chapter. Use BEFORE `read_chapter` to scan what's worth a deep read. Cards are deterministic, generated from the corpus by classical statistical algorithms — zero LLM tokens in any output. Each card includes verbatim openings, closings, and key passages with `[p-XXXXXX]` cite handles.
- **`read_wiki_full`** — heavier wiki sheet (~1,500 tokens) with the deeper statistical detail layered on top of the card. Opt-in for deep analysis; most queries should use `read_wiki` first and only escalate when needed.

## What's in the corpus

37 works spanning Old English Christian poetry (Cynewulf), Urdu ghazal masters
(Ghalib, Iqbal, Zauq), French Enlightenment political theory (Comte, Dunoyer),
German philosophical writing (Fichte), Sanskrit smṛti traditions, and Old
Javanese / Kawi tattva texts. Each work ships with the original-language
source, a Latin-script transliteration where it makes sense, and an English
translation. Every paragraph has a stable content-derived ID (`p-xxxxxx`) so
citations survive reformatting.

**Translations and transliterations are AI-assisted.** AI can make
mistakes — when accuracy matters, verify against the original-language
source linked on each chapter page. Translations are produced by
[Thothica](https://thothica.com)'s pipeline across Claude / GPT / Gemini.
Underlying source archives:

- **Old English** (Cynewulf, OE Elegies) — [sacred-texts.com](https://sacred-texts.com/)
- **Sanskrit smṛti corpus** — [GRETIL](http://gretil.sub.uni-goettingen.de/gretil.html), Göttingen Register of Electronic Texts in Indian Languages
- **Allama Iqbal** (Bāng-i-Darā) — [allamaiqbal.com](http://allamaiqbal.com), Iqbal Academy Pakistan
- **Mirza Ghalib + Sheikh Ibrahim Zauq** — printed editions

Full source acknowledgments at [falsafa.ai/about/#sources](https://falsafa.ai/about/#sources).

## Links

- **falsafa.ai** — reading site, eval explorer, thesis on why this design
- **falsafa.ai/thesis/#methodology** — how eval scoring works (deterministic citation check; no LLM judge)
- **GitHub** — [adoistic/falsafa](https://github.com/adoistic/falsafa) for source

## License

MIT.
```

(Adjust the `read_wiki_full` paragraph if Step 2 found that the renderer drops or adds an algorithm.)

- [ ] **Step 4: Verify the README renders cleanly as markdown**

Run: `cd /Users/siraj/falsafa/apps/mcp && head -5 README.md && wc -l README.md`
Expected: starts with `# Falsafa MCP`, ~120 lines.

- [ ] **Step 5: Commit**

```bash
cd /Users/siraj/falsafa
git add apps/mcp/README.md
git commit -m "feat(mcp): rewrite README for npm-page audience

Audience differs from the repo's top-level README. Visitors arriving
at npmjs.com/package/@falsafa/mcp see this README — they need:

- The install command + Claude Desktop / Claude Code / Cursor / Codex
  config snippets
- 10-tool list with one-line descriptions
- 'What's in the corpus' with the AI-assisted-translation caveat
  (mirrors the falsafa.ai footer caveat) and source archive credits
- Links to falsafa.ai for the thesis + eval explorer

Tight (~120 lines), scannable, copy-paste-ready. Does NOT duplicate
the repo-top-level README's strategic framing — that lives at
falsafa.ai for visitors who want the deeper thesis."
```

---

## Chunk 2: CI pipeline (Phase B)

Two tasks. Both new files. The smoke script is created first so the workflow can reference it.

### Task 6: `.github/scripts/smoke-mcp.mjs` (cross-platform JSON-RPC stdio assertions)

**Files:**
- Create: `.github/scripts/smoke-mcp.mjs`

- [ ] **Step 1: Confirm `.github/scripts/` directory exists or create it**

Run: `ls /Users/siraj/falsafa/.github/scripts/ 2>/dev/null || mkdir -p /Users/siraj/falsafa/.github/scripts/`
Expected: directory exists (or is created silently).

- [ ] **Step 2: Create the smoke script**

Create `/Users/siraj/falsafa/.github/scripts/smoke-mcp.mjs` with this exact content:

```js
// Spawn `falsafa-mcp` (the published binary), send list_tools + list_works
// as JSON-RPC over stdio, assert the responses are well-formed and contain
// expected fields. Cross-platform: pure node, no shell pipes.
//
// Run by .github/workflows/npm-publish.yml's smoke job on
// ubuntu/macos/windows after the package is published.
import { spawn } from "node:child_process";

const proc = spawn("falsafa-mcp", [], { stdio: ["pipe", "pipe", "inherit"] });

const send = (req) => proc.stdin.write(JSON.stringify(req) + "\n");

const responses = [];
let buf = "";
proc.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.trim()) {
      try { responses.push(JSON.parse(line)); }
      catch (e) { console.error("non-JSON stdout line:", line); }
    }
  }
});

// Poll-with-timeout helper — robust against cold Windows runners under load.
const waitFor = (id, timeoutMs) => new Promise((resolve, reject) => {
  const start = Date.now();
  const check = () => {
    const r = responses.find((x) => x.id === id);
    if (r) return resolve(r);
    if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for id=${id}`));
    setTimeout(check, 100);
  };
  check();
});

// MCP requires an `initialize` handshake before tool calls.
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1.0" }
  }
});
await waitFor(1, 5000);

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await waitFor(2, 5000);

send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "list_works", arguments: {} }
});
await waitFor(3, 10000);

proc.stdin.end();

const initRes = responses.find((r) => r.id === 1);
const listToolsRes = responses.find((r) => r.id === 2);
const listWorksRes = responses.find((r) => r.id === 3);

const fail = (msg, body) => {
  console.error(`FAIL: ${msg}`);
  if (body) console.error(JSON.stringify(body, null, 2));
  process.exit(1);
};

if (!initRes?.result) fail("initialize did not return a result", initRes);
if (!listToolsRes?.result?.tools?.length || listToolsRes.result.tools.length < 8) {
  fail("tools/list returned fewer than 8 tools", listToolsRes);
}

const tools = listToolsRes.result.tools.map((t) => t.name).sort();
const expected = [
  "compare_works", "find_related", "get_metadata", "get_passage",
  "list_chapters", "list_works", "read_chapter", "read_wiki",
  "read_wiki_full", "search_corpus"
];
for (const e of expected) {
  if (!tools.includes(e)) fail(`missing expected tool: ${e}`, { tools });
}

if (!listWorksRes?.result?.content?.length) {
  fail("list_works returned no content", listWorksRes);
}

console.log(`PASS: ${tools.length} tools, ${listWorksRes.result.content.length} content blocks from list_works`);
proc.kill();
```

- [ ] **Step 3: Local smoke against the (not-yet-published) build**

Test the script against the local build to catch syntax / logic errors before CI:

```bash
cd /Users/siraj/falsafa/apps/mcp && bun run prepack
# Symlink the built binary so smoke-mcp.mjs's `falsafa-mcp` resolves
mkdir -p /tmp/falsafa-bin
ln -sf /Users/siraj/falsafa/apps/mcp/dist/index.js /tmp/falsafa-bin/falsafa-mcp
chmod +x /tmp/falsafa-bin/falsafa-mcp
PATH="/tmp/falsafa-bin:$PATH" node /Users/siraj/falsafa/.github/scripts/smoke-mcp.mjs
```

Expected output: `PASS: 10 tools, ...`

If it fails, debug locally — fix the script before committing. Common failure: stdio buffering, missing initialize handshake, JSON-RPC field name typos.

Cleanup: `rm -rf /tmp/falsafa-bin`

- [ ] **Step 4: Commit**

```bash
cd /Users/siraj/falsafa
git add .github/scripts/smoke-mcp.mjs
git commit -m "feat(ci): smoke-mcp.mjs — JSON-RPC stdio assertions for published pkg

Cross-platform pure-node smoke test invoked by the npm-publish
workflow's matrix job (ubuntu/macos/windows) after `npm install -g
@falsafa/mcp` succeeds. Asserts:

1. The MCP initialize handshake returns a result (binary boots,
   transport works).
2. tools/list returns >= 8 tools and includes all 10 expected names
   (compare_works, find_related, get_metadata, get_passage,
   list_chapters, list_works, read_chapter, read_wiki,
   read_wiki_full, search_corpus).
3. list_works returns non-empty content (catches partial-corpus copy
   — the most likely failure mode of the prepack step).

Uses waitFor(id, timeoutMs) polling instead of fixed sleeps; race-
proof against cold Windows runners under load."
```

### Task 7: `.github/workflows/npm-publish.yml` (tag-triggered publish + smoke matrix)

**Files:**
- Create: `.github/workflows/npm-publish.yml`

- [ ] **Step 1: Confirm `.github/workflows/` exists**

Run: `ls /Users/siraj/falsafa/.github/workflows/ 2>/dev/null || mkdir -p /Users/siraj/falsafa/.github/workflows/`
Expected: directory exists.

- [ ] **Step 2: Create the workflow file**

Create `/Users/siraj/falsafa/.github/workflows/npm-publish.yml` with this exact content:

```yaml
name: npm publish

on:
  push:
    tags: ['v*.*.*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write           # required for `npm publish --provenance`
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: bun install --frozen-lockfile
      - name: Build + copy corpus (via prepack)
        working-directory: apps/mcp
        run: |
          node scripts/copy-corpus.mjs
          bun build ./src/index.ts --target=node --outdir=./dist --format=esm
      - name: Sanity check tarball
        working-directory: apps/mcp
        run: npm pack --dry-run
      - name: Publish
        working-directory: apps/mcp
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  smoke:
    needs: publish
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
      fail-fast: false           # collect all OS results even if one fails
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Wait for npm propagation
        shell: bash
        run: sleep 30
      - name: Install published package
        run: npm install -g @falsafa/mcp
      - name: Smoke test stdio MCP
        run: node ${{ github.workspace }}/.github/scripts/smoke-mcp.mjs
```

- [ ] **Step 3: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('/Users/siraj/falsafa/.github/workflows/npm-publish.yml'))" && echo OK`
Expected: `OK`. If it errors, fix the YAML syntax (most common: indentation, missing colons).

- [ ] **Step 4: Verify the workflow shows up in `gh workflow list`**

Run: `cd /Users/siraj/falsafa && gh workflow list 2>&1 | head -5` (after the file is committed)
Expected: a row for "npm publish". The workflow is tag-triggered so it won't run yet.

(If `gh` isn't installed or isn't authed, skip this step. The actual trigger is tag-push.)

- [ ] **Step 5: Commit**

```bash
cd /Users/siraj/falsafa
git add .github/workflows/npm-publish.yml
git commit -m "feat(ci): npm-publish workflow (tag-triggered)

Triggers on push of v*.*.* tags. Two jobs:

1. publish (ubuntu-latest):
   - bun install --frozen-lockfile
   - cd apps/mcp && node scripts/copy-corpus.mjs && bun build
   - npm pack --dry-run (sanity)
   - npm publish --provenance --access public
     - id-token: write permission required for --provenance OIDC
     - NPM_TOKEN secret required (provisioned manually one-time)
     - --provenance gives free supply-chain trust badge on npmjs.com
     - --access public belt-and-suspenders with publishConfig.access

2. smoke (matrix: ubuntu/macos/windows):
   - sleep 30 for npm CDN propagation
   - npm install -g @falsafa/mcp
   - node smoke-mcp.mjs (asserts 10 tools + list_works content)
   - fail-fast: false collects all OS results

Future bumps: git tag v0.2.0 && git push --tags fires this entire
flow. Manual publish from local is no longer required."
```

---

## Chunk 3: Pre-flight + first publish

Three tasks. Two are one-time human steps; one is the actual tag-push that triggers the workflow.

### Task 8: Pre-flight — verify npm scope + provision NPM_TOKEN

**Files:** none (out-of-tree manual steps).

- [ ] **Step 1: Verify `@falsafa` npm scope ownership**

Run (locally, with `npm` logged into the publishing account):
```bash
npm whoami
npm org ls falsafa 2>&1
```

**Three possible outcomes** — handle each:

- **Account logged in + scope unclaimed** (most likely): `npm org ls falsafa` errors with `E404` or similar. Action: nothing. npm auto-creates the scope on first publish under your account.
- **Account logged in + scope already owned by current user**: `npm org ls falsafa` lists members. Action: nothing — already yours.
- **Scope owned by someone else**: `npm org ls falsafa` shows membership but you're not listed. **STOP.** Do NOT continue. Pivot to `falsafa-mcp` (unscoped) — change `name`, `bin`, all README references. Do NOT publish under a scope someone else owns.

Document the outcome (e.g., paste the command output into the next commit's body, or attach a comment in `TODOS.md`).

- [ ] **Step 2: Provision `NPM_TOKEN` GitHub secret (one-time)**

1. Log into npmjs.com → Account Settings → Access Tokens.
2. Click "Generate New Token" → choose **Automation**. (Automation tokens publish + bypass 2FA, required for tag-triggered CI.)
3. Copy the token (one-time display).
4. GitHub repo → Settings → Secrets and Variables → Actions → New repository secret.
5. Name: `NPM_TOKEN`. Value: paste the token. Save.

Verify the secret exists:
```bash
gh secret list 2>&1 | grep NPM_TOKEN
```
Expected: a row showing `NPM_TOKEN` with a recent timestamp.

(If `gh` isn't authed, verify visually in the GitHub Settings UI.)

- [ ] **Step 3: No commit needed** — these are out-of-tree manual steps. Document in a one-line note in `TODOS.md` if you want a paper trail. Capture the scope status into a shell variable first so the TODOS entry is fully populated (no `[fill in]` placeholders in the commit):

```bash
cd /Users/siraj/falsafa

# Determine scope status from Step 1 result. Pick ONE that matches:
SCOPE_STATUS="unclaimed-publishing-creates-it"   # if `npm org ls falsafa` said scope didn't exist
# SCOPE_STATUS="owned-by-you"                    # if it listed your account as a member
# SCOPE_STATUS="owned-by-someone-else-PIVOTED"   # if it listed a third party (you'd have stopped at Step 1)

LAST_COMMIT=$(git rev-parse --short HEAD)

cat <<EOF >> TODOS.md

## Done — @falsafa/mcp v0.1.0 first-publish pre-flight (2026-05-01)

- Verified @falsafa npm scope (status: ${SCOPE_STATUS}).
- Provisioned NPM_TOKEN GitHub secret (Automation type).
- All apps/mcp/ file changes committed; HEAD is ${LAST_COMMIT}.
EOF
git add TODOS.md
git commit -m "docs(todos): record @falsafa/mcp pre-flight pre-publish ceremony"
```

If `SCOPE_STATUS` is still the placeholder string when you run this, **stop and re-read Step 1's output** — the TODOS entry should reflect the real ownership state, not a guess.

### Task 9: Local pre-publish dry run

**Files:** none (verification gate before tagging).

- [ ] **Step 1: Run prepack and inspect the tarball**

```bash
cd /Users/siraj/falsafa/apps/mcp
bun run prepack          # rebuilds dist/ AND copies corpus/
npm pack --dry-run > /tmp/falsafa-pack-output.txt 2>&1
tail -20 /tmp/falsafa-pack-output.txt
```

- [ ] **Step 2: Verify acceptance criteria**

Run all of:
```bash
# (a) Tarball references the right files
grep -c "dist/index.js" /tmp/falsafa-pack-output.txt
grep -c "corpus/manifest.json" /tmp/falsafa-pack-output.txt
grep -c "LICENSE" /tmp/falsafa-pack-output.txt
grep -c "README.md" /tmp/falsafa-pack-output.txt
# (b) Total file count is in the corpus-shipped range
grep "total files:" /tmp/falsafa-pack-output.txt
# (c) Tarball size shows corpus shipped
grep "package size" /tmp/falsafa-pack-output.txt
```

Acceptance:
- `dist/index.js` count: 1
- `corpus/manifest.json` count: 1
- `LICENSE` count: 1
- `README.md` count: 1
- Total files: > 1,000 (likely ~2,000+)
- "package size" line shows > 20MB compressed

If any acceptance fails, **STOP** — debug before tagging. Common causes:
- `prepack` didn't run (forgot the `prepack` field in `package.json`, or ran `npm pack` without it). Fix: ensure `package.json` has the `prepack` script and re-run `bun run prepack && npm pack --dry-run`.
- `corpus/` is empty (copy script broke). Fix: re-run `node scripts/copy-corpus.mjs` and check the `cpSync` source path is `../../../corpus`.

- [ ] **Step 3: No commit** — this task is purely a verification gate.

### Task 10: Tag + push (the publish trigger)

**Files:** none (operates on git refs).

- [ ] **Step 1: Confirm everything is on `main` and pushed**

```bash
cd /Users/siraj/falsafa
git status --short    # should be empty (all changes committed)
git rev-parse --abbrev-ref HEAD    # main
git log --oneline -1    # current HEAD
git push origin main   # ensure HEAD on origin/main
```

- [ ] **Step 2: Tag v0.1.0 and push the tag**

```bash
cd /Users/siraj/falsafa
git tag v0.1.0
git push origin v0.1.0
```

- [ ] **Step 3: Watch the workflow**

Open the Actions tab on the GitHub UI, OR:

```bash
gh run list --workflow npm-publish --limit 1
gh run watch    # follow the most recent run
```

Expected:
- `publish` job: passes (~2-3 min)
- `smoke` matrix (3 jobs): all 3 pass (~1 min each, runs in parallel after publish)

Total wall time: ~3-5 minutes.

- [ ] **Step 4: Verify the package is live on npm**

```bash
npm view @falsafa/mcp version
```

Expected: `0.1.0`

```bash
npm view @falsafa/mcp
```

Expected: full package metadata, "Built and signed on GitHub Actions" provenance badge. Visit `https://npmjs.com/package/@falsafa/mcp` to see the rendered package page (README + tools + install command).

- [ ] **Step 5: End-to-end install verification**

In a fresh terminal session:
```bash
npx -y @falsafa/mcp 2>&1 | head -1
```

Expected first stderr line: `[falsafa-mcp] corpus loaded: 37 works from /Users/.../node_modules/@falsafa/mcp/corpus`

The process will hang waiting for stdio input — that's correct, it's an MCP server. Ctrl-C to exit.

- [ ] **Step 6: Update README + TODOS to reflect the real npm publish**

The repo's top-level `README.md` currently says (since `bde534a`):
```
The fastest way in (once `@falsafa/mcp` ships to npm — see [Status](#status)):
```

Make two edits to `/Users/siraj/falsafa/README.md` using the `Edit` tool. **First edit** — drop the "(once…)" hedge:

```
old_string: The fastest way in (once `@falsafa/mcp` ships to npm — see [Status](#status)):
new_string: The fastest way in:
```

**Second edit** — flip row 8 of the Status table from pending → live. Open `README.md`, search for the line containing `` `npx @falsafa/mcp` published to npm ``, then:

```
old_string: | 8 | `npx @falsafa/mcp` published to npm | pending (Track 2 of post-redesign work) |
new_string: | 8 | `npx @falsafa/mcp` published to npm | ✅ v0.1.0 live |
```

(If the exact `pending …` cell text drifts before you run this, read the README and adapt `old_string` to match what's actually there. The goal is just: row 8's status cell becomes `✅ v0.1.0 live`.)

There's also one related sentence to clean up. Search for:
```
Until the npm publish lands, run the MCP from source: `cd apps/mcp && bun run dev`.
```
If present, delete this paragraph (it's now stale).

Commit + push:

```bash
cd /Users/siraj/falsafa
git add README.md
git commit -m "docs(readme): @falsafa/mcp v0.1.0 is live on npm

The npx command at the top of the README is no longer aspirational.
Removes the '(once ships to npm)' hedge and updates the Status
table to reflect that the npm publish landed."
git push origin main
```

---

## Done criteria

All of the following must be true:

- [ ] All 10 tasks marked complete with their commits.
- [ ] `apps/mcp/scripts/copy-corpus.mjs` exists and runs successfully.
- [ ] `apps/mcp/LICENSE` exists and is identical to repo-root LICENSE.
- [ ] `apps/mcp/package.json` has `prepack`, `publishConfig.access: public`, version `0.1.0`, ten-tool description, full author string.
- [ ] `apps/mcp/src/index.ts` logs corpus path on startup.
- [ ] `apps/mcp/README.md` is rewritten for npm-page audience (~120 lines).
- [ ] `.github/workflows/npm-publish.yml` and `.github/scripts/smoke-mcp.mjs` exist and pass YAML/syntax validation.
- [ ] `bun test` still passes (no regressions in apps/mcp/test/).
- [ ] `npm pack --dry-run` shows tarball includes dist/, corpus/, LICENSE, README.md; total files > 1,000; size > 20MB.
- [ ] Pre-flight done: @falsafa scope verified, NPM_TOKEN secret provisioned.
- [ ] Tag v0.1.0 pushed; both `publish` and `smoke` workflow jobs green.
- [ ] `npm view @falsafa/mcp version` returns `0.1.0`.
- [ ] `npx -y @falsafa/mcp` runs end-to-end and emits the corpus-loaded stderr line.
- [ ] Top-level README.md no longer hedges "once ships to npm"; Status row 8 updated.

## Out of scope (deferred)

Per the spec's out-of-scope list, none of these are done in this PR:
- Fetch-corpus-on-first-run
- Companion `@falsafa/corpus` data package
- v1.0.0 commit
- Automated semver bump from commit messages
- `@falsafa/pipeline` (Perseus ingest)
- Remote MCP backend (claude.ai Connector / ChatGPT GPT)
- GitHub Action for PR-time `npm pack --dry-run` (catches drift before tag)
- Signed git tags

## Rollback

If something goes wrong post-publish:

| Severity | Action | Window |
|---|---|---|
| Wrong code shipped, want to remove | `npm unpublish @falsafa/mcp@0.1.0` | within 72h, requires < 300 weekly downloads |
| Beyond unpublish window | `npm deprecate @falsafa/mcp@0.1.0 "see @falsafa/mcp@0.1.1"` | forever |
| Smoke failed but publish succeeded | deprecate v0.1.0 + immediately publish v0.1.1 with fix | as fast as possible |

Manual republish (if the workflow's smoke matrix went red but publish landed): bump to `v0.1.1` in `apps/mcp/package.json`, fix the underlying issue, commit, tag `v0.1.1`, push tag.
