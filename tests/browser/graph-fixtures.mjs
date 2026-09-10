import { setup } from './fixtures.mjs';
import { transcriptResponse, session } from './transcript-fixtures.mjs';
export const projectId = session.project_id;
export const graphRuns = [1, 2, 3].map((day, index) => ({
  id: `77777777-7777-4777-8777-${String(day).padStart(12, '0')}`,
  project_id: projectId, project_key: '/work/penelopa.ai', session_id: index < 2 ? session.id : '88888888-8888-4888-8888-888888888888',
  session_key: index < 2 ? 'Build the dashboard' : 'Understand the API', source: index < 2 ? 'claude-anthropic' : 'codex-openai', external_session_id: null,
  transcript_first_seen_at: '2026-09-01T09:00:00Z', transcript_last_seen_at: '2026-09-03T09:00:00Z',
  input_event_watermark: 3, input_event_watermark_decimal: '3', event_count: 3, included_event_count: 3, skipped_event_count: 0,
  content_character_count: 100, chunk_count: 1, processed_chunk_count: 1, node_count: 2, edge_count: 1,
  graph_schema_version: 'session-knowledge-graph-v1', graph_created_at: `2026-09-0${day}T10:00:00Z`,
  graph_updated_at: `2026-09-0${day}T11:00:00Z`, graph_finished_at: `2026-09-0${day}T11:00:00Z`, graph_activity_at: `2026-09-0${day}T11:00:00Z`, is_current: index !== 0,
}));
const relationships = [
  { from: 'Dashboard', relationship: 'uses', to: 'API' },
  { from: 'Dashboard', relationship: 'renders', to: 'Timeline' },
  { from: 'API', relationship: 'stores', to: 'Knowledge' },
];
export function graphResponse(entry) {
  const url = new URL(entry.path, 'https://api.penelopa.ai');
  if (url.pathname === '/v2/user-read/knowledge-graphs') {
    const items = [...graphRuns].reverse().filter(run => !url.searchParams.has('session_id') || run.session_id === url.searchParams.get('session_id'));
    return { json: { schema_version: 'user-read-v1', items, next_cursor: null, truncated: false } };
  }
  const index = graphRuns.findIndex(run => url.pathname === `/v2/user-read/knowledge-graphs/${run.id}`);
  if (index >= 0) {
    const edge = relationships[index];
    return { json: { ...graphRuns[index], nodes: [edge.from, edge.to].map((label, i) => ({ id: `opaque-${index}-${i}`, label })), edges: [edge], node_total: 2, edge_total: 1, node_next_cursor: null, edge_next_cursor: null, nodes_truncated: false, edges_truncated: false } };
  }
  return transcriptResponse(entry);
}
export async function setupGraphs(page, options = {}) {
  if (options.fallback !== false) await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : original.call(this, type, ...args); };
  });
  return setup(page, { token: 'fixture-token', theme: options.theme || 'light', fixedTime: false, respond: async entry => (options.respond && await options.respond(entry)) || graphResponse(entry) });
}
