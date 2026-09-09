"use strict";

// Each read surface has its own query contract. This is not an arbitrary API proxy.
const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const isUuid = value => new RegExp(`^${uuid}$`).test(value);
const text = max => value => value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const integer = (min, max) => value => /^-?\d{1,10}$/.test(value) && Number(value) >= min && Number(value) <= max;
const date = value => value.length <= 64 && /^\d{4}-\d\d-\d\d[Tt].+(?:[Zz]|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const cursor = text(2048);
const section = value => /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const eventFilters = {
  kind: text(32), actor: text(32), tool: text(512), status: text(32),
  turn_id: text(512), tool_call_id: text(512), epoch: integer(0, 32767),
  occurred_after: date, occurred_before: date,
};
const session = `/v2/user-read/sessions/${uuid}`;
const event = `/v2/user-read/events/${uuid}`;
const routes = [
  [/^\/v2\/user-read\/projects$/, { query: text(512), cursor, limit: integer(1, 50) }],
  [/^\/v2\/user-read\/sessions$/, {
    project_id: isUuid, project_key: text(512), source: text(64),
    created_after: date, created_before: date, last_seen_after: date, last_seen_before: date,
    cursor, limit: integer(1, 50),
  }],
  [new RegExp(`^${session}$`), {}],
  [new RegExp(`^${session}/events$`), {
    ...eventFilters, direction: value => ["forward", "backward"].includes(value),
    cursor, limit: integer(1, 100), max_chars: integer(1, 30000),
  }],
  [new RegExp(`^${session}/events/tail$`), { cursor, limit: integer(1, 100) }],
  [new RegExp(`^${event}$`), { sections_cursor: cursor, sections_limit: integer(1, 50) }],
  [new RegExp(`^${event}/content/[a-zA-Z0-9_-]{1,128}$`), { cursor, max_chars: integer(1, 32768) }],
  [new RegExp(`^${event}/related$`), { section_id: section, cursor, limit: integer(1, 100) }],
  [/^\/v2\/process\/sessions$/, {
    project_id: isUuid, source: text(64), started_after: date, ended_before: date,
    cursor, limit: integer(1, 50),
  }],
  [new RegExp(`^/v2/process/sessions/${uuid}/timeline$`), { after_step: integer(-1, 2147483647), limit: integer(1, 100) }],
  [new RegExp(`^/v2/process/steps/${uuid}/evidence$`), { cursor, max_items: integer(1, 20) }],
  [/^\/v2\/process\/events\/search$/, {
    query: text(500), project_id: isUuid, session_id: isUuid,
    kind: text(32), tool: text(512), status: text(32),
    occurred_after: date, occurred_before: date, cursor, limit: integer(1, 100),
  }],
];

function validateTranscriptRequest(url, method, body) {
  const route = routes.find(([pattern]) => pattern.test(url.pathname));
  if (method !== "GET" || body !== undefined || !route)
    throw new Error("This transcript operation is not available to the desktop client.");
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || !Object.hasOwn(route[1], key) || !route[1][key](value))
      throw new Error("Invalid transcript query.");
    seen.add(key);
  }
}

module.exports = { validateTranscriptRequest };
