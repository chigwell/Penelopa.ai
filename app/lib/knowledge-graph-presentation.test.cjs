const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
function load(file) {
  const source = buildSync({ entryPoints: [require('node:path').join(__dirname, file)], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  const module = { exports: {} }; vm.runInNewContext(source, { module, exports: module.exports, require, Set, Map, Float64Array, Float32Array, Uint8Array, Uint16Array, Uint32Array, ArrayBuffer }); return module.exports;
}
const { prepareGraphPresentation, communityColors } = load('knowledge-graph-presentation.ts');
const { mergeKnowledgeGraphs, graphForSelection } = load('knowledge-graph-model.ts');
const nodes = ids => ids.map(id => ({ id, label: id }));
const edge = (source, target, id = `${source}-${target}`) => ({ id, source, target });
const plain = value => JSON.parse(JSON.stringify(value));

test('degree counts incoming, outgoing, reciprocal and self-loop ends', () => {
  const graph = prepareGraphPresentation({ nodes: nodes(['A', 'B', 'C', 'isolated']), edges: [edge('A', 'B'), edge('B', 'A'), edge('C', 'A'), edge('A', 'A'), edge('A', 'B', 'another-relationship')] });
  assert.deepEqual(plain(graph.nodes.map(node => [node.id, node.degree])), [['A', 6], ['B', 3], ['C', 1], ['isolated', 0]]);
  const isolated = graph.nodes.at(-1);
  assert.equal(isolated.communityId, null); assert.equal(graph.isolatedCount, 1);
  assert.equal(graph.communities.flatMap(c => c.count).reduce((a, b) => a + b, 0), 3);
});

test('dense groups joined by a bridge form deterministic structural communities', () => {
  const ids = ['A0', 'A1', 'A2', 'A3', 'A4', 'B0', 'B1', 'B2', 'B3', 'B4'];
  const edges = [];
  for (const group of [ids.slice(0, 5), ids.slice(5)]) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) edges.push(edge(group[i], group[j]));
  edges.push(edge('A0', 'B0'));
  const graph = prepareGraphPresentation({ nodes: nodes(ids), edges });
  assert.equal(graph.communities.length, 2);
  assert.deepEqual(plain(graph.communities.map(c => c.label).sort()), ['Around A0', 'Around B0']);
  assert.notEqual(graph.nodes[0].communityId, graph.nodes[5].communityId);
  assert.deepEqual(plain(prepareGraphPresentation({ nodes: nodes(ids.reverse()), edges: [...edges].reverse() })), plain(graph));
});

test('empty graphs, isolates and self-loop-only graphs remain valid', () => {
  assert.deepEqual(plain(prepareGraphPresentation({ nodes: [], edges: [] })), { nodes: [], communities: [], isolatedCount: 0 });
  const isolated = prepareGraphPresentation({ nodes: nodes(['A', 'B']), edges: [] });
  assert.equal(isolated.communities.length, 0); assert.equal(isolated.isolatedCount, 2);
  const loop = prepareGraphPresentation({ nodes: nodes(['A']), edges: [edge('A', 'A')] });
  assert.equal(loop.nodes[0].degree, 2); assert.equal(loop.communities.length, 1);
});

test('presentation follows the active time, source, session and relationship selection', () => {
  const snapshots = [1, 2].map(day => ({ run: { id: `r${day}`, project_id: 'p', session_id: `s${day}`, source: `source${day}`, graph_created_at: `2026-09-0${day}T00:00:00Z` }, nodes: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], edges: day === 1 ? [{ from: 'A', to: 'B', relationship: 'uses' }, { from: 'A', to: 'C', relationship: 'uses' }] : [{ from: 'B', to: 'C', relationship: 'stores' }] }));
  const graph = mergeKnowledgeGraphs(snapshots, { sessions: [], source: '' });
  const all = prepareGraphPresentation(graphForSelection(graph, { mode: 'all' }));
  assert.equal(all.nodes.find(n => n.label === 'A').degree, 2);
  const latest = prepareGraphPresentation(graphForSelection(graph, { mode: 'latest', at: Date.parse('2026-09-02') }));
  assert.equal(latest.nodes.find(n => n.label === 'A').communityId, null);
  const range = prepareGraphPresentation(graphForSelection(graph, { mode: 'range', from: Date.parse('2026-09-01'), to: Date.parse('2026-09-01') }));
  assert.equal(range.nodes.find(n => n.label === 'A').degree, 2);
  const filtered = prepareGraphPresentation(graphForSelection(graph, { mode: 'all' }, '', 'stores'));
  assert.equal(filtered.nodes.length, 2); assert.equal(filtered.nodes.some(n => n.label === 'A'), false);
  for (const filters of [{ sessions: ['s2'], source: '' }, { sessions: [], source: 'source2' }]) {
    const filteredGraph = mergeKnowledgeGraphs(snapshots, filters);
    assert.deepEqual(plain(prepareGraphPresentation(graphForSelection(filteredGraph, { mode: 'all' }))), plain(latest));
  }
});

test('community colors remain distinguishable from both canvas backgrounds', () => {
  const luminance = hex => hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  for (const pair of communityColors) for (const [theme, bg] of [['light', '#fcfbf8'], ['dark', '#12110f']]) {
    const a = luminance(pair[theme]), b = luminance(bg);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 3, `${theme}: ${pair[theme]}`);
  }
});
