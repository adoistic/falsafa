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
