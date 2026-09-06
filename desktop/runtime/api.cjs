'use strict';
const API_ORIGIN = 'https://api.penelopa.ai';
const WEB_ORIGIN = 'https://penelopa.ai';

function validateRequest(request) {
  if (!request || typeof request.path !== 'string' || request.path.length > 2048) throw new Error('Invalid API request.');
  const method = request.method || 'GET';
  const url = new URL(request.path, `${API_ORIGIN}/v1/`);
  if (!request.path.startsWith('/v1/') || url.origin !== API_ORIGIN || url.hash || /%2f|%5c|\\|\.\./i.test(request.path)) throw new Error('This API path is not available to the desktop client.');
  const routes = [
    ['GET', /^\/v1\/admin\/stats\/summary$/],
    ['GET', /^\/v1\/admin\/stats\/daily-activity$/],
    ['GET', /^\/v1\/hermes\/recommendations(?:\/[a-zA-Z0-9_-]+)?$/],
    ['GET', /^\/v1\/user\/telegram-notifications$/],
    ['PATCH', /^\/v1\/user\/telegram-notifications$/],
    ['POST', /^\/v1\/user\/telegram-notifications\/link$/],
    ['DELETE', /^\/v1\/user\/telegram-notifications\/connection$/],
  ];
  if (!routes.some(([verb, pattern]) => verb === method && pattern.test(url.pathname))) throw new Error('This API operation is not available to the desktop client.');
  const keys = url.pathname.endsWith('daily-activity') ? ['days'] : url.pathname === '/v1/hermes/recommendations' ? ['page', 'page_size'] : [];
  for (const [key, value] of url.searchParams) {
    if (!keys.includes(key) || !/^\d{1,6}$/.test(value) || Number(value) < 1 || (key === 'page_size' && Number(value) > 100)) throw new Error('Invalid API query.');
  }
  if (request.body !== undefined) {
    if (method !== 'PATCH' || JSON.stringify(request.body).length > 4096) throw new Error('Invalid API body.');
    const body = request.body;
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['enabled', 'language', 'notification_types'].includes(key))) throw new Error('Invalid notification settings.');
    if ('enabled' in body && typeof body.enabled !== 'boolean') throw new Error('Invalid notification settings.');
    if ('language' in body && !['en', 'ru'].includes(body.language)) throw new Error('Invalid notification language.');
    if ('notification_types' in body && (!Array.isArray(body.notification_types) || body.notification_types.some(type => !['recommendation_created', 'recommendation_approved'].includes(type)))) throw new Error('Invalid notification types.');
  }
  return { url: url.href, method, body: request.body };
}
function trustedFrame(frame, contents, local = false) {
  if (!frame || frame !== contents.mainFrame || frame.isDestroyed()) return false;
  try {
    const url = new URL(frame.url);
    return local ? url.protocol === 'penelopa:' && url.hostname === 'app' : url.origin === WEB_ORIGIN && /^\/dashboard(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}
function externalUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try { const url = new URL(value); return ['https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
module.exports = { API_ORIGIN, WEB_ORIGIN, validateRequest, trustedFrame, externalUrl };
