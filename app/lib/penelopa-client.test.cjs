const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const source = buildSync({
  entryPoints: [path.join(__dirname, "penelopa-client.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
}).outputFiles[0].text;

function clientFor({ bridge, fetch, stored = {}, hash = "" } = {}) {
  const storage = new Map(Object.entries(stored));
  const replaced = [];
  const window = {
    penelopaDesktop: bridge,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    location: { hash, pathname: "/dashboard", search: "?tab=activity" },
    history: { replaceState: (...args) => replaced.push(args) },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, require, window, fetch, Headers,
    URLSearchParams, document: { title: "Penelopa.ai" },
  });
  return { client: module.exports, storage, replaced, window };
}

test("browser credentials are trimmed on read, stored verbatim, and removable", () => {
  const { client, storage } = clientFor({ stored: { "penelopa-api-token": "  saved-token  " } });
  assert.equal(client.readStoredToken(), "saved-token");
  client.storeToken(" next-token ");
  assert.equal(storage.get("penelopa-api-token"), " next-token ");
  client.clearStoredToken();
  assert.equal(client.readStoredToken(), null);
});

test("token hashes are trimmed and removed while preserving route and query", () => {
  const { client, replaced } = clientFor({ hash: "#token=%20hash-token%20&other=value" });
  assert.equal(client.consumeTokenFromHash(), "hash-token");
  assert.deepEqual(replaced, [[null, "Penelopa.ai", "/dashboard?tab=activity"]]);
  const blank = clientFor({ hash: "#token=%20%20" });
  assert.equal(blank.client.consumeTokenFromHash(), null);
  assert.equal(blank.replaced.length, 0);
});

test("unavailable browser storage leaves session operations usable", () => {
  const { client, window } = clientFor();
  window.localStorage = new Proxy({}, { get() { throw new Error("unavailable"); } });
  assert.equal(client.readStoredToken(), null);
  assert.doesNotThrow(() => client.storeToken("token"));
  assert.doesNotThrow(() => client.clearStoredToken());
});

test("browser transport preserves methods and payloads and supplies authentication headers", async () => {
  const requests = [];
  const { client } = clientFor({ fetch: async (...args) => {
    requests.push(args);
    return new Response(JSON.stringify({ enabled: true }), { status: 200 });
  } });
  assert.deepEqual(await client.apiRequest("/user/telegram-notifications", "token", {
    method: "PATCH", body: '{"enabled":true}', headers: { "X-Trace": "trace" },
  }), { enabled: true });
  const [url, init] = requests[0];
  assert.equal(url, "https://api.penelopa.ai/v1/user/telegram-notifications");
  assert.equal(init.method, "PATCH");
  assert.equal(init.body, '{"enabled":true}');
  assert.equal(init.headers.get("Authorization"), "Bearer token");
  assert.equal(init.headers.get("Accept"), "application/json");
  assert.equal(init.headers.get("Content-Type"), "application/json");
  assert.equal(init.headers.get("X-Trace"), "trace");
  assert.equal(client.apiGet, client.apiRequest);
});

test("transport preserves null success payloads and status-bearing errors", async () => {
  for (const [status, body, expected] of [
    [204, null, null], [200, "not JSON", null],
    [401, '{"detail":"Expired token"}', "Expired token"],
    [503, "not JSON", "The request could not be completed."],
    [403, '{"detail":12}', "12"],
  ]) {
    const { client } = clientFor({ fetch: async () => new Response(body, { status }) });
    if (status < 300) assert.equal(await client.apiRequest("/test", "token"), expected);
    else await assert.rejects(client.apiRequest("/test", "token"), (error) =>
      error.status === status && error.message === expected);
  }
});

test("desktop bridge owns credentials and receives only versioned request data", async () => {
  const requests = [];
  let signedOut = 0;
  const { client, storage, replaced } = clientFor({
    bridge: { version: 1, request: async (request) => {
      requests.push(JSON.parse(JSON.stringify(request)));
      return { status: 204, data: null };
    }, auth: { signOut: async () => { signedOut++; } } },
    stored: { "penelopa-api-token": "browser-token" }, hash: "#token=hash-token",
  });
  assert.equal(client.isDesktop(), true);
  assert.equal(client.readStoredToken(), "penelopa:installed-session");
  client.storeToken("should-not-persist");
  assert.equal(storage.get("penelopa-api-token"), "browser-token");
  assert.equal(client.consumeTokenFromHash(), null);
  assert.equal(replaced.length, 0);
  assert.equal(await client.apiRequest("/settings", "unused", { method: "PATCH", body: '{"enabled":false}' }), null);
  assert.deepEqual(requests, [{ path: "/v1/settings", method: "PATCH", body: { enabled: false } }]);
  client.clearStoredToken();
  assert.equal(signedOut, 1);
});

test("v2 browser reads preserve query encoding and request cancellation", async () => {
  const requests = [], controller = new AbortController();
  const { client } = clientFor({ fetch: async (...args) => {
    requests.push(args);
    return new Response('{"items":[]}');
  } });
  assert.equal(client.hasTranscriptSupport(), true);
  assert.deepEqual(await client.apiV2Get('/user-read/projects?query=repo%2Fname', 'account', { signal: controller.signal }), { items: [] });
  const [url, init] = requests[0];
  assert.equal(url, 'https://api.penelopa.ai/v2/user-read/projects?query=repo%2Fname');
  assert.equal(init.signal, controller.signal);
  assert.equal(init.headers.get('Authorization'), 'Bearer account');
  assert.equal(init.method, 'GET');
});

test("v2 errors expose backend code and details without stringifying an object", async () => {
  const detail = { code: 'archive_pending', message: 'Archive restoration is pending.', retry_after_seconds: 5 };
  const { client } = clientFor({ fetch: async () => new Response(JSON.stringify({ detail }), { status: 409 }) });
  await assert.rejects(client.apiV2Get('/user-read/sessions/id', 'account'), error => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'archive_pending');
    assert.equal(error.message, detail.message);
    assert.deepEqual(error.details, detail);
    return true;
  });
});

test("v2 storage errors without server copy retain structured lifecycle detail", async () => {
  const detail = { code: 'storage_payload_unavailable', storage_state: 'EXPIRED', deleted_at: null };
  const { client } = clientFor({ fetch: async () => new Response(JSON.stringify({ detail }), { status: 410 }) });
  await assert.rejects(client.apiV2Get('/user-read/sessions/id', 'account'), error => {
    assert.equal(error.code, 'storage_payload_unavailable');
    assert.equal(error.details.storage_state, 'EXPIRED');
    assert.equal(error.message, 'The request could not be completed.');
    return true;
  });
});

test("old desktop sessions require an update without falling back to browser credentials", async () => {
  let calls = 0;
  const { client } = clientFor({ bridge: { version: 1, request: async () => { calls++; } }, fetch: async () => { calls++; } });
  assert.equal(client.hasTranscriptSupport(), false);
  await assert.rejects(client.apiV2Get('/user-read/sessions', 'never-send'), error => error.status === 426 && error.code === 'desktop_update_required');
  assert.equal(calls, 0);
});

test("updated desktop sends only v2 read paths and never renderer credentials", async () => {
  const requests = [];
  const { client } = clientFor({ bridge: { version: 1, capabilities: { transcriptRead: true }, request: async request => {
    requests.push(JSON.parse(JSON.stringify(request)));
    return { status: 200, data: { items: [] } };
  } } });
  assert.equal(client.hasTranscriptSupport(), true);
  await client.apiV2Get('/user-read/sessions?limit=25', 'never-send');
  assert.deepEqual(requests, [{ path: '/v2/user-read/sessions?limit=25', method: 'GET' }]);
  for (const [path, init] of [
    ['/user-read/sessions', { method: 'POST' }], ['/user-read/sessions', { body: '{}' }],
    ['/auth/token', {}], ['/user-read/../auth/token', {}], ['/user-read/sessions#private', {}],
  ]) await assert.rejects(client.apiV2Get(path, 'never-send', init), error => error.status === 400);
  assert.equal(requests.length, 1);
});

test("knowledge graph capability is additive and cannot fall back to a browser token", async () => {
  let calls = 0;
  const old = clientFor({ bridge: { version: 1, capabilities: { transcriptRead: true }, request: async () => { calls++; } } });
  for (const route of ['/user-read/knowledge-graphs', '/user-read/knowledge-graphs?limit=100', '/user-read/knowledge-graphs/run-id', '/user-read/sessions/session-id/knowledge-graph']) {
    await assert.rejects(old.client.apiV2Get(route, 'never-send'), error => error.status === 426);
  }
  assert.equal(calls, 0);
  const requests = [];
  const updated = clientFor({ bridge: { version: 1, capabilities: { transcriptRead: true, knowledgeGraphRead: true }, request: async request => { requests.push(request); return { status: 200, data: { items: [] } }; } } });
  await updated.client.apiV2Get('/user-read/knowledge-graphs?current_only=false', 'never-send');
  assert.deepEqual(requests.map(request => ({ ...request })), [{ path: '/v2/user-read/knowledge-graphs?current_only=false', method: 'GET' }]);
});
