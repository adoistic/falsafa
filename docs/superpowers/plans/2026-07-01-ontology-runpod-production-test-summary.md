# 2026-07-01 Ontology RunPod Production Test Summary

## Status

The first RunPod-backed GLM-5.2 FP8 production test did not reach the ontology smoke-test stage. All paid pods were deleted after testing; a final RunPod pod sweep returned zero active pods.

## Confirmed

- RunPod MCP was available and authenticated.
- Secure-cloud 8x H200 was available at 35.12 credits/hour.
- The canonical production harness is implemented in `scripts/graph/ontology-production-run.ts`.
- The harness defaults GLM thinking mode on, matching the production prompt requirement.
- Z.AI publishes GLM-5.2 weights on both Hugging Face and ModelScope.
- The Hugging Face FP8 model id is `zai-org/GLM-5.2-FP8`.
- The documented ModelScope model id is `zai-org/GLM-5.2`.
- The ModelScope `zai-org/GLM-5.2` config reports `dtype: bfloat16`; it is not confirmed to be the FP8 target.
- vLLM's current GLM-5.2 recipe recommends `vllm/vllm-openai:glm52`, `vllm==0.23.0` for source installs, tensor parallelism 8, FP8 KV cache, and 5-token MTP speculative decoding.

## Attempts

| attempt | image | source | result |
| --- | --- | --- | --- |
| vLLM image, Hugging Face id | `vllm/vllm-openai:glm52` | `zai-org/GLM-5.2-FP8` | vLLM initialized and began resolving the model, but Hugging Face warned about unauthenticated downloads and stalled before GPU loading. |
| vLLM image, ModelScope wrong id | `vllm/vllm-openai:glm52` | `zai-org/GLM-5.2-FP8` with `VLLM_USE_MODELSCOPE=True` | Failed because this FP8-suffixed id does not exist on ModelScope. |
| vLLM image, ModelScope wrong id, shell wrapper | `vllm/vllm-openai:glm52` | `ZhipuAI/GLM-5.2-FP8` | Pod became unreachable through HTTP/SSH and stayed GPU-idle. This id was later verified as 404 on ModelScope. Deleted. |
| PyTorch image, bootstrap install | `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404` | `ZhipuAI/GLM-5.2-FP8` | HTTP and SSH control surfaces were unreachable; GPU/CPU stayed idle. This id was later verified as 404 on ModelScope. Deleted. |
| PyTorch static log-server probe | `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404` | none | Even a trivial HTTP log server was unreachable through the exposed proxy. Deleted. |
| vLLM image, default entrypoint, ModelScope wrong id | `vllm/vllm-openai:glm52` | `ZhipuAI/GLM-5.2-FP8` | Endpoint remained unreachable and GPU-idle. This id was later verified as 404 on ModelScope. Deleted. |

## Outcome Metrics

| concurrency | attempted | valid | valid % | retries | p95 latency | valid windows/hour | GPU cost/hour | cost/valid window | decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| smoke | 0 | 0 | n/a | 0 | n/a | 0 | 35.12 credits | n/a | No model endpoint became healthy; production canary not started. |

Approximate RunPod spend should be read from the RunPod billing dashboard. The test used sequential 8xH200 pods only, and all were deleted promptly when idle or unreachable.

## Recommendation

The next production attempt should use ModelScope's hosted OpenAI-compatible inference endpoint for a production canary before returning to self-hosted RunPod:

1. Set `ONTOLOGY_OPENAI_BASE_URL=https://api-inference.modelscope.ai/v1`.
2. Set `ONTOLOGY_MODEL=zai-org/GLM-5.2`.
3. Set `ONTOLOGY_API_KEY` from a ModelScope token without committing it or writing it to logs.
4. Run a one-window smoke test, then small hosted-API concurrency tests.

If self-hosting is still required after the hosted canary, do not start with ModelScope on RunPod unless the pod can be observed through the RunPod web console. The most practical self-hosted route is:

1. Recreate the official vLLM image pod with a Hugging Face token supplied as `HF_TOKEN` and `HUGGING_FACE_HUB_TOKEN`.
2. Use `zai-org/GLM-5.2-FP8` from Hugging Face.
3. Keep the same vLLM serving settings: TP 8, FP8 KV cache, 5-token MTP, `max_model_len=32768`, and `max_num_seqs=64`.
4. Start with a one-window smoke test before concurrency 32.

ModelScope remains the correct Z.AI-recommended alternative source for `zai-org/GLM-5.2`, but the documented ModelScope artifact appears to be BF16 by config. For the requested FP8 H200 test, use Hugging Face `zai-org/GLM-5.2-FP8` with an `HF_TOKEN`, or obtain an explicit FP8 ModelScope revision/path from Z.AI before retrying ModelScope.
