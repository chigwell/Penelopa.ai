'use strict';
const bridge = window.penelopa;
let current, busy = false, renderedKey = '';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const date = value => value ? new Date(value).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) : 'Waiting for activity';
const button = (text, action, style = '') => `<button class="button ${style}" data-action="${action}" ${busy ? 'disabled' : ''}>${text}</button>`;
function message(text) { const element = document.getElementById('message'); element.textContent = text; element.hidden = false; setTimeout(() => { element.hidden = true; }, 6500); }
function connection(state) {
  const c = state.connection;
  const agents = (c.agents || []).map(agent => `<section class="card"><div class="card-row"><div><h2>${escape(agent.name)}</h2><p>${agent.lastEventAt ? `Last event · ${escape(date(agent.lastEventAt))}` : 'Waiting for the first event from your coding agent.'}</p></div><span class="pill ${agent.state === 'connected' ? '' : 'warning'}">${agent.state === 'connected' ? 'Connected' : agent.configured ? 'Waiting for activity' : 'Needs repair'}</span></div>${agent.configured && !agent.lastEventAt && agent.name === 'Codex' ? '<div class="notice">Review and trust Stop and SessionEnd in Codex → Settings → Hooks. In the CLI, run <code>/hooks</code>. Then continue a coding session. Installing a hook does not automatically approve it.</div>' : ''}${agent.error ? `<div class="notice">${escape(agent.error)}</div>` : ''}</section>`).join('');
  return `<div class="intro"><span class="eyebrow">Your computer</span><h1>A clear connection.</h1><p>Know what is connected, what is waiting, and when your work last reached Penelopa.</p></div>
  <section class="card"><div class="card-row"><div><h2>Your account</h2><p>${state.auth?.authenticated ? 'Connected using the account installed with your hooks.' : 'Reconnect the account already installed on this computer.'}</p></div><span class="pill ${state.auth?.authenticated ? '' : 'warning'}">${state.auth?.authenticated ? 'Signed in' : 'Not connected'}</span></div>${state.auth?.error ? `<div class="notice">${escape(state.auth.error)}</div>` : ''}<div class="actions">${state.auth?.authenticated ? button('Sign out of client', 'sign-out') : button('Reconnect installed account', 'connect', 'primary')}</div></section>
  ${agents || '<section class="card"><h2>No hooks found</h2><p>Run the Penelopa installer to connect Codex or Claude Code.</p></section>'}
  <div class="metrics"><div class="metric"><span>Queued events</span><strong>${c.pendingEvents || 0}</strong></div><div class="metric"><span>Queued segments</span><strong>${c.queuedSegments || 0}</strong></div><div class="metric"><span>Waiting to upload</span><strong>${((c.queuedBytes || 0) / 1048576).toFixed(1)} MB</strong></div></div>
  <section class="card"><h2>Delivery</h2><div class="detail"><span>Last confirmed upload</span><strong>${escape(date(c.lastUploadAt))}</strong></div><div class="detail"><span>Installation self-test</span><strong>${c.selfTest?.passed ? 'Passed · local only' : 'Not completed'}</strong></div><div class="detail"><span>Collection</span><strong>${state.preferences.paused ? 'Paused' : 'Active'}</strong></div>${c.quarantinedSegments ? `<div class="notice">${c.quarantinedSegments} segment(s) were rejected by the server and preserved locally. Export diagnostics for support.</div>` : ''}${(c.errors || []).map(item => `<div class="notice">${escape(item.error)}</div>`).join('')}<div class="actions">${button('Retry delivery', 'retry', 'primary')}${button('Repair hooks', 'repair')}${button('Export diagnostics', 'export-diagnostics')}</div></section>`;
}
function toggle(name, title, description, checked) { return `<label class="setting"><div><strong>${title}</strong><p>${description}</p></div><input type="checkbox" data-setting="${name}" aria-label="${title}" ${checked ? 'checked' : ''} ${busy ? 'disabled' : ''}></label>`; }
function settingsPage(state) {
  const update = state.update || {};
  const updating = ['downloading', 'building', 'ready-to-restart'].includes(update.phase);
  return `<div class="intro"><span class="eyebrow">Make it yours</span><h1>Quietly useful.</h1><p>Choose when Penelopa works in the background and when it gets your attention.</p></div>
  <section class="card"><h2>Background activity</h2>${toggle('paused', 'Pause collection', 'Pause new capture and delivery. Already queued data stays on this computer.', state.preferences.paused)}${toggle('autostart', 'Open at login', 'Start in the background when you sign in to this computer.', state.preferences.autostart)}<p>Closing the window keeps Penelopa in the tray. Quit exits the client; installed hooks continue working independently.</p></section>
  <section class="card"><h2>System notifications</h2>${toggle('notifications', 'New recommendations', 'Notify me when a new recommendation is ready. No alerts for connection errors.', state.preferences.notifications)}<div class="actions">${button('Send a test notification', 'test-notification')}</div><p>Telegram preferences are separate. Manage them in Telegram alerts.</p></section>
  <section class="card"><div class="card-row"><div><h2>App updates</h2><p>Version ${escape(state.version)} · built on this computer</p></div><span class="pill">${updating ? escape(update.phase.replaceAll('-', ' ')) : update.available ? 'Update available' : 'Installed'}</span></div><p>The dashboard updates automatically. App and runtime updates are installed when you choose Update & restart.</p>${update.error ? `<div class="notice">${escape(update.error)}</div>` : ''}<div class="actions">${button('Check for updates', 'check-update')}${update.available && !updating ? button('Update & restart', 'update', 'primary') : ''}</div></section>
  <section class="card"><h2>Local installation</h2><p>${state.connection.desktop?.signed === 'ad-hoc' ? 'This Mac app uses a local ad-hoc signature. The operating system may request approval after an update.' : 'This local build does not include a trusted publisher certificate. System security policies still apply.'}</p><div class="actions">${button('Uninstall Penelopa.ai', 'uninstall', 'danger')}${button('Quit app', 'quit')}</div></section>`;
}
function render(state) {
  const key = JSON.stringify({ ...state, busy });
  if (key === renderedKey) return;
  renderedKey = key;
  current = state;
  document.querySelectorAll('[data-page]').forEach(element => element.classList.toggle('active', element.dataset.page === state.page));
  document.getElementById('version').textContent = `Penelopa.ai · ${state.version}`;
  const connected = state.connection.agents?.some(agent => agent.state === 'connected');
  document.getElementById('connection-dot').classList.toggle('connected', connected && !state.preferences.paused);
  document.getElementById('connection-label').textContent = state.preferences.paused ? 'Collection paused' : connected ? 'Hooks connected' : 'Waiting for activity';
  document.getElementById('page-title').textContent = { dashboard: 'Overview', notifications: 'Telegram alerts', connection: 'Connection', settings: 'App settings', offline: 'Connection unavailable' }[state.page] || 'Your workspace';
  document.getElementById('content').innerHTML = state.page === 'connection' ? connection(state) : state.page === 'settings' ? settingsPage(state) : state.page === 'offline' ? '<section class="empty"><div class="symbol">↻</div><h1>A moment offline.</h1><p>Your queued activity is safe on this computer. We will continue delivery when the connection returns.</p><div class="actions"><button class="button primary" data-page="dashboard">Try again</button><button class="button" data-page="connection">View connection</button></div></section>' : '<div class="loading">Opening your workspace…</div>';
}
async function invoke(action, data) {
  if (busy) return;
  busy = true;
  if (current) render(current);
  try { const result = await bridge.invoke(action, data); if (result) render(result); if (['repair', 'retry', 'preferences'].includes(action)) message(action === 'repair' ? 'Hooks repaired. Review changed definitions in your coding agent.' : action === 'retry' ? 'Delivery retry started.' : 'Preferences saved.'); }
  catch (error) { message(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
  finally { busy = false; if (current) render(current); }
}
document.addEventListener('click', event => { const element = event.target.closest('button'); if (!element) return; if (element.dataset.page) void invoke('navigate', element.dataset.page); else if (element.dataset.action) void invoke(element.dataset.action); });
document.addEventListener('change', event => { const input = event.target; if (input.dataset.setting) void invoke('preferences', { [input.dataset.setting]: input.checked }); });
if (bridge) { bridge.onState(state => { const changedError = state.nativeError && state.nativeError !== current?.nativeError; render(state); if (changedError) message(state.nativeError); }); bridge.invoke('state').then(render).catch(() => message('Connection status could not be loaded.')); }
