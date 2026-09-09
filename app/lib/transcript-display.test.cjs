const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
const source = buildSync({ entryPoints: [path.join(__dirname, 'transcript-display.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const mod = { exports: {} }; vm.runInNewContext(source, { module: mod, exports: mod.exports, URLSearchParams });
const { mergeEvents, eventLabel, eventTone, queryPath, sourceName, projectName } = mod.exports;
test('live rows preserve exact bigint order, deduplicate and bound the window', () => {
  const previous = [{ id: 'b', event_seq_decimal: '9007199254740994', content_text: 'old' }, { id: 'a', event_seq_decimal: '9007199254740993' }];
  const incoming = [{ id: 'b', event_seq_decimal: '9007199254740994', content_text: 'new' }, { id: 'c', event_seq_decimal: '9007199254740995' }];
  const rows = mergeEvents(previous, incoming, 2);
  assert.equal(rows.length, 2); assert.equal(rows[0].id, 'b'); assert.equal(rows[0].content_text, 'new'); assert.equal(rows[1].id, 'c');
});
test('both API actor shapes retain tool and user labels', () => {
  assert.equal(eventLabel({ actor: 'tool', tool_name: 'exec_command' }), 'exec_command');
  assert.equal(eventTone({ actor: 'tool' }), 'tool');
  assert.equal(eventLabel({ actor_type: 'USER' }), 'You');
  assert.equal(eventTone({ event_kind: 'problem', actor: 'ASSISTANT' }), 'error');
  assert.equal(eventLabel({ event_type: 'future_kind' }), 'future kind');
});
test('filters and cursors are encoded without losing opaque values', () => {
  const result = queryPath('/events', { cursor: 'a+/=', tool: 'functions.exec', query: 'a & b', empty: '', limit: 100 });
  const parsed = new URL(`https://fixture.test${result}`);
  assert.equal(parsed.searchParams.get('cursor'), 'a+/='); assert.equal(parsed.searchParams.get('query'), 'a & b'); assert.equal(parsed.searchParams.has('empty'), false);
});
test('agent and project labels preserve unfamiliar sources', () => {
  assert.equal(sourceName('claude-anthropic'), 'Claude Code'); assert.equal(sourceName('codex-openai'), 'Codex'); assert.equal(sourceName('future-agent'), 'future-agent'); assert.equal(projectName('C:\\work\\project'), 'project');
});
