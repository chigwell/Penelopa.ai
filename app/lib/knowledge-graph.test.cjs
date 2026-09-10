const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const path = require('node:path');
const { TextEncoder } = require('node:util');
function load(file) {
  const source = buildSync({ entryPoints: [path.join(__dirname, file)], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'] }).outputFiles[0].text;
  const module = { exports: {} }; vm.runInNewContext(source, { module, exports: module.exports, require, URLSearchParams, AbortController, DOMException, setTimeout, TextEncoder, Uint8Array, DataView, ArrayBuffer, Blob, URL }); return module.exports;
}
const { normalizeGraphText, mergeKnowledgeGraphs, graphForSelection, resolveGraphSelection } = load('knowledge-graph-model.ts');
const { createGraphClient, graphAvailable, graphCatalog, GraphProjectLoader } = load('knowledge-graph-client.ts');
const { buildKnowledgeGraphExport, createStoreZip, KNOWLEDGE_GRAPH_CSV_NAME, KNOWLEDGE_GRAPH_README_NAME } = load('knowledge-graph-export.ts');
const json = value => JSON.parse(JSON.stringify(value));
const run = (id, day, extra = {}) => ({ id, project_id: 'p', session_id: id, session_key: id, source: 'codex', graph_created_at: `2026-09-0${day}T00:00:00Z`, graph_finished_at: null, node_count: 2, ...extra });
const snapshot = (id, day, edges, extra = {}) => ({ run: run(id, day, extra), nodes: [...new Set(edges.flatMap(edge => [edge.from, edge.to]))].map(label => ({ id: label, label })), edges });
const noFilters = { sessions: [], source: '' };
const before = Date.parse('2026-09-01T12:00:00Z');
function readStoreZip(bytes) {
  const buffer = Buffer.from(bytes), entries = {};
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6), method = buffer.readUInt16LE(offset + 8), size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28);
    assert.equal(flags, 0x800); assert.equal(method, 0);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'), start = offset + 30 + nameLength + extraLength;
    entries[name] = buffer.subarray(start, start + size).toString('utf8');
    offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  return entries;
}
function exportOrigin(runId, at, extra = {}) {
  return {
    runId, projectId: 'p', projectKey: '/work/penelopa.ai', sessionId: 's', sessionKey: 'Build the dashboard',
    source: 'codex-openai', at, originalId: null, label: '', transcriptStart: '2026-09-01T09:00:00Z',
    transcriptEnd: '2026-09-01T10:00:00Z', search: '', ...extra,
  };
}

test('normalization matches Python casefold and whitespace semantics', () => {
  assert.equal(normalizeGraphText('  Straße\u0085Σς\u001c A  '), 'strasse σσ a');
  assert.equal(normalizeGraphText('İ ﬃ'), 'i\u0307 ffi');
  assert.equal(normalizeGraphText('\ufeffNode'), '\ufeffnode');
});
test('selection graph merges names, distinguishes directions and does not accumulate in latest', () => {
  const graph = mergeKnowledgeGraphs([
    snapshot('a', 1, [{ from: 'Straße', relationship: 'uses', to: 'API' }]),
    snapshot('b', 2, [{ from: 'STRASSE', relationship: 'USES', to: 'api' }, { from: 'api', relationship: 'uses', to: 'strasse' }, { from: 'api', relationship: 'builds', to: 'strasse' }]),
    snapshot('c', 3, [{ from: 'Project', relationship: 'uses', to: 'API' }]),
  ], noFilters);
  assert.equal(graphForSelection(graph, { mode: 'all' }).nodes.length, 3); assert.equal(graphForSelection(graph, { mode: 'all' }).edges.length, 4);
  assert.equal(graph.edges[0].origins.length, 2);
  const latest = graphForSelection(graph, { mode: 'latest', at: Date.parse('2026-09-03T00:00:00Z') });
  assert.deepEqual(json(latest.nodes.map(node => node.label).sort()), ['API', 'Project']);
  assert.equal(latest.edges.length, 1);
  const range = graphForSelection(graph, { mode: 'range', from: Date.parse('2026-09-02T00:00:00Z'), to: Date.parse('2026-09-02T23:59:59Z') });
  assert.equal(range.nodes.length, 2); assert.equal(range.edges.length, 3);
  assert.equal(range.edges[0].origins.length, 1);
});
test('default URL selection is all time and old at links resolve as latest', () => {
  const latest = Date.parse('2026-09-03T00:00:00Z');
  assert.deepEqual(json(resolveGraphSelection({}, latest)), { mode: 'all' });
  assert.deepEqual(json(resolveGraphSelection({ mode: 'all', at: '2026-09-01T00:00:00Z' }, latest)), { mode: 'all' });
  assert.deepEqual(json(resolveGraphSelection({ mode: 'latest' }, latest)), { mode: 'latest', at: latest });
  assert.deepEqual(json(resolveGraphSelection({ at: '2026-09-01T00:00:00Z' }, latest)), { mode: 'latest', at: Date.parse('2026-09-01T00:00:00Z') });
  assert.deepEqual(json(resolveGraphSelection({ mode: 'range', from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' }, latest)), { mode: 'range', from: Date.parse('2026-09-01T00:00:00Z'), to: Date.parse('2026-09-02T00:00:00Z') });
});
test('knowledge graph CSV export writes relationship origins, metadata and deterministic ZIP bytes', () => {
  const first = Date.parse('2026-09-01T11:00:00Z'), second = Date.parse('2026-09-02T11:00:00Z');
  const nodes = [
    { id: 'source-node', projectId: 'p', projectKey: '/work/penelopa.ai', label: '=Source', firstSeen: first, observedAt: first, search: '',
      origins: [exportOrigin('r1', first, { originalId: 'n1', label: '=Source' }), exportOrigin('r2', second, { originalId: 'n2', label: '=Source v2' })] },
    { id: 'target-node', projectId: 'p', projectKey: '/work/penelopa.ai', label: 'Target, "Quoted"', firstSeen: first, observedAt: first, search: '',
      origins: [exportOrigin('r1', first, { originalId: 'n3', label: 'Target, "Quoted"' }), exportOrigin('r2', second, { originalId: 'n4', label: 'Target v2' })] },
    { id: 'isolated-node', projectId: 'p', projectKey: '/work/penelopa.ai', label: 'Isolated', firstSeen: first, observedAt: first, search: '', origins: [exportOrigin('r1', first, { originalId: 'n5', label: 'Isolated' })] },
  ];
  const edges = [{ id: 'edge-1', projectId: 'p', projectKey: '/work/penelopa.ai', source: 'source-node', target: 'target-node',
    relationship: '+links', firstSeen: first, observedAt: first, search: '',
    origins: [exportOrigin('r1', first, { originalId: 'e1', label: '+links' }), exportOrigin('r2', second, { originalId: 'e2', label: 'rel, "two"' })] }];
  const input = {
    nodes, edges, selection: { mode: 'all' }, skipped: 3, generatedAt: new Date('2026-09-06T12:00:00Z'),
    project: { id: 'p', label: 'penelopa.ai' }, source: { value: 'codex-openai', label: 'Codex' },
    sessions: [{ id: 's', label: 'Build the dashboard' }], relationship: '+links', edgeQuery: 'rel',
    entityQuery: '=Source', currentUrl: 'https://example.test/dashboard/knowledge-graph?edge_q=rel',
  };
  const output = buildKnowledgeGraphExport(input), again = buildKnowledgeGraphExport(input);
  assert.equal(output.filename, 'knowledge-graph-current-view-20260906T120000Z.zip');
  assert.deepEqual(Array.from(output.bytes), Array.from(again.bytes));
  assert.equal(output.csv.trim().split('\r\n').length, 3);
  assert.match(output.csv, /"'\=Source"/);
  assert.match(output.csv, /"Target, ""Quoted"""/);
  assert.match(output.csv, /"'\+links"/);
  assert.match(output.csv, /"rel, ""two"""/);
  assert.match(output.csv, /"\[""n1""\]","\[""=Source""\]"/);
  assert.doesNotMatch(output.csv, /Isolated/);
  assert.match(output.readme, /Entity search: =Source \(highlight only; not applied to CSV rows\)/);
  assert.match(output.readme, /Omitted isolated entities: 1/);
  assert.match(output.readme, /Relationship origins exported: 2/);
  assert.match(output.readme, /Invalid elements skipped while preparing graph: 3/);
  const entries = readStoreZip(output.bytes);
  assert.deepEqual(Object.keys(entries).sort(), [KNOWLEDGE_GRAPH_CSV_NAME, KNOWLEDGE_GRAPH_README_NAME].sort());
  assert.equal(entries[KNOWLEDGE_GRAPH_CSV_NAME], output.csv);
  assert.equal(entries[KNOWLEDGE_GRAPH_README_NAME], output.readme);
  assert.throws(() => createStoreZip([{ name: '../bad.csv', contents: '' }]), /Unsafe ZIP entry name/);
});
test('all-project graph keeps same labels separate across projects', () => {
  const graph = mergeKnowledgeGraphs([
    snapshot('a', 1, [{ from: 'Shared', relationship: 'uses', to: 'API' }], { project_id: 'p1', project_key: '/work/alpha' }),
    snapshot('b', 1, [{ from: 'Shared', relationship: 'uses', to: 'API' }], { project_id: 'p2', project_key: '/work/beta' }),
  ], noFilters);
  const all = graphForSelection(graph, { mode: 'all' });
  assert.equal(all.nodes.filter(node => node.label === 'Shared').length, 2);
  assert.equal(all.nodes.filter(node => node.label === 'API').length, 2);
  assert.equal(all.edges.length, 2);
  assert.deepEqual([...new Set(all.nodes.map(node => node.projectId))].sort(), ['p1', 'p2']);
});
test('source/session filtering happens before latest selection; repeated observations remain on timeline', () => {
  const inputs = [snapshot('a', 1, [{ from: 'A', relationship: 'uses', to: 'B' }]), snapshot('b', 2, [{ from: 'A', relationship: 'uses', to: 'B' }], { source: 'claude' })];
  assert.equal(mergeKnowledgeGraphs(inputs, noFilters).dates.length, 2);
  const graph = mergeKnowledgeGraphs(inputs, { sessions: ['b'], source: 'claude' });
  assert.equal(graph.nodes[0].firstSeen, Date.parse('2026-09-02T00:00:00Z'));
  assert.equal(graphForSelection(graph, { mode: 'latest', at: before }).nodes.length, 0);
  assert.equal(graphForSelection(graph, { mode: 'latest', at: Date.parse('2026-09-02T00:00:00Z') }).nodes.length, 2);
});
test('invalid elements are counted, endpoints resolve by labels and no future search attributes leak', () => {
  const first = snapshot('a', 1, [{ from: 'A', relationship: 'uses', to: 'B' }]);
  first.nodes[0].id = 'opaque-id';
  first.nodes.push({ id: 'bad' }); first.edges.push({ from: 'missing', relationship: 'uses', to: 'B' });
  const later = snapshot('b', 2, [{ from: 'A', relationship: 'uses', to: 'B', explanation: 'FutureWord' }]);
  later.nodes[0].description = 'FutureWord';
  const graph = mergeKnowledgeGraphs([first, later], noFilters);
  assert.equal(graph.skipped, 2); assert.equal(graph.edges.length, 1);
  assert.equal(graphForSelection(graph, { mode: 'latest', at: Date.parse('2026-09-01T00:00:00Z') }, 'futureword').edges.length, 0);
  assert.equal(graphForSelection(graph, { mode: 'latest', at: Date.parse('2026-09-01T00:00:00Z') }).nodes[0].search.includes('futureword'), false);
  assert.equal(graphForSelection(graph, { mode: 'all' }, '', 'USES').edges.length, 1);
});
test('entities and edges disappear from latest when absent from the newest timestamp', () => {
  const graph = mergeKnowledgeGraphs([
    snapshot('a', 1, [{ from: 'Old', relationship: 'uses', to: 'API' }]),
    snapshot('b', 2, [{ from: 'New', relationship: 'renders', to: 'Timeline' }]),
  ], noFilters);
  assert.equal(graphForSelection(graph, { mode: 'latest', at: Date.parse('2026-09-02T00:00:00Z') }).nodes.some(node => node.label === 'Old'), false);
  assert.equal(graphForSelection(graph, { mode: 'latest', at: Date.parse('2026-09-02T00:00:00Z') }).edges.length, 1);
  assert.equal(graphForSelection(graph, { mode: 'all' }).nodes.length, 4);
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
