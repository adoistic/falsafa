# @falsafa/baseline

Hybrid RAG baseline used **only** for the eval comparison against Falsafa's markdown-and-tools approach. Not published. Not the production system. The whole point of Falsafa is that we **don't** use this — but to claim that, we need to actually run it, head-to-head, on the same eval cases.

## Stack (planned)

- **Chunking:** semantic chunks ~512 tokens with overlap
- **Embeddings:** OpenAI text-embedding-3-small (~$2.60 for the 100M-word Perseus archive at $0.02/1M tokens)
- **Vector store:** FAISS in-memory
- **Sparse:** BM25 over the same chunks
- **Fusion:** Reciprocal Rank Fusion (RRF)
- **Reranker:** cross-encoder (cohere-rerank-3 or local bge-reranker-v2)

## Why this exists

`/plan-eng-review` softened P8 ("vector DBs are the wrong abstraction") to a falsifiable claim: head-to-head benchmark in the launch artifact itself. This package is the head we benchmark against.

## Status

Scaffolded by `/plan-eng-review` run 2 (2026-04-27). Implementation runs concurrently with the eval-gen pipeline and the eval explorer (Phase 3, can be any worktree). Output feeds `eval/results-baseline-*.json` for the explorer to render side-by-side with Falsafa's results.
