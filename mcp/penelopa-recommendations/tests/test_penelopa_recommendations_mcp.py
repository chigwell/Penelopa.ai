from __future__ import annotations

import json
from uuid import UUID, uuid4

import httpx
import pytest
from penelopa_recommendations_mcp.client import (
    DEFAULT_API_BASE_URL,
    PenelopaApiError,
    PenelopaClient,
    PenelopaConfigError,
    PenelopaSettings,
    settings_from_env,
)
from penelopa_recommendations_mcp.server import build_server


def _settings(token: str = "secret-token") -> PenelopaSettings:
    return PenelopaSettings(api_token=token)


async def test_list_recommendations_uses_pagination_and_bearer_auth():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers["Authorization"]
        return httpx.Response(
            200,
            json={
                "items": [{"id": "rec-1", "title": "Use repeatable checks"}],
                "page": 2,
                "page_size": 10,
                "total": 11,
            },
        )

    client = PenelopaClient(_settings(), transport=httpx.MockTransport(handler))

    payload = await client.list_recommendations(
        page=2,
        page_size=10,
        include_legacy=True,
    )

    assert seen["authorization"] == "Bearer secret-token"
    assert seen["url"] == (
        f"{DEFAULT_API_BASE_URL}/hermes/recommendations?"
        "page=2&page_size=10&include_legacy=true"
    )
    assert payload["page"] == 2
    assert payload["items"][0]["title"] == "Use repeatable checks"


async def test_read_recommendation_returns_detail_and_maps_404():
    result_id = uuid4()

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).endswith(f"/hermes/recommendations/{result_id}"):
            return httpx.Response(
                200,
                json={
                    "id": str(result_id),
                    "title": "Keep verification repeatable",
                    "report_markdown": "# Keep verification repeatable",
                },
            )
        return httpx.Response(404, json={"detail": "not found"})

    client = PenelopaClient(_settings(), transport=httpx.MockTransport(handler))

    detail = await client.read_recommendation(result_id)
    assert detail["report_markdown"] == "# Keep verification repeatable"

    with pytest.raises(PenelopaApiError, match="Recommendation not found"):
        await client.read_recommendation(uuid4())


async def test_feedback_accepts_supplied_and_generated_request_ids():
    result_id = uuid4()
    supplied_request_id = uuid4()
    bodies: list[dict[str, object | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "id": str(uuid4()),
                "action": bodies[-1]["action"],
                "reason": bodies[-1]["reason"],
                "source": "web",
                "created_at": "2026-09-07T10:00:00Z",
            },
        )

    client = PenelopaClient(_settings(), transport=httpx.MockTransport(handler))

    supplied = await client.record_recommendation_feedback(
        result_id=result_id,
        action="implemented",
        reason="Added it",
        request_id=supplied_request_id,
    )
    generated = await client.record_recommendation_feedback(
        result_id=result_id,
        action="useful",
        reason=None,
        request_id=None,
    )

    assert bodies[0] == {
        "action": "implemented",
        "reason": "Added it",
        "request_id": str(supplied_request_id),
    }
    assert supplied["request_id"] == str(supplied_request_id)
    assert UUID(str(bodies[1]["request_id"]))
    assert generated["request_id"] == bodies[1]["request_id"]
    assert generated["feedback"]["action"] == "useful"


@pytest.mark.parametrize(
    ("status_code", "message"),
    [
        (401, "authentication failed"),
        (403, "authentication failed"),
        (422, "rejected the request parameters"),
        (429, "rate limit reached"),
        (503, "temporarily unavailable"),
    ],
)
async def test_rest_errors_are_clear_and_do_not_leak_tokens(status_code: int, message: str):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={"detail": "secret-token should not appear"})

    client = PenelopaClient(_settings(), transport=httpx.MockTransport(handler))

    with pytest.raises(PenelopaApiError) as raised:
        await client.list_recommendations(page=1, page_size=5, include_legacy=False)
    assert message in str(raised.value)
    assert "secret-token" not in str(raised.value)


async def test_network_and_shape_errors_do_not_leak_tokens():
    def network_error(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("token secret-token in lower transport", request=request)

    client = PenelopaClient(_settings(), transport=httpx.MockTransport(network_error))
    with pytest.raises(PenelopaApiError) as raised:
        await client.read_recommendation(uuid4())
    assert "secret-token" not in str(raised.value)
    assert "failed before a response" in str(raised.value)

    invalid = PenelopaClient(
        _settings(),
        transport=httpx.MockTransport(lambda _request: httpx.Response(200, json=[])),
    )
    with pytest.raises(PenelopaApiError, match="unexpected response shape"):
        await invalid.read_recommendation(uuid4())


async def test_server_tool_contracts_expose_argument_bounds():
    server = build_server(_settings(), transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={})))

    tools = {
        tool.name: tool.model_dump(mode="json", by_alias=True, exclude_none=True)
        for tool in await server.list_tools()
    }

    assert set(tools) == {
        "list_recommendations",
        "read_recommendation",
        "record_recommendation_feedback",
    }
    list_schema = tools["list_recommendations"]["inputSchema"]["properties"]
    assert list_schema["page"]["minimum"] == 1
    assert list_schema["page_size"]["minimum"] == 1
    assert list_schema["page_size"]["maximum"] == 25
    feedback_schema = tools["record_recommendation_feedback"]["inputSchema"]["properties"]
    assert feedback_schema["action"]["enum"] == [
        "useful",
        "implemented",
        "already_exists",
        "not_suitable",
    ]
    assert feedback_schema["reason"]["anyOf"][0]["maxLength"] == 2000


async def test_server_calls_mocked_rest_tool():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["page"] == "3"
        return httpx.Response(
            200,
            json={"items": [], "page": 3, "page_size": 5, "total": 0},
        )

    server = build_server(_settings(), transport=httpx.MockTransport(handler))

    result = await server.call_tool("list_recommendations", {"page": 3})

    assert result.is_error is False
    assert result.structured_content == {"items": [], "page": 3, "page_size": 5, "total": 0}


def test_settings_from_env_requires_token_and_redacts_repr():
    with pytest.raises(PenelopaConfigError, match="PENELOPA_API_TOKEN is required"):
        settings_from_env({})

    settings = settings_from_env({"PENELOPA_API_TOKEN": " secret-token "})
    assert settings.api_token == "secret-token"
    assert "secret-token" not in repr(settings)
