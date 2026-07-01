# 2026-07-01 Ontology RunPod Production Test Summary

## Status

The first RunPod-backed GLM-5.2 FP8 production test did not reach the ontology smoke-test stage. All paid pods were deleted after testing; a final RunPod pod sweep returned zero active pods.

## Confirmed

- RunPod MCP was available and authenticated.
- Secure-cloud 8x H200 was available at 35.12 credits/hour.
- The canonical production harness is implemented in `scripts/graph/ontology-production-run.ts`.
- The harness defaults GLM thinking mode on, matching the production prompt requirement.
- Z.AI publishes GLM-5.2 weights on both Hugging Face and ModelScope.
- The Hugging Face model id is `zai-org/GLM-5.2-FP8`.
- The ModelScope model id is `ZhipuAI/GLM-5.2-FP8`.
- vLLM's current GLM-5.2 recipe recommends `vllm/vllm-openai:glm52`, `vllm==0.23.0` for source installs, tensor parallelism 8, FP8 KV cache, and 5-token MTP speculative decoding.

## Attempts

| attempt | image | source | result |
| --- | --- | --- | --- |
| vLLM image, Hugging Face id | `vllm/vllm-openai:glm52` | `zai-org/GLM-5.2-FP8` | vLLM initialized and began resolving the model, but Hugging Face warned about unauthenticated downloads and stalled before GPU loading. |
| vLLM image, ModelScope wrong id | `vllm/vllm-openai:glm52` | `zai-org/GLM-5.2-FP8` with `VLLM_USE_MODELSCOPE=True` | Failed because the ModelScope mirror does not use the Hugging Face namespace. |
| vLLM image, ModelScope correct id, shell wrapper | `vllm/vllm-openai:glm52` | `ZhipuAI/GLM-5.2-FP8` | Pod became unreachable through HTTP/SSH and stayed GPU-idle. Deleted. |
| PyTorch image, bootstrap install | `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404` | `ZhipuAI/GLM-5.2-FP8` | HTTP and SSH control surfaces were unreachable; GPU/CPU stayed idle. Deleted. |
| PyTorch static log-server probe | `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404` | none | Even a trivial HTTP log server was unreachable through the exposed proxy. Deleted. |
| vLLM image, default entrypoint, ModelScope correct id | `vllm/vllm-openai:glm52` | `ZhipuAI/GLM-5.2-FP8` | Endpoint remained unreachable and GPU-idle. Deleted. |

## Outcome Metrics

| concurrency | attempted | valid | valid % | retries | p95 latency | valid windows/hour | GPU cost/hour | cost/valid window | decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| smoke | 0 | 0 | n/a | 0 | n/a | 0 | 35.12 credits | n/a | No model endpoint became healthy; production canary not started. |

Approximate RunPod spend should be read from the RunPod billing dashboard. The test used sequential 8xH200 pods only, and all were deleted promptly when idle or unreachable.

## Recommendation

The next production attempt should not start with ModelScope on RunPod unless the pod can be observed through the RunPod web console. The most practical route is:

1. Recreate the official vLLM image pod with a Hugging Face token supplied as `HF_TOKEN` and `HUGGING_FACE_HUB_TOKEN`.
2. Use `zai-org/GLM-5.2-FP8` from Hugging Face.
3. Keep the same vLLM serving settings: TP 8, FP8 KV cache, 5-token MTP, `max_model_len=32768`, and `max_num_seqs=64`.
4. Start with a one-window smoke test before concurrency 32.

ModelScope remains the correct Z.AI-recommended alternative source, but in this session RunPod observability and exposed-port behavior made it impossible to distinguish a ModelScope download issue from container startup/networking failure.
