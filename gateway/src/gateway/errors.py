"""One error shape for the whole API.

{ "error": { "code": "...", "message": "...", "details": [ ... ] } }
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details

    def body(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            error["details"] = self.details
        return {"error": error}


def unauthorized(message: str = "Missing or invalid credentials.") -> ApiError:
    return ApiError(401, "UNAUTHORIZED", message)


def not_found(what: str = "Resource") -> ApiError:
    return ApiError(404, "NOT_FOUND", f"{what} not found.")


def validation_error(details: list[dict[str, Any]]) -> ApiError:
    return ApiError(422, "VALIDATION_ERROR", "Request validation failed.", details)


# Pydantic error types that have a more specific code in our API.
_PYDANTIC_CODES = {
    "missing": "REQUIRED",
    "too_long": "BATCH_TOO_LARGE",
    "too_short": "BATCH_EMPTY",
}


def _detail_from_pydantic(err: dict[str, Any]) -> dict[str, Any]:
    """Turn a Pydantic location like ('body', 'messages', 3, 'to') into index 3, field 'to'."""
    loc = [part for part in err.get("loc", ()) if part not in ("body", "query", "header", "path")]
    detail: dict[str, Any] = {}
    if len(loc) >= 2 and loc[0] == "messages" and isinstance(loc[1], int):
        detail["index"] = loc[1]
        loc = loc[2:]
    field = ".".join(str(part) for part in loc) or "body"
    code = _PYDANTIC_CODES.get(err.get("type", ""), "INVALID_VALUE")
    # The list-length codes only make sense on the batch list itself.
    if code in ("BATCH_TOO_LARGE", "BATCH_EMPTY") and field != "messages":
        code = "INVALID_VALUE"
    detail.update(field=field, code=code, message=err.get("msg", "Invalid value."))
    return detail


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(exc.body(), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [_detail_from_pydantic(err) for err in exc.errors()]
        return JSONResponse(validation_error(details).body(), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        return JSONResponse(
            {"error": {"code": code, "message": str(exc.detail)}}, status_code=exc.status_code
        )
