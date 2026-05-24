# ==========================================
# STAGE 1: Build the virtual environment
# ==========================================
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

# Force bytecode compilation for faster startup times
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Install project dependencies using caching for speed
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    uv sync --frozen --no-install-project --no-dev

# ==========================================
# STAGE 2: Lightweight runtime image
# ==========================================
FROM python:3.12-slim-bookworm AS runtime

LABEL maintainer="Docker Expert" \
      description="Production Dockerfile for AI Manga Translator Backend"

# Install system dependencies required for OpenCV and healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create a system user and group (UID/GID 1001) with home directory for model caches
RUN groupadd -g 1001 appgroup && \
    useradd -m -r -u 1001 -g appgroup appuser

WORKDIR /app

# Copy the pre-built virtual environment from builder stage
COPY --from=builder --chown=appuser:appgroup /app/.venv /app/.venv

# Copy application source code
COPY --chown=appuser:appgroup . /app

# Create necessary directories and ensure appuser has proper permissions
RUN mkdir -p /app/uploads /home/appuser/.cache && \
    chown -R appuser:appgroup /app/uploads /home/appuser/.cache /app

# Prepend the virtual environment to PATH
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR="/home/appuser/.cache/yolo" \
    HF_HOME="/home/appuser/.cache/huggingface"

# Switch to the non-root user
USER appuser

# Expose FastAPI server port
EXPOSE 8000

# Health check to ensure API is responsive
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8000/ || exit 1

# Start the uvicorn server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
