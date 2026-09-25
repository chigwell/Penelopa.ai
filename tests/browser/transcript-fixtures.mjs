export const sessionId = '11111111-1111-4111-8111-111111111111';
export const eventId = index => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`;
export const stepId = '33333333-3333-4333-8333-333333333333';
export const session = {
  id: sessionId, project_id: '44444444-4444-4444-8444-444444444444', project_key: '/work/penelopa.ai', source: 'claude-anthropic',
  session_key: 'fixture-session', external_session_id: 'external-session', first_seen_at: '2026-09-06T10:00:00Z', last_seen_at: '2026-09-06T11:30:00Z', event_count: 125, segment_count: 3,
  final_segment_seen: true, storage_state: 'HOT', exact_payload_available: true, first_user_message_preview: 'Make the dashboard feel effortless to explore.',
  latest_event_seq_decimal: '9007199254741117', analysis_run_id: '55555555-5555-4555-8555-555555555555', analysis_watermark_decimal: '9007199254741117',
};
const texts = [
  'Make the dashboard feel effortless to explore. Keep the warm palette and make each interaction feel considered.',
  'I’ll start by reading the dashboard components and the existing design tokens, then trace how session data reaches the client.',
  'rg --files app/dashboard app/styles',
  'app/dashboard/page.tsx\napp/styles/foundations.css\napp/styles/dashboard.css\napp/lib/penelopa-client.ts',
  'The existing typography gives us a strong foundation. I’m keeping the paper canvas and adding a quiet, structured session timeline.',
  'npm run typecheck',
  'All checks passed. The session explorer is ready for visual review.',
];
export const events = Array.from({ length: 125 }, (_, i) => {
  const n = i % 7;
  return { id: eventId(i + 1), session_id: sessionId, event_seq_decimal: (9007199254740993n + BigInt(i)).toString(), epoch: 32,
    event_kind: n === 0 ? 'goal' : n === 2 || n === 5 ? 'tool_call' : n === 3 || n === 6 ? 'observation' : 'action',
    event_type: n === 2 || n === 5 ? 'tool_use' : 'message', actor_type: n === 0 ? 'USER' : n === 3 || n === 6 ? 'TOOL' : 'ASSISTANT',
    role: n === 0 ? 'user' : n === 1 || n === 4 ? 'assistant' : null, tool_name: n === 2 || n === 3 || n === 5 || n === 6 ? 'exec_command' : null,
    tool_call_id: n === 2 || n === 3 ? `call-${Math.floor(i / 7)}` : null, status: n === 2 || n === 3 || n === 5 || n === 6 ? 'SUCCEEDED' : null,
    duration_ms: n === 3 ? 842 : null, occurred_at: `2026-09-06T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`, ingested_at: '2026-09-06T11:30:00Z',
    content_text: texts[n], exact_payload_available: true, content_text_truncated: false, payload_json_truncated: false };
});
export const tail = { items: events.slice(-100), tail_cursor: 'tail-1', history_cursor: 'before-26', has_more: false, reset_required: false, latest_event_seq_decimal: session.latest_event_seq_decimal, analysis_run_id: session.analysis_run_id, analysis_watermark_decimal: session.analysis_watermark_decimal };
export const sectionFor = event => ({ id: 'block-1', kind: event.actor_type === 'TOOL' ? 'tool_output' : event.tool_call_id ? 'tool_input' : 'message', format: event.tool_call_id ? 'text' : 'markdown', label: event.actor_type === 'TOOL' ? 'Output' : event.tool_call_id ? 'Input' : 'Message', preview: event.content_text, total_chars: event.content_text.length, tool_call_id: event.tool_call_id, tool_name: event.tool_name });
export function transcriptResponse(entry) {
  const url = new URL(entry.path, 'https://api.penelopa.ai'), path = url.pathname;
  if (path === '/v2/user-read/projects') return { json: { items: [{ id: session.project_id, project_key: session.project_key }], next_cursor: null } };
  if (path === '/v2/user-read/sessions') {
    if (url.searchParams.has('project_key') && url.searchParams.get('project_key') !== session.project_key) return { json: { items: [], next_cursor: null } };
    const page = Number(url.searchParams.get('cursor')?.replace('page-', '') || 1), limit = Number(url.searchParams.get('limit') || 25);
    return { json: { items: Array.from({ length: Math.min(limit, 6) }, (_, i) => ({ ...session, id: i === 0 ? sessionId : eventId(900 + page * 10 + i), source: i % 2 ? 'codex-openai' : 'claude-anthropic', first_user_message_preview: page > 1 ? `Session page ${page} · ${i + 1}` : [session.first_user_message_preview, 'Add a reliable retry flow for interrupted uploads.', 'Bring the notification settings into focus.', 'Trace a slow request through the API.', 'Polish the welcome screen and empty states.', 'Make the project filters keyboard friendly.'][i], project_key: i % 2 ? '/work/agent-runtime' : session.project_key, event_count: 125 + i * 37, analysis_run_id: i % 3 ? null : session.analysis_run_id })), next_cursor: limit === 5 || page >= 3 ? null : `page-${page + 1}`, truncated: page < 3 } };
  }
  if (path === `/v2/user-read/sessions/${sessionId}`) return { json: session };
  if (path.endsWith('/events/tail')) return { json: url.searchParams.has('cursor') ? { ...tail, items: [], history_cursor: null } : tail };
  if (path === `/v2/user-read/sessions/${sessionId}/events`) {
    const backwards = url.searchParams.get('direction') === 'backward';
    let items = backwards ? events.slice(0, 25) : url.searchParams.get('cursor') ? events.slice(100) : events.slice(0, 100);
    for (const [query, field] of [['actor', 'actor_type'], ['kind', 'event_kind'], ['tool', 'tool_name'], ['status', 'status']]) if (url.searchParams.get(query)) items = items.filter(item => item[field] === url.searchParams.get(query));
    return { json: { items, next_cursor: !backwards && !url.searchParams.has('cursor') ? 'after-100' : null, truncated: items.length === 100 } };
  }
  if (path === '/v2/process/events/search') return { json: { items: events.filter(event => event.content_text.toLowerCase().includes(url.searchParams.get('query').toLowerCase())).slice(0, 50).map(event => ({ ...event, actor_type: undefined, actor: event.actor_type.toLowerCase() })), next_cursor: null } };
  const eventMatch = path.match(/\/user-read\/events\/([^/]+)(.*)/);
  if (eventMatch) {
    const event = events.find(item => item.id === eventMatch[1]);
    if (!event) return { status: 404, json: { detail: 'Event not found' } };
    const section = sectionFor(event);
    if (eventMatch[2].startsWith('/content/')) return { json: { content_version: 'fixture-v1', text: eventMatch[2].endsWith('/raw') ? JSON.stringify(event, null, 2) : event.content_text, next_cursor: null, complete: true } };
    if (eventMatch[2] === '/related') return { json: { items: [{ event_id: eventId(4), section_id: 'block-1', kind: 'tool_output', tool_call_id: event.tool_call_id, tool_name: 'exec_command', event_seq_decimal: events[3].event_seq_decimal, status: 'SUCCEEDED' }], next_cursor: null, indexing_pending: false } };
    return { json: { event, content_version: 'fixture-v1', is_current: true, sections: [section, { ...section, id: 'raw', kind: 'raw', format: 'json', label: 'Source data', tool_call_id: null, total_chars: 1000 }], next_sections_cursor: null } };
  }
  if (path.endsWith('/timeline')) return { json: { analysis_run_id: session.analysis_run_id, freshness_watermark_decimal: session.analysis_watermark_decimal, steps: [{ id: stepId, ordinal: 0, kind: 'exploration', status: 'SUCCEEDED', title: 'Understand the existing dashboard', summary: 'Read the current interface and trace the data flow before making changes.', tool_name: 'exec_command', occurred_at: events[0].occurred_at, ended_at: events[3].occurred_at, confidence: .94, resources: [{ id: 'r1', resource_type: 'file', display_name: 'app/dashboard/page.tsx', uri: null, role: 'read' }] }, { id: '33333333-3333-4333-8333-333333333334', ordinal: 1, kind: 'verification', status: 'SUCCEEDED', title: 'Verify the new experience', summary: 'Run type checks and review the explorer in both themes.', tool_name: null, occurred_at: events[5].occurred_at, ended_at: events[6].occurred_at, confidence: .9, resources: [] }], links: [], next_cursor: null, truncated: false } };
  if (path.endsWith('/evidence')) return { json: { items: [{ id: 'evidence-1', event_id: eventId(3), snippet_text: texts[2], event_seq_decimal: events[2].event_seq_decimal, event_kind: 'tool_call', occurred_at: events[2].occurred_at }], next_cursor: null } };
  return { status: 404, json: { detail: 'Fixture resource unavailable' } };
}
