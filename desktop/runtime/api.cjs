'use strict';
const API_ORIGIN = 'https://api.penelopa.ai';
const WEB_ORIGIN = 'https://penelopa.ai';
const { validateTranscriptRequest } = require('./transcript-api.cjs');

function validateRequest(request) {
  if (!request || typeof request.path !== 'string' || request.path.length > 8192) throw new Error('Invalid API request.');
  const method = request.method || 'GET';
  const url = new URL(request.path, `${API_ORIGIN}/v1/`);
  const rawPath = request.path.split('?')[0];
  if (!/^\/v[12]\//.test(request.path) || url.origin !== API_ORIGIN || url.hash || /%2f|%5c|\\|\.\./i.test(rawPath)) throw new Error('This API path is not available to the desktop client.');
  if (url.pathname.startsWith('/v2/')) {
    validateTranscriptRequest(url, method, request.body);
    return { url: url.href, method, body: request.body };
  }
  const routes = [
    ['GET', /^\/v1\/admin\/stats\/summary$/],
    ['GET', /^\/v1\/admin\/stats\/daily-activity$/],
    ['GET', /^\/v1\/hermes\/recommendations(?:\/[a-zA-Z0-9_-]+)?$/],
    ['GET', /^\/v1\/user\/telegram-notifications$/],
    ['PATCH', /^\/v1\/user\/telegram-notifications$/],
    ['POST', /^\/v1\/user\/telegram-notifications\/link$/],
    ['DELETE', /^\/v1\/user\/telegram-notifications\/connection$/],
    ['GET', /^\/v1\/user\/recommendation-webhook$/],
    ['PATCH', /^\/v1\/user\/recommendation-webhook$/],
    ['DELETE', /^\/v1\/user\/recommendation-webhook$/],
  ];
  if (!routes.some(([verb, pattern]) => verb === method && pattern.test(url.pathname))) throw new Error('This API operation is not available to the desktop client.');
  const keys = url.pathname.endsWith('daily-activity') ? ['days'] : url.pathname === '/v1/hermes/recommendations' ? ['page', 'page_size'] : [];
  for (const [key, value] of url.searchParams) {
    if (!keys.includes(key) || !/^\d{1,6}$/.test(value) || Number(value) < 1 || (key === 'page_size' && Number(value) > 100)) throw new Error('Invalid API query.');
  }
  if (request.body !== undefined) {
    if (method !== 'PATCH' || JSON.stringify(request.body).length > 8192) throw new Error('Invalid API body.');
    if (url.pathname === '/v1/user/telegram-notifications') validateTelegramSettingsBody(request.body);
    else if (url.pathname === '/v1/user/recommendation-webhook') validateWebhookSettingsBody(request.body);
    else throw new Error('Invalid API body.');
  }
  return { url: url.href, method, body: request.body };
}
function validateObject(value, keys, message) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !keys.includes(key))) throw new Error(message);
}
function validateNotificationTypes(value, allowed) {
  return Array.isArray(value) && value.length > 0 && value.length <= 10 && value.every(type => allowed.includes(type));
}
function validateTelegramSettingsBody(body) {
  validateObject(body, ['enabled', 'language', 'notification_types'], 'Invalid notification settings.');
  if ('enabled' in body && typeof body.enabled !== 'boolean') throw new Error('Invalid notification settings.');
  if ('language' in body && !['en', 'ru'].includes(body.language)) throw new Error('Invalid notification language.');
  if ('notification_types' in body && !validateNotificationTypes(body.notification_types, ['recommendation_created', 'recommendation_approved'])) throw new Error('Invalid notification types.');
}
function validateWebhookSettingsBody(body) {
  validateObject(body, ['enabled', 'url', 'secret', 'clear_secret', 'notification_types'], 'Invalid webhook settings.');
  if ('enabled' in body && typeof body.enabled !== 'boolean') throw new Error('Invalid webhook settings.');
  if ('clear_secret' in body && typeof body.clear_secret !== 'boolean') throw new Error('Invalid webhook settings.');
  if ('secret' in body && body.secret !== null && (typeof body.secret !== 'string' || body.secret.length > 2048)) throw new Error('Invalid webhook secret.');
  if ('notification_types' in body && !validateNotificationTypes(body.notification_types, ['recommendation_approved'])) throw new Error('Invalid webhook notification types.');
  if ('url' in body && body.url !== null) {
    if (typeof body.url !== 'string' || body.url.length > 2048) throw new Error('Invalid webhook URL.');
    let parsed;
    try { parsed = new URL(body.url); } catch { throw new Error('Invalid webhook URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.hash) throw new Error('Invalid webhook URL.');
  }
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
