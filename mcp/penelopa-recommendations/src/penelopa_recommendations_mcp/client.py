from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID, uuid4

import httpx

DEFAULT_API_BASE_URL = "https://api.penelopa.ai/v1"
DEFAULT_TIMEOUT_SECONDS = 20.0
FeedbackAction = Literal["useful", "implemented", "already_exists", "not_suitable"]


class PenelopaConfigError(RuntimeError):
    pass


class PenelopaApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True, repr=False)
class PenelopaSettings:
    api_token: str
    api_base_url: str = DEFAULT_API_BASE_URL
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    def __post_init__(self) -> None:
        if not self.api_token.strip():
            raise PenelopaConfigError("PENELOPA_API_TOKEN is required")
        object.__setattr__(self, "api_token", self.api_token.strip())
        object.__setattr__(self, "api_base_url", self.api_base_url.rstrip("/"))

    def __repr__(self) -> str:
        return (
            "PenelopaSettings("
            f"api_base_url={self.api_base_url!r}, "
            "api_token='<redacted>', "
            f"timeout_seconds={self.timeout_seconds!r})"
        )


def settings_from_env(environ: Mapping[str, str] | None = None) -> PenelopaSettings:
    source = environ if environ is not None else os.environ
    return PenelopaSettings(
        api_token=source.get("PENELOPA_API_TOKEN", ""),
        api_base_url=source.get("PENELOPA_API_BASE_URL", DEFAULT_API_BASE_URL)
        or DEFAULT_API_BASE_URL,
    )


class PenelopaClient:
    def __init__(
        self,
        settings: PenelopaSettings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport

    async def list_recommendations(
        self,
        *,
        page: int,
        page_size: int,
        include_legacy: bool,
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/hermes/recommendations",
            params={
                "page": page,
                "page_size": page_size,
                "include_legacy": str(include_legacy).lower(),
            },
        )

    async def read_recommendation(self, result_id: UUID) -> dict[str, Any]:
        return await self._request("GET", f"/hermes/recommendations/{result_id}")

    async def record_recommendation_feedback(
        self,
        *,
        result_id: UUID,
        action: FeedbackAction,
        reason: str | None,
        request_id: UUID | None,
    ) -> dict[str, Any]:
        effective_request_id = request_id or uuid4()
        feedback = await self._request(
            "POST",
            f"/hermes/recommendations/{result_id}/feedback",
            json={
                "action": action,
                "reason": reason,
                "request_id": str(effective_request_id),
            },
        )
        return {"request_id": str(effective_request_id), "feedback": feedback}

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, object] | None = None,
        json: dict[str, object | None] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._settings.api_token}",
        }
        url = f"{self._settings.api_base_url}{path}"
        try:
            async with httpx.AsyncClient(
                timeout=self._settings.timeout_seconds,
                transport=self._transport,
            ) as client:
                response = await client.request(
                    method,
                    url,
                    headers=headers,
                    params=params,
                    json=json,
                )
        except httpx.RequestError as exc:
            raise PenelopaApiError(
                "Penelopa API request failed before a response was received."
            ) from exc
        if response.status_code < 200 or response.status_code >= 300:
            raise PenelopaApiError(
                _message_for_status(response.status_code),
                status_code=response.status_code,
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise PenelopaApiError("Penelopa API returned invalid JSON.") from exc
        if not isinstance(payload, dict):
            raise PenelopaApiError("Penelopa API returned an unexpected response shape.")
        return payload


def _message_for_status(status_code: int) -> str:
    if status_code in {401, 403}:
        return "Penelopa API authentication failed. Check PENELOPA_API_TOKEN."
    if status_code == 404:
        return "Recommendation not found or not released for this token."
    if status_code == 422:
        return "Penelopa API rejected the request parameters."
    if status_code == 429:
        return "Penelopa API rate limit reached. Try again later."
    if 500 <= status_code <= 599:
        return "Penelopa API is temporarily unavailable."
    return f"Penelopa API returned HTTP {status_code}."
