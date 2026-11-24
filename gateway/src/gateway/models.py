"""Request bodies. Field-level rules live in `gateway.validation`; these models
only fix the JSON structure and refuse unknown fields."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

MAX_BATCH_SIZE = 1000


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    to: str
    from_: str = Field(alias="from")
    text: str
    client_ref: str | None = None


class BatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[MessageIn] = Field(min_length=1, max_length=MAX_BATCH_SIZE)


class WebhookIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    callback_url: str | None


@dataclass(frozen=True, slots=True)
class Tenant:
    """The authenticated caller. Every tenant-scoped query takes its `id`."""

    id: UUID
    slug: str
    name: str
    currency: str
