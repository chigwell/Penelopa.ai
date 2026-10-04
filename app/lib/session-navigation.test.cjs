const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');

const source = buildSync({
  entryPoints: [path.join(__dirname, 'session-navigation.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
}).outputFiles[0].text;
const mod = { exports: {} };
vm.runInNewContext(source, { module: mod, exports: mod.exports, URLSearchParams });
const {
  readSessionDetailQuery,
  readSessionLibraryQuery,
  sessionEventsPath,
  sessionTimelinePath,
  sessionCatalogPath,
  sessionDetailHref,
  sessionLibraryHref,
  sessionLocationKey,
} = mod.exports;

test('session query defaults and existing opaque values stay unchanged', () => {
  assert.deepEqual({ ...readSessionDetailQuery(new URLSearchParams()) }, {
    view: 'events', eventId: '', sectionId: '', stepId: '', cursor: '',
    direction: 'forward', atLatest: false, query: '', actor: '', kind: '',
    status: '', tool: '',
  });
  const parsed = readSessionDetailQuery(new URLSearchParams({
    view: 'process', event: 'event+/=', section: 'block Ω', step: 'step:2',
    cursor: 'older+/=', direction: 'backward', at: 'latest', q: ' a & b ',
    actor: 'TOOL', kind: 'tool_call', status: 'FAILED', tool: 'functions.exec',
  }));
  assert.deepEqual({ ...parsed }, {
    view: 'process', eventId: 'event+/=', sectionId: 'block Ω', stepId: 'step:2',
    cursor: 'older+/=', direction: 'backward', atLatest: true, query: ' a & b ',
    actor: 'TOOL', kind: 'tool_call', status: 'FAILED', tool: 'functions.exec',
  });
  assert.equal(readSessionDetailQuery(new URLSearchParams('view=future&direction=&at=older')).view, 'events');
  assert.equal(readSessionDetailQuery(new URLSearchParams('view=future&direction=&at=older')).direction, 'forward');
  assert.equal(readSessionDetailQuery(new URLSearchParams('view=future&direction=&at=older')).atLatest, false);
  assert.deepEqual({ ...readSessionLibraryQuery(new URLSearchParams()) }, {
    cursor: '', project: '', source: '', period: '',
  });
  assert.deepEqual({ ...readSessionLibraryQuery(new URLSearchParams('cursor=a%2B%2F%3D&project=C%3A%5Cwork%5Cproject&source=codex-openai&period=30')) }, {
    cursor: 'a+/=', project: 'C:\\work\\project', source: 'codex-openai', period: '30',
  });
});

test('history and search requests retain exact query ordering and bounds', () => {
  const filters = readSessionDetailQuery(new URLSearchParams({
    cursor: 'older+/=', direction: 'backward', actor: 'TOOL', kind: 'tool_call',
    status: 'FAILED', tool: 'functions.exec',
  }));
  assert.equal(sessionEventsPath('session /Ω', filters),
    '/user-read/sessions/session%20%2F%CE%A9/events?limit=100&cursor=older%2B%2F%3D&direction=backward&actor=TOOL&kind=tool_call&status=FAILED&tool=functions.exec&max_chars=30000');
  assert.equal(sessionEventsPath('session /Ω', { ...filters, query: 'a & b' }),
    '/process/events/search?session_id=session+%2F%CE%A9&query=a+%26+b&cursor=older%2B%2F%3D&limit=50&kind=tool_call&tool=functions.exec&status=FAILED');
  assert.equal(sessionEventsPath('session-1', readSessionDetailQuery(new URLSearchParams())),
    '/user-read/sessions/session-1/events?limit=100&direction=forward&max_chars=30000');
});

test('catalog and process requests retain encoding, omissions and limits', () => {
  assert.equal(sessionCatalogPath({ cursor: '', project: '', source: '', lastSeenAfter: '' }),
    '/user-read/sessions?limit=25');
  assert.equal(sessionCatalogPath({
    cursor: 'older+/=', project: 'C:\\work\\Ω', source: 'codex-openai',
    lastSeenAfter: '2026-09-04T12:00:00.000Z',
  }), '/user-read/sessions?limit=25&cursor=older%2B%2F%3D&project_key=C%3A%5Cwork%5C%CE%A9&source=codex-openai&last_seen_after=2026-09-04T12%3A00%3A00.000Z');
  assert.equal(sessionTimelinePath('session /Ω', null),
    '/process/sessions/session%20%2F%CE%A9/timeline?limit=100');
  assert.equal(sessionTimelinePath('session /Ω', 'step+/='),
    '/process/sessions/session%20%2F%CE%A9/timeline?limit=100&after_step=step%2B%2F%3D');
});

test('detail navigation preserves unrelated parameters and selection-specific resets', () => {
  const search = 'keep=1&cursor=older&direction=backward&event=event-1&section=raw';
  assert.equal(sessionDetailHref('session /Ω', search, {
    q: 'a & b', cursor: '', at: '', direction: '', actor: '',
  }), '/dashboard/sessions/session%20%2F%CE%A9?keep=1&event=event-1&section=raw&q=a+%26+b');
  assert.equal(sessionDetailHref('session-1', search, {
    kind: 'problem', cursor: '', direction: '', at: '', event: '', section: '', step: '',
  }), '/dashboard/sessions/session-1?keep=1&kind=problem');
  assert.equal(sessionDetailHref('session-1', 'view=process&step=step-1&keep=1', {
    event: 'event+/=', section: 'block Ω', step: '',
  }), '/dashboard/sessions/session-1?view=process&keep=1&event=event%2B%2F%3D&section=block+%CE%A9');
  assert.equal(sessionDetailHref('session-1', '', {}), '/dashboard/sessions/session-1');
});

test('latest navigation clears event filters while retaining the existing process cursor', () => {
  assert.equal(sessionDetailHref('session-1', 'keep=1&after_step=step-2&event=event-1&q=find&cursor=old', {
    at: 'latest', view: 'events', cursor: '', direction: '', q: '', actor: '',
    kind: '', status: '', tool: '', event: '', section: '', step: '',
  }), '/dashboard/sessions/session-1?keep=1&after_step=step-2&at=latest&view=events');
});

test('library filters reset the cursor while pagination preserves filters and insertion order', () => {
  assert.equal(sessionLibraryHref('keep=1&cursor=old&source=claude-anthropic&project=old', {
    project: 'C:\\work\\Ω',
  }), '/dashboard/sessions?keep=1&source=claude-anthropic&project=C%3A%5Cwork%5C%CE%A9');
  assert.equal(sessionLibraryHref('project=fixture&cursor=old&source=codex-openai', {
    cursor: 'older+/=',
  }, false), '/dashboard/sessions?project=fixture&cursor=older%2B%2F%3D&source=codex-openai');
  assert.equal(sessionLibraryHref('cursor=old&project=fixture&source=codex-openai&period=30', {
    project: '', source: '', period: '',
  }), '/dashboard/sessions');
});

test('cursor history identity retains its established filter and location order', () => {
  assert.equal(sessionLocationKey({
    query: 'a|b', actor: 'TOOL', kind: 'tool_call', status: 'FAILED', tool: 'functions.exec',
  }, { direction: 'backward', cursor: 'older+/=', at: 'latest' }),
    'a|b|TOOL|tool_call|FAILED|functions.exec|backward|older+/=|latest');
});
