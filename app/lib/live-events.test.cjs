const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

const source = buildSync({ entryPoints: [path.join(__dirname, '../dashboard/sessions/use-live-events.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false }).outputFiles[0].text;
const event = n => ({ id: `event-${n}`, event_seq_decimal: String(n), content_text: `Event ${n}` });
const tail = (items, options = {}) => ({ items, tail_cursor: 'tail-100', history_cursor: 'before-1', has_more: false, reset_required: false, analysis_run_id: 'run-one', analysis_watermark_decimal: '100', latest_event_seq_decimal: '100', ...options });
function fixture() {
  const requests = [], states = [], errors = [], timers = new Map();
  let visible = true, clock = 0;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require, AbortController,
    setTimeout(fn, delay) { const id = ++clock; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const controller = module.exports.createTailController({
    request(cursor, signal) { return new Promise((resolve, reject) => requests.push({ cursor, signal, resolve, reject })); },
    isVisible: () => visible,
    publish: state => states.push(state),
    onError: error => errors.push(error),
  });
  return { controller, requests, states, errors, timers, setVisible(value) { visible = value; }, tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('explicit bootstrap serializes behind polling and coalesces concurrent latest-window requests', async () => {
  const f = fixture(); f.controller.refresh();
  f.requests[0].resolve(tail([event(100)])); await flush();
  f.tick(); assert.equal(f.requests[1].cursor, 'tail-100');
  const first = f.controller.refreshBootstrap(), second = f.controller.refreshBootstrap();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve(tail([event(101)], { tail_cursor: 'tail-101' })); await flush();
  assert.equal(f.requests.length, 3); assert.equal(f.requests[2].cursor, '');
  const authoritative = tail([event(200)], { tail_cursor: 'tail-200', history_cursor: 'before-200' });
  f.requests[2].resolve(authoritative); await flush();
  assert.equal((await first).items[0].id, 'event-200');
  assert.equal(await first, await second);
  assert.equal(f.states.at(-1).newCount, 0);
  assert.equal(f.states.at(-1).data.history_cursor, 'before-200');
  f.tick(); assert.equal(f.requests[3].cursor, 'tail-200');
  f.controller.stop();
});

test('rolling updates use the server history anchor and empty unchanged polls retain identity', async () => {
  const f = fixture(); f.controller.refresh();
  const items = Array.from({ length: 100 }, (_, i) => event(i + 101));
  f.requests[0].resolve(tail(items, { tail_cursor: 'tail-200', history_cursor: 'before-101' })); await flush();
  const initial = f.states.at(-1).data;
  f.tick(); f.requests[1].resolve(tail([], { tail_cursor: 'tail-200', history_cursor: 'before-101' })); await flush();
  assert.equal(f.states.at(-1).data, initial);
  f.tick(); f.requests[2].resolve(tail(Array.from({ length: 30 }, (_, i) => event(i + 201)), { tail_cursor: 'tail-230', history_cursor: 'before-131' })); await flush();
  assert.equal(f.states.at(-1).data.items.length, 100);
  assert.equal(f.states.at(-1).data.items[0].id, 'event-131');
  assert.equal(f.states.at(-1).data.history_cursor, 'before-131');
  assert.equal(f.states.at(-1).newCount, 30);
  f.controller.acknowledge(); assert.equal(f.states.at(-1).newCount, 0);
  f.tick(); f.requests[3].resolve(tail([], { tail_cursor: 'tail-230', history_cursor: null })); await flush();
  assert.equal(f.states.at(-1).data.history_cursor, null);
  f.controller.stop();
});

test('a reparse clears obsolete rows and restarts from an authoritative bootstrap', async () => {
  const f = fixture(); f.controller.refresh();
  f.requests[0].resolve(tail([event(100)])); await flush();
  f.tick(); f.requests[1].resolve(tail([], { reset_required: true })); await flush();
  assert.equal(f.states.at(-1).data, null); assert.equal(f.states.at(-1).resetCount, 1);
  assert.equal(f.requests[2].cursor, '');
  f.requests[2].resolve(tail([event(3)], { analysis_run_id: 'run-two', history_cursor: null })); await flush();
  assert.equal(f.states.at(-1).data.items[0].id, 'event-3');
  assert.equal(f.states.at(-1).newCount, 0);
  f.controller.stop();
});

test('visibility pauses requests, bootstrap promises settle offline, and disposal suppresses old-account responses', async () => {
  const f = fixture(); f.setVisible(false); f.controller.refresh();
  assert.equal(f.requests.length, 0); assert.equal(f.states.at(-1).paused, true);
  assert.equal(await f.controller.refreshBootstrap(), null);
  f.setVisible(true); f.controller.visibilityChanged(); assert.equal(f.requests.length, 1);
  const pending = f.controller.refreshBootstrap();
  f.controller.stop(); assert.equal(await pending, null);
  assert.equal(f.requests[0].signal.aborted, true);
  const count = f.states.length;
  f.requests[0].resolve(tail([event(100)])); await flush();
  assert.equal(f.states.length, count); assert.equal(f.timers.size, 0);
});

test('transient errors back off while forbidden requests stop until explicit bootstrap retry', async () => {
  const f = fixture(); f.controller.refresh();
  f.requests[0].reject(Object.assign(new Error('offline'), { status: 503 })); await flush();
  assert.equal([...f.timers.values()][0].delay, 6000);
  f.tick(); f.requests[1].reject(Object.assign(new Error('forbidden'), { status: 403 })); await flush();
  assert.equal(f.timers.size, 0);
  f.controller.refresh(); assert.equal(f.requests.length, 2);
  const pending = f.controller.refreshBootstrap(); assert.equal(f.requests.length, 3);
  f.requests[2].resolve(tail([event(100)])); await flush();
  assert.ok(await pending); f.controller.stop();
});

test('an authentication failure settles a queued bootstrap without repeating an expired request', async () => {
  const f = fixture(); f.controller.refresh();
  f.requests[0].resolve(tail([event(100)])); await flush();
  f.tick();
  const pending = f.controller.refreshBootstrap();
  f.requests[1].reject(Object.assign(new Error('expired'), { status: 401 })); await flush();
  assert.equal(await pending, null);
  assert.equal(f.requests.length, 2); assert.equal(f.timers.size, 0);
  f.controller.stop();
});
