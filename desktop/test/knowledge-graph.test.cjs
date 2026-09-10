const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRequest } = require('../runtime/api.cjs');
const id = '12345678-1234-1234-1234-123456789abc';
test('desktop graph reads accept only endpoint-specific bounded queries', () => {
  for (const path of [
    `/v2/user-read/knowledge-graphs?current_only=false&limit=100&project_id=${id}&session_id=${id}&source=codex&cursor=opaque`,
    '/v2/user-read/knowledge-graphs?project_key=project&session_key=session&external_session_id=external&created_after=2026-09-01T01%3A00%3A00Z&finished_before=2026-09-02T01%3A00%3A00%2B01%3A00&transcript_after=2026-09-01T01%3A00%3A00Z',
    `/v2/user-read/knowledge-graphs/${id}?node_limit=500&edge_limit=500&node_cursor=node&edge_cursor=edge&node_query=stra%C3%9Fe&edge_query=api&relationship=USES`,
    `/v2/user-read/sessions/${id}/knowledge-graph?node_limit=1&edge_limit=1`,
  ]) assert.equal(validateRequest({ path }).url, `https://api.penelopa.ai${path}`);
  for (const path of [
    '/v2/user-read/knowledge-graphs?limit=101', '/v2/user-read/knowledge-graphs?current_only=maybe',
    '/v2/user-read/knowledge-graphs?finished_after=2026-09-01T00:00:00',
    `/v2/user-read/knowledge-graphs/${id}?node_limit=501`, `/v2/user-read/knowledge-graphs/${id}?edge_limit=0`,
    `/v2/user-read/knowledge-graphs/${id}?node_limit=1&node_limit=2`, `/v2/user-read/knowledge-graphs/${id}?project_id=${id}`,
    `/v2/user-read/knowledge-graphs/${id}?relationship=${'a'.repeat(129)}`, '/v2/user-read/knowledge-graphs/not-a-uuid',
    `/v2/user-read/sessions/${id}/knowledge-graph?current_only=false`,
  ]) assert.throws(() => validateRequest({ path }), undefined, path);
  assert.throws(() => validateRequest({ path: '/v2/user-read/knowledge-graphs', method: 'POST' }));
});
