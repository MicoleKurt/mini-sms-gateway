FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.18 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Dependencies first: a source change then reuses this layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 --no-create-home carrier
USER carrier

# No CMD. This image runs as two services and docker compose gives each its command:
#   uvicorn mock_carrier.carrier:app --host 0.0.0.0 --port 9000
#   uvicorn mock_carrier.sink:app --host 0.0.0.0 --port 9100
EXPOSE 9000 9100
