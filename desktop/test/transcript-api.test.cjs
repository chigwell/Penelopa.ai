"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRequest } = require("../runtime/api.cjs");
const id = "12345678-1234-1234-1234-123456789abc";
const session = `/v2/user-read/sessions/${id}`;
const event = `/v2/user-read/events/${id}`;

test("desktop permits bounded transcript reads and opaque cursor queries", () => {
  for (const path of [
    '/v2/user-read/projects?query=repo%2Fchild&limit=20&cursor=opaque_cursor',
    `/v2/user-read/sessions?project_id=${id}&source=claude_code&limit=25&last_seen_after=2026-09-01T00%3A00%3A00Z`,
    session,
    `${session}/events?direction=backward&epoch=0&tool_call_id=call_1&kind=tool_call&actor=ASSISTANT&tool=bash&status=SUCCESS&turn_id=turn%2F1&limit=100&max_chars=30000`,
    `${session}/events/tail?cursor=opaque_cursor&limit=100`,
    `${event}?sections_cursor=opaque_cursor&sections_limit=50`,
    `${event}?section_id=s_tool_input&sections_limit=50`,
    `${event}/content/raw?cursor=opaque_cursor&max_chars=32768`,
    `${event}/related?section_id=output_1&cursor=opaque_cursor&limit=100`,
    `/v2/process/sessions?project_id=${id}&limit=50`,
    `/v2/process/sessions/${id}/timeline?after_step=-1&limit=100`,
    `/v2/process/steps/${id}/evidence?max_items=20&cursor=opaque_cursor`,
    `/v2/process/events/search?session_id=${id}&query=build%20error&kind=tool_call&tool=bash&status=ERROR&occurred_before=2026-09-09T01%3A00%3A00%2B01%3A00&limit=100`,
    `${session}/events?cursor=${'a'.repeat(2048)}`,
  ]) {
    const result = validateRequest({ path });
    assert.equal(result.url, `https://api.penelopa.ai${path}`);
    assert.equal(result.method, 'GET');
  }
});

test("desktop rejects unapproved transcript operations and invalid endpoint queries", () => {
  for (const request of [
    { path: session, method: 'POST' }, { path: session, body: {} },
    { path: '/v2/user-read/openapi.json' }, { path: '/v2/admin/openapi.json' },
    { path: `/v2/user-read/sessions/not-a-uuid` },
    { path: `${session}/segments/raw` }, { path: `/v2/process/sessions/${id}/compare` },
    { path: `${session}/events?limit=101` }, { path: `${session}/events?limit=0` },
    { path: `${session}/events?max_chars=30001` }, { path: `${session}/events?epoch=32768` },
    { path: `${session}/events?direction=descending` }, { path: `${session}/events?from_seq=1` },
    { path: `${session}/events?limit=10&limit=20` }, { path: `${session}/events?cursor=` },
    { path: `${session}/events?cursor=${'a'.repeat(2049)}` },
    { path: `${session}/events?tool=%0Ainvalid` },
    { path: `${session}/events/tail?max_chars=20` },
    { path: `${event}?sections_limit=51` }, { path: `${event}?section_id=raw&sections_cursor=opaque` },
    { path: `${event}?section_id=../raw` }, { path: `${event}/content/raw?max_chars=32769` },
    { path: `${event}/related?section_id=..` },
    { path: `/v2/user-read/projects?limit=51` },
    { path: `/v2/user-read/sessions?project_id=anything` },
    { path: `/v2/user-read/sessions?last_seen_after=2026-09-01T00:00:00` },
    { path: `/v2/process/sessions/${id}/timeline?after_step=2147483648` },
    { path: `/v2/process/sessions/${id}/timeline?after_step=-2` },
    { path: `/v2/process/steps/${id}/evidence?max_items=21` },
    { path: `/v2/process/events/search?query=${'a'.repeat(501)}` },
    { path: `${session}/../events` }, { path: `${session}%2fevents` },
    { path: `${session}#fragment` }, { path: `https://evil.example${session}` },
  ]) assert.throws(() => validateRequest(request), undefined, JSON.stringify(request));
});
