# syntax=docker/dockerfile:1

FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"
COPY --from=ghcr.io/astral-sh/uv:0.11.18 /uv /usr/local/bin/uv
WORKDIR /app

# Dependencies first: this layer is rebuilt only when the lock file changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
COPY migrations ./migrations
RUN uv sync --frozen --no-dev

# --- test image: adds the dev dependencies and the tests --------------------
FROM base AS test
RUN uv sync --frozen
COPY tests ./tests
CMD ["pytest", "-q"]

# --- runtime image ----------------------------------------------------------
FROM base AS runtime
RUN useradd --system --uid 10001 --no-create-home gateway
USER gateway
EXPOSE 8000
CMD ["uvicorn", "gateway.api.app:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000"]
