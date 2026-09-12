FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Compile Python bytecode for fast container startup
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

# Install dependencies first for maximum Docker layer caching
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Copy application source
COPY src ./src
COPY README.md ./

# Install the application package
RUN uv sync --frozen --no-dev

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uv run uvicorn prospective_memory.api:app --host 0.0.0.0 --port ${PORT:-8080}"]
