# `@falsafa/mcp` npm publish v0.1.0 — Design

**Status:** Spec, awaiting implementation plan.
**Author:** Adnan + Claude (brainstorming session 2026-05-01).
**Goal:** Ship `@falsafa/mcp` v0.1.0 to the npm registry so anyone can run `npx -y @falsafa/mcp` and have a working stdio MCP server pointing at the Falsafa corpus, with no API keys, no setup, no clone-the-repo.

## Why

The README leads with `npx -y @falsafa/mcp`. The `<InstallCard>` component on `/try/` renders Claude Desktop / Claude Code / Cursor / Codex config snippets that all paste the same command. Today every one of those instructions is broken — the package isn't on npm (registry returns 404). Falsafa.ai's `/try/` install card claims a thing that doesn't work.

Shipping the package closes this gap. It also unlocks the next strategy beats (claude.ai Connector + ChatGPT GPT remote MCP backend, deferred in `TODOS.md`) and turns `@falsafa/mcp` into a name on npm that users + the Claude / Cursor / Codex install ecosystems can verify.

## Non-Goals

- **Fetch-corpus-on-first-run.** Ship 104MB corpus inside the tarball instead. Future v0.x bump if disk usage becomes pain — the migration path stays clean (npm-cached tarball doesn't need re-fetching).
- **Companion `@falsafa/corpus` data package.** Speculative future-proofing for a use case (swap-the-corpus) that doesn't yet exist.
- **v1.0.0 first publish.** Locks API surface during the eval-scoring rework. v0.1.0 is honest about the state.
- **Automated semver bump from commits.** Manual `git tag` is fine for current cadence.
- **`@falsafa/pipeline` companion package.** Separate launch-list item, separate spec.
- **Remote MCP backend** (claude.ai Connector / ChatGPT GPT). Already deferred in `TODOS.md`.
- **Refactoring tool surface, MCP transport, or any runtime code.** Only mechanical packaging + the one-line stderr startup log.

## Strategic context

Decisions already settled in the CEO review (`~/.gstack/projects/falsafa/ceo-plans/2026-05-01-falsafa-mcp-npm-publish.md`, mode SELECTIVE EXPANSION, 9 accepted, spec-reviewed 7/10 with 4 fixes):

- **D1**: ship 104MB corpus inside the tarball (~30-50MB compressed).
- **C1**: GitHub Action for release-on-tag.
- **C2**: post-publish smoke test in CI.
- **C3**: cross-platform smoke matrix (ubuntu / macos / windows).
- **C4**: refresh `apps/mcp/README.md` for npm-page audience.
- **C5**: first publish v0.1.0 (not v1.0.0 — keeps doors open during eval-scoring rework).
- **S2-1**: smoke depth = `list_tools` + `list_works` over JSON-RPC (catches partial-corpus copy).
- **S3-1**: `npm publish --provenance` for free supply-chain trust signal.
- **S8-1**: stderr startup log shows resolved corpus path + work count.

This spec is purely the per-feature contract: which files change, what each contains, how the smoke test asserts.

## Architecture overview

```
DEV / RELEASE                                                   USER
┌──────────────────────────────────────────┐    ┌──────────────────────────────┐
│ git tag v0.1.0  ─push─▶ GitHub Actions   │    │ npx -y @falsafa/mcp          │
│                          │               │    │   ↓                          │
│                          ▼               │    │ npm fetch  ─from registry─▶  │
│            apps/mcp/scripts/copy-corpus  │    │   tarball ~30MB compressed   │
│              fs.cpSync (../../corpus)    │    │   ↓                          │
│                          │               │    │ unpack ~105MB to ~/.npm      │
│                          ▼               │    │   ↓                          │
│            bun build → dist/index.js     │    │ exec node dist/index.js      │
│                          │               │    │   ↓                          │
│                          ▼               │    │ Corpus.findRoot()            │
│            npm pack --dry-run (sanity)   │    │   resolveCorpusRoot resolves │
│                          │               │    │   bundled-next-to-dist path  │
│                          ▼               │    │   ↓                          │
│            npm publish --provenance      │    │ stderr: "[falsafa-mcp]       │
│                          │               │    │   corpus loaded: 37 works    │
│                          ▼               │    │   from /path/to/corpus"      │
│            Smoke matrix: ubuntu/macos/   │    │   ↓                          │
│            windows                       │    │ stdio JSON-RPC ready         │
│              install -g, spawn,          │    │                              │
│              list_tools + list_works     │    │                              │
└──────────────────────────────────────────┘    └──────────────────────────────┘
```

No runtime code changes. The `apps/mcp/src/corpus.ts:23-39` `resolveCorpusRoot()` function ALREADY handles the bundled-next-to-dist path (verified during CEO review). The package wiring just hasn't been finished.

## File / artifact inventory

| File | Status | Purpose |
|---|---|---|
| `apps/mcp/package.json` | MODIFY | Add `prepack`, `publishConfig`, bump version, fix description, set author. |
| `apps/mcp/scripts/copy-corpus.mjs` | NEW | Cross-platform corpus copy (`fs.cpSync`). Runs in `prepack`. |
| `apps/mcp/LICENSE` | NEW | Copy of repo-root LICENSE (npm sandboxes the package dir). |
| `apps/mcp/src/index.ts` | MODIFY | Add stderr startup log line after `Corpus` construction. |
| `apps/mcp/README.md` | REWRITE | Audience: npmjs.com/package/@falsafa/mcp visitor. |
| `.github/workflows/npm-publish.yml` | NEW | Tag-triggered publish + cross-platform smoke. |
| `.github/scripts/smoke-mcp.mjs` | NEW | Cross-platform JSON-RPC stdio assertion run by the smoke job. |

7 files. 5 new, 2 modified. No code under `apps/mcp/src/` other than the one-line stderr addition in `index.ts`.

---

## Section 1 — `apps/mcp/package.json` diff

```jsonc
{
  "name": "@falsafa/mcp",
  "version": "0.1.0",
  "description": "Open-source MCP server for the Falsafa corpus. Ten librarian-flavored tools (eight catalog tools plus read_wiki and read_wiki_full for the rule-based wiki layer) so any LLM (Claude, ChatGPT, Hermes via OpenRouter, etc.) can navigate the catalog without an API key.",
  "license": "MIT",
  "author": "Adnan Abbasi <adnan@thothica.com> (https://meetadnan.com)",
  "homepage": "https://github.com/adoistic/falsafa",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/adoistic/falsafa.git",
    "directory": "apps/mcp"
  },
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "falsafa-mcp": "./dist/index.js"
  },
  "files": [
    "dist/",
    "corpus/",
    "README.md",
    "LICENSE"
  ],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "bun build ./src/index.ts --target=node --outdir=./dist --format=esm",
    "dev": "bun run ./src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "eval": "bun run eval/run-evals.ts",
    "eval:case": "bun run eval/run-evals.ts",
    "prepack": "node scripts/copy-corpus.mjs && bun build ./src/index.ts --target=node --outdir=./dist --format=esm"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.0"
  },
  "keywords": [
    "mcp",
    "model-context-protocol",
    "claude",
    "openai",
    "anthropic",
    "literature",
    "philosophy",
    "translation",
    "rag",
    "karpathy"
  ]
}
```

### Changes from current

- `version`: `0.0.1` → `0.1.0`
- `description`: "Eight" → "Ten" + names the wiki tools explicitly
- `author`: bare `"Adnan"` → `"Adnan Abbasi <adnan@thothica.com> (https://meetadnan.com)"` (npm-standard format; verify email at commit)
- `publishConfig.access: "public"`: NEW. Scoped packages (`@falsafa/...`) default to `restricted` and `npm publish` returns 402 without this. **Hard requirement.**
- `scripts.prepack`: NEW. Runs `copy-corpus.mjs` then `bun build`. `prepack` (not `prepublishOnly`) so `npm pack --dry-run` exercises the same step locally.

### Why `prepack` not `prepublishOnly`

`prepublishOnly` only fires on `npm publish`. `prepack` fires on `npm pack` AND `npm publish`. Using `prepack` means a developer running `npm pack --dry-run` locally sees what'll actually ship — no surprise drift between local sanity check and CI publish.

---

## Section 2 — `apps/mcp/scripts/copy-corpus.mjs` (new)

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

### Properties

- **Idempotent.** Cleans dst before copy.
- **Fails loud.** Exits 1 if source missing (catches misconfigured CI checkouts).
- **Stderr-only output.** Doesn't pollute stdout (which is reserved for downstream piping).
- **Cross-platform.** `fs.cpSync` works on ubuntu / macos / windows (node 16+).
- **Self-locating.** Uses `import.meta.url` instead of relative paths — robust to whatever CWD npm sets.

---

## Section 3 — `apps/mcp/LICENSE` (new)

Copy `LICENSE` from repo root verbatim. **Do not symlink** — symlink behavior in npm pack varies across npm versions and is unreliable. A literal file copy is what the npm tarball needs.

One-line shell command at commit time:

```bash
cp /Users/siraj/falsafa/LICENSE /Users/siraj/falsafa/apps/mcp/LICENSE
```

The repo-root LICENSE is MIT (verified). Same content goes here.

---

## Section 4 — `apps/mcp/src/index.ts` startup log line

Locate the line where `Corpus` is constructed (currently around `apps/mcp/src/index.ts:31`). Immediately after that line, before `Server.connect()`, add:

```ts
const works = corpus.works();
console.error(`[falsafa-mcp] corpus loaded: ${works.length} works from ${corpus.rootPath}`);
```

### Why this exact form

- Uses `Corpus.rootPath` getter and `Corpus.works()` method — both verified to exist on the `Corpus` class during the CEO-review audit. **Implementation-plan first step:** open `apps/mcp/src/corpus.ts`, confirm the accessor names match (line numbers will drift; identifiers may not). If either has been renamed, adjust the log line — don't treat the exact identifiers above as load-bearing.
- **stderr** (not stdout): MCP transport uses stdout for JSON-RPC; logging there breaks the protocol. stderr is fine for diagnostic output and shows up in Claude Desktop's MCP server logs.
- **One line.** Diagnostic only. Not noisy on startup.
- **Why this matters:** when a user reports "MCP server isn't responding," the first question is "which corpus did it load?" Without this log, debugging path-resolution issues requires asking the user to set `FALSAFA_CORPUS=` and re-run. With the log, they screenshot stderr and the answer is visible.

### What the log line does NOT include

- Chapter count: `manifest.json` doesn't ship a top-level chapters count; the would-be value (~818) requires summing `works[].total_logical_chapters`. Not worth the complexity for a startup log line.
- Anything beyond path + work count: any more is noise.

---

## Section 5 — `apps/mcp/README.md` rewrite

Audience: someone landing on `https://npmjs.com/package/@falsafa/mcp` who clicks "Readme." Different from the repo's top-level README (which is for someone arriving via GitHub).

### Outline (final prose written when spec is committed)

1. **H1** — "Falsafa MCP" (matches the package name)
2. **One-paragraph lede** — what it is + the install command:
   > Stdio MCP server for the Falsafa corpus. Ten librarian-flavored tools so any LLM client (Claude Desktop, Claude Code, Cursor, Codex, or any MCP-aware host) can navigate 37 translated philosophical and classical works through paragraph-stable citations. No API key, no setup beyond `npx`.
   >
   > ```bash
   > npx -y @falsafa/mcp
   > ```
3. **Claude Desktop config snippet:**
   ```json
   {
     "mcpServers": {
       "falsafa": { "command": "npx", "args": ["-y", "@falsafa/mcp"] }
     }
   }
   ```
4. **Tool list** — 10 tools, one line each:
   - `list_works` — list works with optional filters
   - `list_chapters` — list chapters of a work
   - `get_metadata` — full metadata + variant counts for a work
   - `read_chapter` — full chapter text with `[p-XXXXXX]` paragraph IDs
   - `get_passage` — specific paragraphs by ID list or range, with citation URLs
   - `search_corpus` — search English bodies, distinctive phrases
   - `find_related` — TF-IDF-based related chapters
   - `compare_works` — side-by-side pointer chapters for two works on a topic
   - `read_wiki` — rule-based wiki card (~280 tokens) for a work or chapter
   - `read_wiki_full` — heavy-detail wiki sheet (~1,500 tokens, with n-grams, NPMI collocations, TextRank, refrains, and stylometry signals)

   **Implementation-plan note:** before locking the README copy, confirm the `read_wiki_full` content shape against the current `apps/mcp/lib/wiki/` modules. If the algorithm list has drifted (e.g., refrains dropped, lex-rank added/removed), update this paragraph — npm registry copy is hard to walk back without a republish.
5. **Corpus** — one paragraph naming what's in it, with the AI-assisted-translation caveat:
   > 37 works spanning Old English Christian poetry (Cynewulf), Urdu ghazal masters (Ghalib, Iqbal, Zauq), French Enlightenment political theory (Comte, Dunoyer), German philosophical writing (Fichte), Sanskrit smṛti traditions, and Old Javanese / Kawi tattva texts. Translations and transliterations are AI-assisted (produced by Thothica's pipeline across Claude / GPT / Gemini); when accuracy matters, verify against the original-language source. Underlying source archives: sacred-texts.com (Old English), GRETIL (Sanskrit smṛti), allamaiqbal.com (Iqbal), printed editions (Ghalib + Zauq).
6. **Links** — falsafa.ai (thesis + eval explorer); GitHub repo (source); `/about/#sources` (full source acknowledgments).
7. **License** — MIT.

Final length target: 80-120 lines of markdown. Tight, scannable, copy-paste-ready.

### What this README does NOT include

- The full eval methodology — link to `falsafa.ai/thesis/#methodology`.
- Implementation internals — link to GitHub for source.
- Roadmap — link to `TODOS.md`.

---

## Section 6 — `.github/workflows/npm-publish.yml` (new)

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

### Permissions notes

- `contents: read` — minimal scope for `actions/checkout`.
- `id-token: write` — required for `npm publish --provenance` (the OIDC token attestation used by npm's provenance feature). **Without this, `--provenance` silently emits no attestation.**

### `--access public`

Belt-and-suspenders with `publishConfig.access` in `package.json`. Either alone is sufficient; both removes any ambiguity about scoped-package visibility.

### `--frozen-lockfile`

Reproducible builds. CI installs exactly the deps committed to `bun.lock`.

### Why `sleep 30` before smoke install

npm registry CDN propagation can lag a few seconds after `npm publish` returns success. 30 sec is conservative — `npm install -g @falsafa/mcp@$VERSION` racing the CDN has been a known flake source.

### Why duplicate the prepack steps inline (not `bun run prepack`)

`bun run prepack` would also work and is shorter. Inlining the steps makes the workflow self-documenting — a reader of the YAML sees exactly what runs without cross-referencing `package.json`. Either is acceptable; inlined is the recommendation.

---

## Section 7 — `.github/scripts/smoke-mcp.mjs` (new)

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

// Poll-with-timeout helper — more robust than fixed sleeps on a cold
// Windows runner under load. Resolves once the response with the given
// id arrives, or rejects after timeoutMs.
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

await waitFor(1, 5000);   // initialize

send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await waitFor(2, 5000);

send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "list_works", arguments: {} }
});
await waitFor(3, 10000);   // longer — list_works reads manifest

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

### Assertions, in order

1. `initialize` returned a `result` (proves binary boots and MCP handshake works).
2. `tools/list` returned ≥ 8 tools (sanity floor).
3. All 10 expected tool names are present (catches "wiki tools missing because corpus didn't ship").
4. `list_works` returned non-empty content (catches "tools registered but corpus is empty/broken").

If all four pass, the published tarball is functionally complete on this OS.

### Why this catches partial-corpus copy

If `prepack`'s copy step partially failed (e.g., disk full mid-copy), `manifest.json` might be missing or `works/` might be incomplete. `tools/list` would still pass (tools register from code). But `list_works` would error or return empty content because `Corpus.works()` reads `manifest.json`. The smoke catches this before users do.

---

## Section 8 — Pre-flight (one-time, manual, BEFORE first publish)

These three steps are NOT in the workflow — they're human-only setup. Run once, document outcome.

### 1. Verify `@falsafa` scope ownership

```bash
npm whoami
npm org ls falsafa 2>&1
```

**Three possible outcomes:**

- **Account logged in + scope unclaimed** (most likely): `npm org ls falsafa` errors with `E404` or similar. Action: nothing — npm auto-creates the scope on first publish under your account.
- **Account logged in + scope owned by current user**: `npm org ls falsafa` lists members. Action: nothing — already yours.
- **Scope owned by someone else**: `npm org ls falsafa` shows membership but you're not listed. Action: **STOP**. Pivot to `falsafa-mcp` (unscoped) — change `name`, `bin`, all README references. Do NOT publish under a scope someone else owns.

### 2. Provision NPM_TOKEN GitHub secret

1. Log into npmjs.com → Account Settings → Access Tokens.
2. Click "Generate New Token" → choose **Automation** (publish + 2FA-bypass for CI; required for tag-triggered publishes).
3. Copy the token (one-time display).
4. Go to GitHub repo → Settings → Secrets and Variables → Actions → New repository secret.
5. Name: `NPM_TOKEN`. Value: paste the token.

### 3. Copy LICENSE into `apps/mcp/`

```bash
cp /Users/siraj/falsafa/LICENSE /Users/siraj/falsafa/apps/mcp/LICENSE
```

Commit alongside the rest of the publish PR.

---

## Local first-publish dry run (sanity gate before tagging)

After all the file changes are committed but BEFORE pushing the tag:

```bash
cd /Users/siraj/falsafa/apps/mcp
bun run prepack            # builds dist/ AND copies corpus/
npm pack --dry-run | tail -20
```

### Acceptance criteria

- `npm pack --dry-run` output lists `dist/index.js` ✓
- Lists `corpus/manifest.json`, `corpus/works/`, `corpus/cross-links.json` ✓
- Lists `LICENSE`, `README.md`, `package.json` ✓
- Total file count > 1,000 (corpus has 1,338 wiki files alone, plus chapters)
- "package size" line shows > 20MB compressed (anything below means corpus didn't ship)

If any assertion fails, fix before tagging.

---

## Tag + push (the publish trigger)

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow runs. Watch the Actions tab. If green: package is on npm + smoke-tested across 3 OS. If red: investigate, fix, retag (`v0.1.1` if `v0.1.0` already published; never re-tag the same version).

---

## Rollback

| Severity | Action | Window |
|---|---|---|
| Wrong code shipped, want to remove | `npm unpublish @falsafa/mcp@0.1.0` | within 72 hours |
| Wrong code shipped, beyond unpublish window | `npm deprecate @falsafa/mcp@0.1.0 "reason; use @falsafa/mcp@0.1.1"` | forever |
| Smoke failed but publish succeeded | deprecate + immediately publish v0.1.1 with fix | as fast as possible |

`npm deprecate` is the standard rollback — the version stays on npm but `npm install` warns users.

---

## Failure modes

| Codepath | Failure mode | Rescued? | Test? | User sees? | Logged? |
|---|---|---|---|---|---|
| prepack: `copy-corpus.mjs` source missing | source path wrong / corpus deleted | ✅ exits 1 | ✅ via failed CI | "[copy-corpus] source not found" | ✅ stderr |
| prepack: `bun build` | TS compile error / missing import | ✅ bun exits 1 | ✅ via failed CI | bun error in CI log | ✅ |
| `npm pack --dry-run` | tarball is wrong (empty, missing files) | ✅ visible in output | ✅ this is the test | npm output in CI log | ✅ |
| `npm publish` | auth fail (bad/missing NPM_TOKEN) | ✅ npm exit code | ✅ via failed CI | "ENEEDAUTH" | ✅ |
| `npm publish` | version conflict (already published) | ✅ npm 403 | ✅ via failed CI | "EVERSION" | ✅ |
| `npm publish` | scope owned by someone else | ✅ npm 403 | should be caught at pre-flight step 1 | "E403" | ✅ |
| Smoke job: binary won't start | dist/index.js syntax error | ✅ matrix red | ✅ this is the test | smoke output in CI | ✅ |
| Smoke job: corpus partially shipped | manifest.json missing or works/ empty | ✅ list_works fails | ✅ S2-1 catches | smoke output | ✅ |
| User runtime: `Corpus.findRoot()` returns wrong path | shouldn't happen post-publish; path resolution exists in 4 fallback orders | ✅ throws on use | not testable post-publish | structured `MCPError` | ✅ |
| User runtime: stdio transport breaks | MCP SDK error | ✅ thrown to MCP client | not Falsafa's concern | client surfaces error | ✅ |

**No critical gaps** — every failure is rescued, tested where possible, and visible to the operator.

---

## Testing

Manual + CI:

1. **Local prepack run**: `cd apps/mcp && bun run prepack` — exits 0.
2. **Local pack dry run**: `npm pack --dry-run` — file count > 1,000, size > 20MB.
3. **Local stdio smoke**: spawn `node dist/index.js` directly, send the same JSON-RPC payload as `smoke-mcp.mjs`, assert same. Exercises everything except the npm install path.
4. **CI publish job**: tag-triggered `npm publish` — exits 0.
5. **CI smoke matrix (ubuntu/macos/windows)**: install global, run `smoke-mcp.mjs` — all three exit 0.

No unit tests added. The smoke script IS the test for the published artifact.

---

## Out-of-scope follow-ups (deferred)

| Item | Defer reason |
|---|---|
| Fetch-corpus-on-first-run | Future v0.x bump if disk usage becomes a real pain |
| Companion `@falsafa/corpus` package | No demand for swap-the-corpus today |
| v1.0.0 commit | Wait until eval-scoring rework lands and tool surface stabilizes |
| Automated semver bump from commit messages | Manual `git tag` is fine for current cadence |
| `@falsafa/pipeline` (Perseus ingest) | Separate launch-list item, separate spec |
| Remote MCP backend (claude.ai Connector / ChatGPT GPT) | Already deferred in `TODOS.md` |
| GitHub Action for PR-time `npm pack --dry-run` (catches drift before tag) | Probably worth adding eventually; not blocking v0.1.0 |
| Signed git tags | Use `git tag -s` if your gpg keyring is set up; not enforced by the workflow |

---

## Reviewer Concerns

Spec-document-reviewer ran 2026-05-01 (one iteration). Status: ✅ Approved
("Spec is implementation-ready"). Three actionable issues + four advisories.

**Actionable (all 4 fixed in this revision):**
1. Section 4 startup log: don't pin specific line numbers for `Corpus.rootPath` / `Corpus.works()` — the implementation plan's first step verifies the accessor names on the live class. Fixed.
2. Section 5 README: `read_wiki_full` algorithm list (n-grams + NPMI + TextRank + LexRank) is jargon-heavy and hard to walk back from npm registry. Replaced with broader description; added a plan-step to verify against current `apps/mcp/lib/wiki/` before lock-in.
3. Section 7 smoke timing: fixed `setTimeout` sleeps were racy on cold Windows runners. Replaced with a `waitFor(id, timeoutMs)` poll-with-timeout helper.
4. Section 8 pre-flight: `npm org ls` error code `EROVER` corrected to `E404`.

**Advisories (informational, not blocking):**
- `--access public` + `publishConfig.access` belt-and-suspenders is correctly justified — keep both.
- `prepack` over `prepublishOnly` justification is sound.
- `npm unpublish` requires <300 weekly downloads — v0.1.0 will trivially satisfy, worth knowing.
- Alternative to the `sleep 30` for npm CDN propagation: `npm view @falsafa/mcp@$VERSION` poll loop. Simpler current spec is fine.

No unresolved concerns.

---

## CEO plan reference

Strategic context + scope decisions: `~/.gstack/projects/falsafa/ceo-plans/2026-05-01-falsafa-mcp-npm-publish.md`. That doc owns the "why these decisions and not the alternatives." This spec owns the "what files change and what each contains."
