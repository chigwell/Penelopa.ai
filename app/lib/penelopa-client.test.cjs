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
