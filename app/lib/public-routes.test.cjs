const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

function routeFor(route, fetch) {
  const source = buildSync({
    entryPoints: [path.join(__dirname, "..", "api", route, "route.ts")],
    bundle: true, platform: "node", format: "cjs", write: false,
  }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, fetch, Response, console: { error() {} } });
  return module.exports.GET;
}

test("public stats proxy preserves valid payloads and cache policy", async () => {
  const payload = { all_time: { total_tokens: 100, messages_count: 20, recommendations_count: 3 },
    last_24h: { total_tokens: 50, messages_count: 10, recommendations_count: 1 },
    generated_at: "2026-09-06T12:00:00Z", cache_ttl_seconds: 30, extra: "preserved" };
  const get = routeFor("public-stats", async (url, init) => {
    assert.equal(url, "https://api.penelopa.ai/v1/public/stats/summary");
    assert.equal(init.headers.Accept, "application/json");
    return Response.json(payload);
  });
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=30, s-maxage=30");
  assert.deepEqual(await response.json(), payload);
});

test("public stats proxy distinguishes malformed shapes from unavailable responses", async () => {
  for (const [upstream, message] of [
    [() => Response.json({}), "Public stats returned an unexpected shape."],
    [() => new Response("unavailable", { status: 503 }), "Public stats are temporarily unavailable."],
    [() => new Response("invalid JSON"), "Public stats are temporarily unavailable."],
    [() => { throw Error("offline"); }, "Public stats are temporarily unavailable."],
  ]) {
    const response = await routeFor("public-stats", async () => upstream())();
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: message });
  }
});

test("GitHub proxy retains the selected public fields and cache policy", async () => {
  const response = await routeFor("github-repo", async (url, init) => {
    assert.equal(url, "https://api.github.com/repos/chigwell/penelopa.ai");
    assert.equal(init.headers["X-GitHub-Api-Version"], "2022-11-28");
    assert.equal(init.headers.Accept, "application/vnd.github+json");
    assert.equal(init.headers["User-Agent"], "Penelopa.ai GitHub stars counter");
    return Response.json({ stargazers_count: 123, private: false });
  })();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  const payload = await response.json();
  assert.ok(Number.isFinite(Date.parse(payload.generated_at)));
  assert.deepEqual({ ...payload, generated_at: "timestamp" }, {
    full_name: "chigwell/penelopa.ai", html_url: "https://github.com/chigwell/penelopa.ai",
    stargazers_count: 123, generated_at: "timestamp", cache_ttl_seconds: 3600,
  });
});

test("GitHub proxy keeps unavailable and malformed-shape errors uncached", async () => {
  for (const [upstream, message] of [
    [() => Response.json({ stargazers_count: "123" }), "GitHub repo stats returned an unexpected shape."],
    [() => new Response(null, { status: 403 }), "GitHub repo stats are temporarily unavailable."],
    [() => { throw Error("offline"); }, "GitHub repo stats are temporarily unavailable."],
  ]) {
    const response = await routeFor("github-repo", async () => upstream())();
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: message });
  }
});
