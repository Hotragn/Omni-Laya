# laya-serve: Laya over HTTP (POST /v1/systemone). Builds on x86_64 and ARM64.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

# CPU build of torch first, so pip does not pull the much larger CUDA wheels.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install "laya[serve]==0.3.20"

RUN useradd --create-home --uid 10001 laya && mkdir -p /models && chown laya /models
USER laya

# The checkpoints download from Hugging Face on first start into the /models volume.
ENV LAYA_HOST=0.0.0.0 \
    LAYA_PORT=8000 \
    LAYA_DEVICE=cpu \
    LAYA_PRELOAD=1 \
    LAYA_MODELS=english,multilingual

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15m --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
# laya-serve with torch inter-op threads pinned to 1: Laya runs one forward pass per call, and its
# benchmarks measured up to 12x faster CPU calls with this setting.
CMD ["python", "-c", "import torch; torch.set_num_interop_threads(1); from laya.serve import main; main()"]
