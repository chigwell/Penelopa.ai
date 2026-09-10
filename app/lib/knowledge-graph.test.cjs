const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const path = require('node:path');
function load(file) {
  const source = buildSync({ entryPoints: [path.join(__dirname, file)], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'] }).outputFiles[0].text;
  const module = { exports: {} }; vm.runInNewContext(source, { module, exports: module.exports, require, URLSearchParams, AbortController, DOMException, setTimeout }); return module.exports;
}
const { normalizeGraphText, mergeKnowledgeGraphs, graphAtDate } = load('knowledge-graph-model.ts');
const { createGraphClient, graphAvailable, graphCatalog, GraphProjectLoader } = load('knowledge-graph-client.ts');
const json = value => JSON.parse(JSON.stringify(value));
const run = (id, day, extra = {}) => ({ id, project_id: 'p', session_id: id, session_key: id, source: 'codex', graph_created_at: `2026-09-0${day}T00:00:00Z`, graph_finished_at: null, node_count: 2, ...extra });
const snapshot = (id, day, edges, extra = {}) => ({ run: run(id, day, extra), nodes: [...new Set(edges.flatMap(edge => [edge.from, edge.to]))].map(label => ({ id: label, label })), edges });
const noFilters = { sessions: [], source: '' };
const before = Date.parse('2026-09-01T12:00:00Z');

test('normalization matches Python casefold and whitespace semantics', () => {
  assert.equal(normalizeGraphText('  Straße\u0085Σς\u001c A  '), 'strasse σσ a');
  assert.equal(normalizeGraphText('İ ﬃ'), 'i\u0307 ffi');
  assert.equal(normalizeGraphText('\ufeffNode'), '\ufeffnode');
});
test('cumulative graph retains superseded edges, merges names, distinguishes directions and relationships', () => {
  const graph = mergeKnowledgeGraphs([
    snapshot('a', 1, [{ from: 'Straße', relationship: 'uses', to: 'API' }]),
    snapshot('b', 2, [{ from: 'STRASSE', relationship: 'USES', to: 'api' }, { from: 'api', relationship: 'uses', to: 'strasse' }, { from: 'api', relationship: 'builds', to: 'strasse' }]),
    snapshot('c', 3, [{ from: 'Project', relationship: 'uses', to: 'API' }]),
  ], noFilters);
  assert.equal(graph.nodes.length, 3); assert.equal(graph.edges.length, 4);
  assert.equal(graph.edges[0].origins.length, 2);
  const historical = graphAtDate(graph, before);
  assert.equal(historical.nodes.length, 2); assert.equal(historical.edges.length, 1);
  assert.equal(historical.nodes[0].origins.length, 1); assert.equal(historical.edges[0].origins.length, 1);
});
test('source/session filtering happens before first-seen computation; later repeated observations remain on timeline', () => {
  const inputs = [snapshot('a', 1, [{ from: 'A', relationship: 'uses', to: 'B' }]), snapshot('b', 2, [{ from: 'A', relationship: 'uses', to: 'B' }], { source: 'claude' })];
  assert.equal(mergeKnowledgeGraphs(inputs, noFilters).dates.length, 2);
  const graph = mergeKnowledgeGraphs(inputs, { sessions: ['b'], source: 'claude' });
  assert.equal(graph.nodes[0].firstSeen, Date.parse('2026-09-02T00:00:00Z'));
  assert.equal(graphAtDate(graph, before).nodes.length, 0);
});
test('invalid elements are counted, endpoints resolve by labels and no future search attributes leak', () => {
  const first = snapshot('a', 1, [{ from: 'A', relationship: 'uses', to: 'B' }]);
  first.nodes[0].id = 'opaque-id';
  first.nodes.push({ id: 'bad' }); first.edges.push({ from: 'missing', relationship: 'uses', to: 'B' });
  const later = snapshot('b', 2, [{ from: 'A', relationship: 'uses', to: 'B', explanation: 'FutureWord' }]);
  later.nodes[0].description = 'FutureWord';
  const graph = mergeKnowledgeGraphs([first, later], noFilters);
  assert.equal(graph.skipped, 2); assert.equal(graph.edges.length, 1);
  assert.equal(graphAtDate(graph, before, 'futureword').edges.length, 0);
  assert.equal(graphAtDate(graph, before).nodes[0].search.includes('futureword'), false);
  assert.equal(graphAtDate(graph, Infinity, '', 'USES').edges.length, 1);
});
test('dates use finished time, are sorted and deduplicated independent of API ordering', () => {
  const edge = [{ from: 'A', relationship: 'uses', to: 'B' }];
  const graph = mergeKnowledgeGraphs([snapshot('b', 1, edge, { graph_finished_at: '2026-09-03T00:00:00Z' }), snapshot('a', 2, edge), snapshot('c', 2, edge)], noFilters);
  assert.deepEqual(json(graph.dates), [Date.parse('2026-09-02T00:00:00Z'), Date.parse('2026-09-03T00:00:00Z')]);
});
test('availability traverses empty pages and historical-only graphs', async () => {
  const paths = [];
  const client = createGraphClient(async path => { paths.push(path); return paths.length % 2 ? { items: [], next_cursor: 'next' } : { items: [run('historical', 1, { is_current: false })], next_cursor: null }; });
  assert.equal(await graphAvailable('token', new AbortController().signal, 'session', client), true);
  assert.equal(paths.length, 2); assert.ok(paths.every(path => path.includes('current_only=false') && path.includes('session_id=session')));
  const catalog = await graphCatalog('token', new AbortController().signal, client); assert.equal(catalog.length, 1);
});
test('page cursors are independent; retry resumes only failed pages without duplicate elements', async () => {
  const calls = []; let fail = true;
  const client = createGraphClient(async path => {
    const query = new URL(path, 'https://fixture').searchParams; calls.push(query);
    if (!query.has('edge_cursor')) return { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'A', to: 'B', relationship: 'uses' }], node_next_cursor: null, edge_next_cursor: 'edge-page-2' };
    if (fail) { fail = false; throw new Error('temporary'); }
    return { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'B', to: 'C', relationship: 'uses' }], node_next_cursor: null, edge_next_cursor: null };
  });
  const loader = new GraphProjectLoader(client), signal = new AbortController().signal;
  await assert.rejects(loader.load('token', [run('a', 1)], signal, () => {}), /temporary/);
  const result = await loader.load('token', [run('a', 1)], signal, () => {});
  assert.equal(result[0].nodes.length, 1); assert.equal(result[0].edges.length, 2);
  assert.equal(calls[2].get('node_limit'), '1'); assert.equal(calls[2].get('edge_cursor'), 'edge-page-2');
});
test('global client semaphore bounds concurrent requests at three', async () => {
  let active = 0, maximum = 0;
  const client = createGraphClient(async () => { maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return { items: [], next_cursor: null }; });
  await Promise.all(Array.from({ length: 12 }, () => client.list('token')));
  assert.equal(maximum, 3);
});
test('aborted late IPC results are discarded and repeated catalog cursors stop', async () => {
  const controller = new AbortController();
  const client = createGraphClient(async () => { controller.abort(); return { items: [run('a', 1)], next_cursor: null }; });
  await assert.rejects(graphAvailable('token', controller.signal, undefined, client), error => error.name === 'AbortError');
  const repeating = createGraphClient(async () => ({ items: [], next_cursor: 'same' }));
  await assert.rejects(graphCatalog('token', new AbortController().signal, repeating), /cursor repeated/);
});
