import asyncio
import json

import httpx
import pytest

from prospective_memory.agent.remy_client import RemyClient, RemyError


def reminder(**changes):
    return {
        "id": "reminder-1",
        "title": "Prepare notes",
        "dueDate": "2026-10-11T10:00:00Z",
        "status": "pending",
        "snoozeCount": 0,
        "createdAt": "2026-10-11T08:00:00Z",
        "updatedAt": "2026-10-11T08:00:00Z",
        **changes,
    }


def run_with_transport(handler, operation):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            remy = RemyClient("https://remy.example/", "test-secret", client=http)
            return await operation(remy)
    return asyncio.run(scenario())


def test_reads_include_deleted_and_preserve_fields():
    payload = reminder(notes="Source mail", context="work", extra={"key": "value"})

    def handler(request):
        assert request.method == "GET"
        assert request.url.path == "/v1/reminders"
        assert request.url.params["include_deleted"] == "true"
        assert request.headers["X-PMEM-TOKEN"] == "test-secret"
        assert request.extensions["timeout"] == dict.fromkeys(
            ("connect", "read", "write", "pool"), 10.0
        )
        return httpx.Response(200, json=[payload])

    assert run_with_transport(handler, lambda c: c.list_reminders()) == [
        {**payload, "armed": True, "isDeleted": False}
    ]
    assert "armed" not in payload


def test_writes_use_only_reminder_endpoints_and_encoded_ids():
    calls = []
    special_id = "id/with ?#% unicode \u2603"
    target_date = "2026-10-12T12:00:00+05:30"
    payload = reminder(id=special_id)

    def handler(request):
        calls.append(request)
        assert request.headers["X-PMEM-TOKEN"] == "test-secret"
        response_payload = dict(payload)
        if request.url.path.endswith("/complete"):
            response_payload["status"] = "completed"
        elif request.url.path.endswith("/snooze"):
            response_payload.update(status="snoozed", dueDate=target_date)
        return httpx.Response(200, json=response_payload)

    async def operation(client):
        await client.create_reminder(payload)
        await client.complete_reminder(special_id)
        await client.snooze_reminder(special_id, target_date)

    run_with_transport(handler, operation)
    assert len(calls) == 3
    assert all(request.method == "POST" for request in calls)
    assert calls[0].url.raw_path == b"/v1/reminders"
    expected_component = b"id%2Fwith%20%3F%23%25%20unicode%20%E2%98%83"
    assert calls[1].url.raw_path == b"/v1/reminders/" + expected_component + b"/complete"
    assert calls[2].url.raw_path == b"/v1/reminders/" + expected_component + b"/snooze"
    assert json.loads(calls[0].content) == payload
    assert json.loads(calls[2].content) == {"dueDate": target_date}


@pytest.mark.parametrize("write", [False, True])
@pytest.mark.parametrize("status", [302, 401, 404, 408, 429, 500, 503])
def test_http_failures_are_sanitized_and_never_retried(write, status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            status,
            text="test-secret private-response-body",
            headers={"Location": "https://other.example/"},
        )

    with pytest.raises(RemyError) as caught:
        run_with_transport(
            handler,
            lambda c: c.create_reminder(reminder()) if write else c.list_reminders(),
        )
    error = caught.value
    assert error.code == f"http_{status}"
    assert error.ambiguous is (write and not 400 <= status < 500)
    assert error.retryable is (not write and (status in (408, 429) or status >= 500))
    assert "test-secret" not in str(error)
    assert "private-response-body" not in str(error)
    assert len(calls) == 1


@pytest.mark.parametrize("write", [False, True])
@pytest.mark.parametrize("exception", [httpx.ReadTimeout, httpx.ConnectError])
def test_transport_failures_are_ambiguous_only_for_writes(write, exception):
    calls = []

    def handler(request):
        calls.append(request)
        raise exception("test-secret private transport error", request=request)

    with pytest.raises(RemyError) as caught:
        run_with_transport(
            handler,
            lambda c: c.create_reminder(reminder()) if write else c.list_reminders(),
        )
    error = caught.value
    assert error.code == ("timeout" if exception is httpx.ReadTimeout else "transport_error")
    assert error.ambiguous is write
    assert error.retryable is not write
    assert "test-secret" not in str(error)
    assert len(calls) == 1


@pytest.mark.parametrize(
    "malformed",
    [
        {},
        None,
        [None],
        [reminder(id="")],
        [reminder(title=None)],
        [reminder(dueDate=12)],
        [reminder(status="")],
        [reminder(status="unknown")],
        [reminder(dueDate="tomorrow")],
        [reminder(dueDate="2026-10-11T10:00:00")],
        [reminder(createdAt="2026-10-11")],
        [reminder(updatedAt="invalid")],
        [reminder(dueDate="0001-01-01T00:00:00+14:00")],
        [reminder(createdAt="9999-12-31T23:59:59-14:00")],
        [reminder(snoozeCount=True)],
        [reminder(snoozeCount=-1)],
        [reminder(armed=1)],
        [reminder(isDeleted="false")],
        [reminder(createdAt=None)],
        [reminder(updatedAt=None)],
        [reminder(), reminder(id=None)],
    ],
)
def test_malformed_list_contract_fails_without_partial_success(malformed):
    with pytest.raises(RemyError) as caught:
        run_with_transport(
            lambda request: httpx.Response(200, json=malformed),
            lambda c: c.list_reminders(),
        )
    assert caught.value.code == "invalid_response"
    assert caught.value.ambiguous is False


@pytest.mark.parametrize("payload", [{}, reminder(id="wrong-id"), [reminder()]])
def test_invalid_write_response_requires_reconciliation(payload):
    with pytest.raises(RemyError) as caught:
        run_with_transport(
            lambda request: httpx.Response(200, json=payload),
            lambda c: c.complete_reminder("reminder-1"),
        )
    assert caught.value.code == "invalid_response"
    assert caught.value.ambiguous is True


def test_complete_requires_completed_state():
    with pytest.raises(RemyError) as caught:
        run_with_transport(
            lambda request: httpx.Response(200, json=reminder()),
            lambda c: c.complete_reminder("reminder-1"),
        )
    assert caught.value.ambiguous is True


@pytest.mark.parametrize(
    "returned",
    [reminder(status="pending"), reminder(status="snoozed", dueDate="2026-10-12T10:00:00Z")],
)
def test_snooze_requires_state_and_requested_instant(returned):
    with pytest.raises(RemyError) as caught:
        run_with_transport(
            lambda request: httpx.Response(200, json=returned),
            lambda c: c.snooze_reminder("reminder-1", "2026-10-11T10:00:00Z"),
        )
    assert caught.value.ambiguous is True


def test_snooze_accepts_equivalent_timezones_without_normalizing():
    response = reminder(status="snoozed", dueDate="2026-10-11T15:30:00+05:30")
    result = run_with_transport(
        lambda request: httpx.Response(200, json=response),
        lambda c: c.snooze_reminder("reminder-1", "2026-10-11T10:00:00Z"),
    )
    assert result["dueDate"] == response["dueDate"]


@pytest.mark.parametrize(
    "change",
    [
        {"title": "A different title"},
        {"dueDate": "2026-10-12T10:00:00Z"},
        {"armed": False},
        {"isDeleted": True},
        {"status": "completed"},
    ],
)
def test_create_rejects_same_id_with_different_requested_state(change):
    with pytest.raises(RemyError) as caught:
        run_with_transport(
            lambda request: httpx.Response(200, json=reminder(**change)),
            lambda c: c.create_reminder(reminder()),
        )
    assert caught.value.ambiguous is True


@pytest.mark.parametrize("write", [False, True])
def test_non_json_response_is_sanitized(write):
    with pytest.raises(RemyError) as caught:
        run_with_transport(
            lambda request: httpx.Response(200, text="test-secret not-json"),
            lambda c: c.create_reminder(reminder()) if write else c.list_reminders(),
        )
    assert caught.value.code == "invalid_response"
    assert caught.value.ambiguous is write
    assert "test-secret" not in str(caught.value)


def test_extreme_write_response_is_sanitized_and_ambiguous():
    with pytest.raises(RemyError) as caught:
        run_with_transport(
            lambda request: httpx.Response(200, json=reminder(
                status="completed", dueDate="0001-01-01T00:00:00+14:00"
            )),
            lambda c: c.complete_reminder("reminder-1"),
        )
    assert caught.value.code == "invalid_response"
    assert caught.value.ambiguous is True


@pytest.mark.parametrize(
    "date", ["0001-01-01T00:00:00+14:00", "9999-12-31T23:59:59-14:00"]
)
def test_extreme_snooze_date_fails_before_sending(date):
    def handler(request):
        pytest.fail("An overflowing timestamp must never reach the transport")

    with pytest.raises(RemyError) as caught:
        run_with_transport(handler, lambda c: c.snooze_reminder("reminder-1", date))
    assert caught.value.code == "invalid_request"
    assert caught.value.ambiguous is False


@pytest.mark.parametrize("id", ["", " ", ".", "..", None])
def test_invalid_ids_fail_before_sending(id):
    def handler(request):
        pytest.fail("Invalid ID must never reach the transport")

    with pytest.raises(RemyError) as caught:
        run_with_transport(handler, lambda c: c.complete_reminder(id))
    assert caught.value.code == "invalid_request"
    assert caught.value.ambiguous is False


def test_close_respects_injected_client_ownership():
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=[])
        )) as http:
            client = RemyClient("https://remy.example", "test-secret", client=http)
            await client.close()
            assert not http.is_closed
            assert await client.list_reminders() == []
        owned = RemyClient("https://remy.example", "test-secret")
        await owned.close()
        assert owned._client.is_closed

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "url", ["", "ftp://remy.example", "https://user:secret@remy.example", "https://remy.example?x=1"]
)
def test_invalid_configuration_is_sanitized(url):
    with pytest.raises(RemyError) as caught:
        RemyClient(url, "test-secret")
    assert caught.value.code == "invalid_configuration"
    assert "secret" not in str(caught.value)


@pytest.mark.parametrize(
    "token", ["", "test secret", " secret", "secret ", "s\u00e9cret", "secret\r", "secret\n", "secret\t", "secret\x00", "secret\x7f"]
)
def test_invalid_header_token_is_rejected_before_client_creation(token, monkeypatch):
    def forbidden_client(*args, **kwargs):
        pytest.fail("Invalid credentials must be rejected before creating a client")

    monkeypatch.setattr(httpx, "AsyncClient", forbidden_client)
    with pytest.raises(RemyError) as caught:
        RemyClient("https://remy.example", token)
    assert caught.value.code == "invalid_configuration"
    assert caught.value.ambiguous is False
    assert "secret" not in str(caught.value)
