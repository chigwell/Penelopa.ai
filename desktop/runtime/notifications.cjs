'use strict';
const path = require('node:path');
const { home, readJson, writeJson, fingerprint } = require('./files.cjs');
function advance(previous, items, account) {
  const valid = items.filter(item => item && typeof item.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(item.id) && Number.isFinite(Date.parse(item.created_at)));
  const baseline = !previous || previous.account !== account;
  const seen = new Set(baseline ? [] : previous.seen);
  const createdAfter = baseline ? 0 : previous.createdAfter;
  const fresh = baseline ? [] : valid.filter(item => !seen.has(item.id) && Date.parse(item.created_at) >= createdAfter);
  for (const item of valid) seen.add(item.id);
  return { fresh, state: { account, seen: [...seen].slice(-10_000), createdAfter: Math.max(createdAfter, ...valid.map(item => Date.parse(item.created_at)), 0) } };
}
class RecommendationPoller {
  constructor(request, token, notify, root = home()) { this.request = request; this.token = token; this.notify = notify; this.file = path.join(root, 'notification-state.json'); this.failures = 0; this.busy = false; }
  async poll() {
    if (this.busy || !this.token()) return;
    this.busy = true;
    try {
      const account = fingerprint(this.token()); const previous = readJson(this.file, null);
      const items = []; let page = 1; let total = 0;
      do {
        const response = await this.request({ path: `/v1/hermes/recommendations?page=${page}&page_size=100` });
        if (response.status !== 200 || !Array.isArray(response.data?.items)) throw new Error('Recommendations unavailable.');
        const batch = response.data.items; items.push(...batch); total = response.data.total;
        if (!Number.isFinite(total) || total < 0 || !batch.length || page * 100 >= total) break;
        if (previous?.account === account && batch.every(item => Date.parse(item.created_at) < previous.createdAfter)) break;
        page++;
      } while (page <= 100);
      if (!this.token() || fingerprint(this.token()) !== account) return;
      const result = advance(previous, items, account);
      // Persist before displaying so crashes/restarts cannot repeat a toast.
      writeJson(this.file, result.state);
      if (result.fresh.length) this.notify(result.fresh);
      this.failures = 0;
    } catch { this.failures++; }
    finally { this.busy = false; }
  }
  delay() { return Math.min(15 * 60_000, 60_000 * 2 ** Math.min(this.failures, 4)) + Math.floor(Math.random() * 10_000); }
}
module.exports = { advance, RecommendationPoller };
