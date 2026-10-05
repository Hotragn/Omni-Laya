"""Laya as a serverless endpoint on Modal: OmniLaya's counterpart to Jev's hosted API.

Runs the same `laya-serve` app (POST /v1/systemone, GET /health) in a container
that starts when a search needs it and scales to zero when idle. Deploy with
deploy/modal/deploy.py, or directly:

    LAYA_API_KEY=... modal deploy deploy/modal/laya_modal.py

Settings are read when you deploy:

    LAYA_API_KEY         bearer key OmniLaya sends (required)
    LAYA_GPU             empty for CPU, or a Modal GPU type such as T4 or L4 (default: empty)
    LAYA_MIN_CONTAINERS  containers kept warm; 0 scales to zero (default: 0)
    LAYA_MAX_CONTAINERS  most containers at once (default: 2)
    LAYA_SCALEDOWN       seconds idle before a container stops (default: 300)
    LAYA_MODELS          checkpoints to load (default: english,multilingual)

On a GPU Laya answers a question in tens of milliseconds; on CPU in a few hundred.
A container that has scaled to zero takes 20 to 40 seconds to start again.
"""
import os

import modal

LAYA_VERSION = "0.3.20"
REPO = "convaiinnovations/laya"

API_KEY = os.environ.get("LAYA_API_KEY", "")
GPU = os.environ.get("LAYA_GPU", "").strip() or None
MIN_CONTAINERS = int(os.environ.get("LAYA_MIN_CONTAINERS", "0"))
MAX_CONTAINERS = int(os.environ.get("LAYA_MAX_CONTAINERS", "2"))
SCALEDOWN = int(os.environ.get("LAYA_SCALEDOWN", "300"))
MODELS = os.environ.get("LAYA_MODELS", "english,multilingual")


def download_weights():
    """Bake the checkpoints into the image, so a cold start reads them from disk instead of downloading."""
    from huggingface_hub import snapshot_download

    files = ["rl_agent_config.json", "model.safetensors", "config.json", "tokenizer.json", "tokenizer/*", "encoder/*"]
    patterns = list(files)
    for sub in ("multilingual", "typed-decisions"):
        if sub in MODELS:
            patterns += [f"{sub}/{f}" for f in files]
    snapshot_download(REPO, allow_patterns=patterns)


# CUDA torch only when a GPU is requested; the CPU build is much smaller.
torch_install = (
    modal.Image.debian_slim(python_version="3.12").pip_install("torch")
    if GPU
    else modal.Image.debian_slim(python_version="3.12").pip_install("torch", index_url="https://download.pytorch.org/whl/cpu")
)
image = (
    torch_install.pip_install(f"laya[serve]=={LAYA_VERSION}")
    .env({"HF_HOME": "/models", "LAYA_MODELS": MODELS, "LAYA_PRELOAD": "1", "LAYA_DEVICE": "cuda" if GPU else "cpu"})
    .run_function(download_weights)
)

app = modal.App("omnilaya-laya")


@app.function(
    image=image,
    gpu=GPU,
    cpu=2.0,
    memory=6144,
    min_containers=MIN_CONTAINERS,
    max_containers=MAX_CONTAINERS,
    scaledown_window=SCALEDOWN,
    timeout=600,
    secrets=[modal.Secret.from_dict({"LAYA_API_KEY": API_KEY})],
)
# laya-serve runs one forward pass at a time and queues the rest, so one container can hold several requests.
@modal.concurrent(max_inputs=8)
@modal.asgi_app()
def serve():
    import torch
    from laya.serve import create_app

    # Laya runs one forward pass per call, so inter-op threads only compete with each other.
    # Laya's benchmarks measured up to 12x faster CPU calls with this set to 1 (BENCHMARKS.md, CPU tuning).
    torch.set_num_interop_threads(1)

    if not os.environ.get("LAYA_API_KEY"):
        raise RuntimeError("LAYA_API_KEY was empty at deploy time; redeploy with a key so the endpoint is not open to anyone")
    return create_app()
