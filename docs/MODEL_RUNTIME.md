# Atlas AI — Self-Hosted Model Runtime & Evolution Strategy

Atlas AI separates **model serving** from **Atlas Search**. Both the desktop app (`SelfHostedOpenAiProvider` in `src/main/agent/providers/self-hosted-provider.ts`) and the cloud backend (`AiOrchestrator` in `src/backend/modules/ai/ai-orchestrator.ts`) speak the standard **OpenAI-compatible `/v1/chat/completions` & `/v1/models` protocol** so operators can run Ollama, vLLM, or llama.cpp without vendor lock-in.

> **Strict Honesty Policy**: Neither production backend nor desktop UI silently falls back to a mock model. When a self-hosted endpoint is unreachable or missing a requested model, Atlas surfaces clear setup diagnostics while keeping conventional search functional. Weights are never auto-downloaded without explicit user action.

---

## 1. Evaluated Open-Weight Model Runtimes

| Runtime | Target Hardware | Strengths | Protocol |
| :--- | :--- | :--- | :--- |
| **Ollama** | Apple Silicon (M1–M4) & Dev Workstations | Zero-config Metal GPU acceleration on macOS, model pull management, OpenAI `/v1` API on port `11434`. | `/v1/chat/completions`, `/v1/models` |
| **vLLM** | Linux + NVIDIA GPUs (A10G, L4, A100, H100) | High-throughput PagedAttention continuous batching, guided JSON schema decoding, OpenAI tool calling. | `/v1/chat/completions`, `/v1/models` |
| **llama.cpp (`llama-server`)** | CPU-only Linux/macOS/Windows & Edge | Minimal memory footprint, GGUF quantization, pure C++ binary without Python/CUDA dependencies. | `/v1/chat/completions`, `/v1/models` |

---

## 2. Recommended Open-Weight Models & Verified Licensing

Before commercial deployment, verify the exact model tag's license in the upstream repository:

| Model | Recommended Use | Approximate RAM / VRAM (Q4_K_M) | Tool Calling & JSON | License Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Qwen2.5-7B-Instruct** | Balanced Search Citation Synthesis & Browser Tool Calls | ~5.5 GB RAM/VRAM (32K–128K ctx) | Native Hermes/OpenAI tool calling & structured JSON | **Apache 2.0** (permissive commercial use; note larger Qwen variants e.g. 72B/special editions differ—check tag). |
| **Qwen2.5-3B-Instruct** | Fast Apple Silicon 16GB / CPU fallback | ~2.5 GB RAM/VRAM | Solid structured JSON & lightweight tool routing | **Qwen Research License** on 3B! *(Important: Qwen2.5-3B is NOT Apache 2.0—check license before commercial redistribution; use `Qwen2.5-7B-Instruct` Apache 2.0 or `Llama-3.2-3B-Instruct` / `SmolLM2` / `Mistral-7B-v0.3` Apache 2.0 for commercial use).* |
| **Llama-3.2-3B-Instruct** / **Llama-3.1-8B-Instruct** | Fast Edge / Balanced Reasoning | ~2.5 GB / ~5.5 GB | Good function calling | **Llama 3.2 / 3.1 Community License** (commercial use permitted if monthly active users < 700M). |
| **Mistral-7B-Instruct-v0.3** | General Grounded Q&A | ~5.0 GB | Function calling supported | **Apache 2.0** (permissive commercial use). |

---

## 3. Hardware Configuration Guides

### A. Apple Silicon Local Development (e.g., Apple M4 16 GB Unified Memory)
```bash
# Install Ollama on macOS (manual user step; Atlas never auto-downloads weights)
brew install ollama
ollama serve &
ollama pull qwen2.5:7b-instruct

# Point Atlas Settings -> AI Provider -> Self-Hosted Runtime:
# Endpoint URL: http://127.0.0.1:11434/v1
# Model ID:     qwen2.5:7b-instruct
```

### B. GPU Production Server (`vLLM`)
```bash
vllm serve Qwen/Qwen2.5-7B-Instruct \
  --host 127.0.0.1 \
  --port 8000 \
  --api-key "${ATLAS_SELF_HOSTED_API_KEY}" \
  --enable-auto-tool-choice \
  --tool-call-parser hermes

# Backend .env:
ATLAS_AI_PROVIDER=self_hosted
ATLAS_SELF_HOSTED_URL=http://127.0.0.1:8000/v1
ATLAS_SELF_HOSTED_MODEL=Qwen/Qwen2.5-7B-Instruct
```

### C. CPU-Only Fallback (`llama.cpp llama-server`)
```bash
llama-server -m ./models/Mistral-7B-Instruct-v0.3.Q4_K_M.gguf \
  --host 127.0.0.1 --port 8080 -c 4096 -t 8

# Configure Endpoint URL: http://127.0.0.1:8080/v1
```
*(Expect 5–15 tokens/sec on CPU-only hosts; reduce `maxOutputTokens` and disable multi-page concurrent synthesis).*

---

## 4. Atlas Model Evolution & Fine-Tuning Pipeline

implemented utility: [`src/main/agent/training/dataset-exporter.ts`](../src/main/agent/training/dataset-exporter.ts) (`exportConsentedTrainingExamples`, `serializeToJsonl`).

1. **Consented Data Collection**: Requires `explicitUserConsent === true`. Strictly filters out `isPrivate === true` runs and runs `redactSecrets()` across goals, traces, and answers.
2. **Pre-Training Baseline Evaluation**: Record NDCG@5, Citation Accuracy, Groundedness, and 27-scenario Browser Agent evaluation scores before any fine-tuning.
3. **LoRA / QLoRA Fine-Tuning**: Train targeted adapter weights (`atlas-qwen2.5-7b-lora-vX`) using QLoRA (4-bit NF4 base + bf16 rank-16 LoRA adapters) on JSON citation formatting and deterministic browser tool-use traces — rather than full pretraining.
4. **Model Versioning & Regression Gate**: Promote adapter version only if offline evaluation shows zero safety violations, >= baseline Citation Accuracy (100%), and latency within SLA.
5. **Instant Rollback**: Because model IDs are cleanly configured per endpoint (`ATLAS_SELF_HOSTED_MODEL`), rollback swaps the versioned adapter tag with zero schema or client changes.
6. **Future From-Scratch Small Model (Research Horizon)**: Would require curated public-domain web text + permissively licensed code corpora, tokenizer training, 1B–3B dense transformer pretraining on multi-node H100 clusters, followed by SFT/DPO alignment; Atlas has **not** trained a foundation model in this codebase.
