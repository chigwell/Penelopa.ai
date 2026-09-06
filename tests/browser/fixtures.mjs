import { expect } from '@playwright/test';

export const NOW = new Date('2026-09-06T12:00:00Z');
export const recommendation = {
  id: 'rec-1', title: 'Keep verification repeatable', preview_markdown: 'A small repeatable check.',
  project_key: 'fixture-project', session_count: 3, result_type: 'recommendation',
  intervention_type: 'script', created_at: '2026-09-05T10:30:00Z',
  report_markdown: '# Repeatable checks\n\nRun the same **verification** after every change.\n\n```sh\nnpm run typecheck\n```',
};
export const summary = {
  saved_sessions_count: 42, saved_sessions_delta_24h: 3, saved_messages_count: 1234,
  processed_tokens_total: 150000, processed_tokens_delta_24h: 9000,
  unique_projects_count: 5, recommendations_count: 11, recommendations_delta_24h: 2,
};
export const activity = Array.from({ length: 30 }, (_, i) => ({
  day: new Date(Date.UTC(2026, 7, 8 + i)).toISOString().slice(0, 10),
  sessions_count: i % 5, messages_count: i * 3, projects_count: i % 3,
  recommendations_count: i % 2, processed_tokens_total: i * 120,
}));
export const disabledTelegram = {
  enabled: false, status: 'DISABLED', language: 'en', notification_types: ['recommendation_created'],
  setup_available: true, telegram_username: null, telegram_chat_id: null, link_expires_at: null,
};

export async function setup(page, options = {}) {
  const requests = [];
  let telegram = { ...disabledTelegram, ...options.telegram };
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ token, theme }) => {
    if (token) localStorage.setItem('penelopa-api-token', token);
    if (theme) localStorage.setItem('penelopa-theme', theme);
    // Explicit intersection events keep demo checks and screenshots deterministic.
    window.__intersections = [];
    window.IntersectionObserver = class {
      constructor(callback, options) { this.callback = callback; this.options = options; }
      observe(target) { window.__intersections.push({ target, callback: this.callback, options: this.options }); }
      unobserve() {}
      disconnect() {}
    };
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied.push(text); } } });
  }, { token: options.token, theme: options.theme });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.route('**/api/public-stats', route => route.fulfill({ json: {
    all_time: { total_tokens: 150000, messages_count: 1234, recommendations_count: 11 },
    last_24h: { total_tokens: 9000, messages_count: 50, recommendations_count: 2 },
    generated_at: NOW.toISOString(), cache_ttl_seconds: 30,
  } }));
  await page.route('**/api/github-repo', route => route.fulfill({ json: {
    full_name: 'chigwell/penelopa.ai', html_url: 'https://github.com/chigwell/penelopa.ai',
    stargazers_count: 123, generated_at: NOW.toISOString(), cache_ttl_seconds: 3600,
  } }));
  await page.route('https://api.penelopa.ai/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const entry = { path: url.pathname + url.search, method: request.method(), authorization: request.headers().authorization,
      body: request.postDataJSON() };
    requests.push(entry);
    if (options.respond) {
      const response = await options.respond(entry);
      if (response) return route.fulfill(response);
    }
    if (url.pathname.endsWith('/stats/summary')) return route.fulfill({ json: summary });
    if (url.pathname.endsWith('/daily-activity')) return route.fulfill({ json: activity });
    if (url.pathname === '/v1/hermes/recommendations') {
      const number = Number(url.searchParams.get('page')) || 1;
      return route.fulfill({ json: { items: [{ ...recommendation, id: `rec-${number}`, title: number === 1 ? recommendation.title : 'Second recommendation' }], page: number, page_size: 10, total: 11 } });
    }
    if (url.pathname.startsWith('/v1/hermes/recommendations/')) return route.fulfill({ json: recommendation });
    if (url.pathname === '/v1/user/telegram-notifications') {
      if (entry.method === 'PATCH') telegram = { ...telegram, ...entry.body };
      return route.fulfill({ json: telegram });
    }
    if (url.pathname.endsWith('/telegram-notifications/link')) {
      telegram = { ...telegram, enabled: true, status: 'PENDING', link_expires_at: new Date(NOW.getTime() + 60_000).toISOString() };
      return route.fulfill({ json: { deep_link_url: 'https://t.me/fixture_bot?start=synthetic', expires_at: telegram.link_expires_at, status: 'PENDING' } });
    }
    if (url.pathname.endsWith('/telegram-notifications/connection')) {
      telegram = { ...disabledTelegram };
      return route.fulfill({ status: 204 });
    }
    throw new Error(`Unexpected fixture request: ${entry.method} ${entry.path}`);
  });
  return { requests, setTelegram: value => { telegram = { ...telegram, ...value }; } };
}

export async function signIn(page, route = '/dashboard') {
  await page.goto(route);
  await page.getByLabel('Access token').fill('fixture-token');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
}

export async function expectToken(page, expected) {
  await expect.poll(() => page.evaluate(() => localStorage.getItem('penelopa-api-token'))).toBe(expected);
}
