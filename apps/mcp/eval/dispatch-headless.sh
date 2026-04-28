#!/bin/bash
# Dispatch one Falsafa eval question through `claude -p` headless.
#
# Usage:
#   PROMPT_DIR=/tmp/batch3 RUN_DIR=apps/mcp/eval/runs/batch3/sonnet \
#     dispatch-headless.sh q-0042
#
# - PROMPT_DIR  must contain `q-XXXX.txt` (full sub-agent prompt with Step A
#   instructing the agent to write `${RUN_DIR}/q-XXXX.json` via the Write tool).
# - RUN_DIR     is where outputs land. Must be relative to repo root or absolute.
#
# Extraction precedence:
#   1. If the agent wrote a valid JSON file via Step A (Write tool), keep it.
#      This avoids the JSON-escape bug — the Write tool serializes strings
#      correctly, while parsing the LAST fenced ```json block from stdout
#      breaks when the answer contains literal `"` or newlines.
#   2. Otherwise fall back to extracting the LAST fenced ```json block from stdout.
#   3. Otherwise log to _failures/.

set -u
QID="$1"
NUM="${QID#q-}"
QID="q-${NUM}"

PROMPT_DIR="${PROMPT_DIR:-/tmp/falsafa-eval}"
RUN_DIR="${RUN_DIR:-apps/mcp/eval/runs/headless/sonnet}"
MODEL="${MODEL:-sonnet}"
TIMEOUT="${TIMEOUT:-600}"

PROMPT_FILE="${PROMPT_DIR}/${QID}.txt"
FAIL_DIR="${RUN_DIR}/_failures"
STDOUT_FILE="${RUN_DIR}/${QID}.stdout"
JSON_FILE="${RUN_DIR}/${QID}.json"

mkdir -p "$RUN_DIR" "$FAIL_DIR"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "missing prompt file: $PROMPT_FILE" > "${FAIL_DIR}/${QID}.txt"
  exit 0
fi

if [ -f "$JSON_FILE" ]; then
  exit 0
fi

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo /Users/siraj/falsafa)"

cat "$PROMPT_FILE" | timeout "$TIMEOUT" claude -p --model "$MODEL" --permission-mode bypassPermissions \
  > "$STDOUT_FILE" 2> "${STDOUT_FILE}.err"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  ERRTAIL=$(tail -c 2000 "${STDOUT_FILE}.err" 2>/dev/null)
  {
    echo "claude -p exit=$EXIT_CODE"
    echo "stderr_tail:"
    echo "$ERRTAIL"
  } > "${FAIL_DIR}/${QID}.txt"
  if echo "$ERRTAIL" | grep -qiE "rate.?limit|429|too many requests|usage.?limit"; then
    echo "RATELIMIT" > "${FAIL_DIR}/${QID}.ratelimit"
  fi
  exit 0
fi

bun -e "
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const stdoutPath = '${STDOUT_FILE}';
const jsonPath = '${JSON_FILE}';
const failPath = '${FAIL_DIR}/${QID}.txt';
const need = ['answer', 'tool_calls', 'citations'];

function tryParse(s) { try { return JSON.parse(s); } catch { return null; } }
function valid(p) { return p && typeof p.answer === 'string' && Array.isArray(p.tool_calls); }

if (existsSync(jsonPath)) {
  const p = tryParse(readFileSync(jsonPath, 'utf8'));
  if (valid(p)) process.exit(0);
}

const s = readFileSync(stdoutPath, 'utf8');
const re = /\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\`/g;
let m, last = null;
while ((m = re.exec(s)) !== null) last = m[1];
if (!last) {
  writeFileSync(failPath, 'no fenced json block found and no agent-written file\\nstdout_tail:\\n' + s.slice(-2000));
  process.exit(0);
}
const parsed = tryParse(last);
if (!parsed) {
  writeFileSync(failPath, 'json parse error in stdout AND no valid agent-written file\\nblock:\\n' + last.slice(0, 2000));
  process.exit(0);
}
const missing = need.filter(k => !(k in parsed));
if (missing.length) {
  writeFileSync(failPath, 'missing keys: ' + missing.join(',') + '\\nblock:\\n' + last.slice(0, 2000));
  process.exit(0);
}
writeFileSync(jsonPath, JSON.stringify(parsed, null, 2));
"
