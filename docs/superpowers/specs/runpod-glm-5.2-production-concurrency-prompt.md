# Fresh Session Prompt: GLM-5.2 RunPod Production Concurrency Test

Use this prompt in a fresh Codex session when we are ready to spend RunPod credits and run the first production-hour ontology extraction test.

```text
You are Codex working in the Falsafa repo. Treat this as the first production run of the restarted ontology extraction pipeline, not as a loose benchmark.

Project context:
- Falsafa.ai is a corpus and reading platform for philosophy, religion, law, literature, political thought, social theory, and intellectual history.
- We are restarting the ontology layer from scratch.
- The first extraction pass produces structured JSON per corpus window: entities, themes, citations, and quote_events.
- Model-written quotes are forbidden. The model must only return paragraph anchors. A deterministic local pipeline attaches exact quote arrays later.
- Evidence anchors can be paragraph ids, paragraph ranges, or hybrid evidence represented as multiple evidence objects.
- The extraction prompt/schema is canonical at:
  scripts/graph/prompts/ontology-anchor-range-v1.md
- The production run plan is:
  docs/superpowers/plans/2026-07-01-ontology-production-run.md
- The API cost estimate is:
  docs/superpowers/plans/2026-07-01-ontology-api-cost-estimate.md

Your job:
1. Read the three files above completely.
2. Inspect the existing graph scripts under scripts/graph and the corpus structure under corpus/works enough to understand how windows, paragraphs, and output validation should work.
3. Verify the RunPod MCP connection.
4. If and only if the user explicitly confirms spending RunPod credits in this session, create the intended RunPod instance.
5. Set up GLM-5.2 FP8 serving.
6. Run the first production concurrency test against real ontology windows.
7. Report throughput, validity, retries, failures, and cost-per-valid-window.

RunPod MCP setup and verification:
- First check whether RunPod tools are available in this Codex session.
- If the MCP server is absent, add it with:
  codex mcp add runpod --env RUNPOD_API_KEY=<RUNPOD_API_KEY> -- npx -y @runpod/mcp-server@latest
- Do not print or commit the API key.
- After adding or changing the MCP key, the current Codex session may still have stale MCP environment. If RunPod MCP calls return 401 after the key is known to be correct, say that the session needs a restart or use a direct authenticated RunPod API call only if the key is already available in the environment.
- Verify with a harmless read call first, such as listing templates or data centers. Do not create a pod until the user explicitly confirms spending credits.

Target RunPod instance:
- Use GLM-5.2 FP8, not BF16. BF16 is too large for this production-hour test.
- Target hardware: one 8-GPU H200 pod if available.
- Preferred GPU class: H200 SXM 141GB x 8.
- Acceptable fallback: H200 NVL 143GB x 8 if H200 SXM is unavailable.
- Higher fallback if needed and user approves extra burn rate: B200 x 8.
- Do not use A100 80GB x 8 for GLM-5.2 FP8; the memory headroom is not appropriate for this model.
- Prefer secure cloud unless availability or price makes community cloud clearly better and the user approves.
- Use a recent RunPod PyTorch/CUDA image or official vLLM OpenAI image compatible with GLM-5.2.
- If using the default RunPod PyTorch image, install vLLM from the official GLM-5.2 instructions.
- Allocate enough persistent storage for the FP8 weights and cache. Treat 1TB volume as the practical minimum; use more if the model cache or image needs it.
- Expose an OpenAI-compatible HTTP endpoint port for vLLM.

Serving target:
- Model: zai-org/GLM-5.2-FP8 or the current official GLM-5.2 FP8 Hugging Face repo if renamed.
- Runtime: vLLM OpenAI-compatible server.
- Tensor parallelism: 8.
- KV cache dtype: FP8.
- Speculative decoding: enable the official GLM-5.2 MTP settings if supported by the installed vLLM build.
- Start with max model length 32768 unless real windows require more; raise to 65536 only if needed and memory allows.
- Start with server max concurrency around the target client concurrency, but do not hide overload by unlimited server queues.

Production window source:
- Use real corpus windows, not synthetic text.
- Use the canonical prompt and schema exactly.
- Keep prompt version, model id, server config, window id, work slug, usage, timestamps, latency, validation result, retry history, and enrichment status in run metadata.
- Output should be idempotent: if a valid enriched output already exists for a window, skip it unless this run explicitly targets reprocessing.
- Do not write into the old prototype ontology directory as canonical truth.
- Keep production outputs in a new clearly named run directory under corpus/graph, for example:
  corpus/graph/ontology-runs/2026-07-01-glm52-runpod/
  If that directory is ignored by git, that is fine; summarize the results in a committed doc.

Concurrency strategy:
- Start at 32 concurrent real windows.
- If 32 is healthy, test 40, then 48, then 56, then 64.
- Continue in steps of 8 only while marginal throughput improves meaningfully and validity remains high.
- If 32 is unstable, step downward by 8: 24, then 16, then 8.
- Do not jump straight from a bad 32 to 64.
- Do not optimize for raw requests launched. Optimize for valid completed ontology windows.

For each concurrency level, measure:
- attempted windows;
- completed windows;
- valid JSON windows;
- schema-valid windows;
- paragraph-anchor-valid windows;
- deterministic enrichment success;
- failed windows by reason;
- retries;
- wall-clock duration;
- windows per minute;
- valid windows per hour;
- prompt tokens per window if available;
- completion tokens per window if available;
- output tokens per second;
- p50, p95, and max latency;
- approximate GPU cost during that segment;
- cost per valid window.

Health thresholds:
- Continue upward only if valid JSON is at least 95%.
- Continue upward only if paragraph-anchor validity is at least 99%.
- Stop or step down if timeout/retry rate crosses 20%.
- Stop or step down if output truncation appears repeatedly.
- Stop or step down if throughput flattens while latency rises.
- Stop immediately if the server becomes unstable or starts corrupting many outputs.

One-hour plan:
1. Confirm MCP/API health and available GPUs.
2. Confirm with the user before creating a paid pod.
3. Create the 8xH200 GLM-5.2 FP8 pod.
4. Bring up the OpenAI-compatible vLLM server.
5. Run a tiny smoke test with one real window.
6. Run the production canary at concurrency 32.
7. If 32 is healthy, test 40, 48, 56, and 64 as time allows.
8. If 32 is not healthy, test 24, 16, and 8.
9. Before stopping the pod, save the run summary and failure queue.
10. Stop or delete the pod according to the user's instruction. Do not leave a paid pod running silently.

Report back with a table:

| concurrency | attempted | valid | valid % | retries | p95 latency | valid windows/hour | GPU cost/hour | cost/valid window | decision |

Then give a short recommendation:
- best concurrency for the full run;
- expected hours for 12,929 windows;
- expected RunPod credit burn;
- whether RunPod beats the OpenRouter GLM route on cost and practicality;
- whether we should continue full production, split windows, or adjust server settings.

Important:
- This is production. Preserve artifacts.
- Do not expose secrets.
- Do not commit giant generated JSON outputs unless explicitly requested.
- Do commit small run summaries, prompt/spec changes, and source code changes.
- Do not mutate unrelated site/audio files.
```
