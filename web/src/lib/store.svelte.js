// App state (Svelte 5 runes).
import { api } from './api.js';

export const PROTOCOL = 1;
const REFRESH_MS = 15000;

export const app = $state({
  phase: 'loading', // loading | setup | login | firstrun | ready
  view: 'clients', // clients | host | settings
  list: null, // helper `list` data
  version: null, // helper `version` data
  settings: null,
  listError: null, // error from the last list call
  hostError: null, // unreachable / protocol mismatch / misconfigured / host key
  hostKey: null, // {pinned, offered} while the server identity needs confirming
  lastRefresh: 0,
  now: Date.now() / 1000,
  selected: null, // client name in the detail panel
  adding: false,
  pending: {}, // name -> action in flight
  failures: [], // persistent exit-5 / timeout warnings
  flagged: {}, // name -> true until a fresh list is consistent
  notice: null, // short-lived message for non-critical errors
  layout: 'cards', // cards | list
  theme: 'system', // system | light | dark
});

try {
  const saved = JSON.parse(localStorage.getItem('wgm-ui') || '{}');
  if (saved.layout === 'list' || saved.layout === 'cards') app.layout = saved.layout;
  if (['system', 'light', 'dark'].includes(saved.theme)) app.theme = saved.theme;
} catch {}

export function savePrefs() {
  try {
    localStorage.setItem('wgm-ui', JSON.stringify({ layout: app.layout, theme: app.theme }));
  } catch {}
}

export async function boot() {
  const s = await api.session();
  if (s.ok && s.data.passwordSet === false) {
    app.phase = 'setup';
    return;
  }
  if (!s.ok || !s.data.authenticated) {
    app.phase = 'login';
    return;
  }
  await connect();
}

/** Check the host: settings, version (protocol), first list. */
export async function connect() {
  const st = await api.settings();
  if (st.ok) app.settings = st.data;
  const v = await api.version();
  if (!v.ok) {
    app.hostError = v.error;
    const code = v.error.code;
    if (code === 'hostkey_unconfirmed') {
      const hk = await api.hostKey();
      app.hostKey = hk.ok ? hk.data : null;
    }
    app.phase = code === 'unreachable' || code === 'hostkey_unconfirmed' ? 'firstrun' : 'ready';
    if (code === 'hostkey_changed') app.view = 'host';
    return v;
  }
  app.hostKey = null;
  app.version = v.data;
  if (v.data.protocol !== PROTOCOL) {
    app.hostError = { code: 'protocol_mismatch', message: `helper protocol ${v.data.protocol}, app expects ${PROTOCOL}` };
    app.phase = 'ready';
    app.view = 'host';
    return v;
  }
  app.hostError = null;
  app.phase = 'ready';
  await refresh();
  startPolling();
  return v;
}

export async function refresh() {
  if (app.hostError?.code === 'protocol_mismatch') return;
  const r = await api.list();
  app.now = Date.now() / 1000;
  if (!r.ok) {
    app.listError = r.error;
    if (r.error.code === 'unauthenticated') app.phase = 'login';
    return;
  }
  app.listError = null;
  app.list = r.data;
  app.lastRefresh = Date.now();
  // clear flags once the client is consistent again (enabled and live agree)
  for (const name of Object.keys(app.flagged)) {
    const c = r.data.clients.find((x) => x.name === name);
    const settled = c ? c.enabled !== null && c.enabled === c.live : true;
    if (settled) delete app.flagged[name];
  }
}

let timer = null;
let clock = null;
function startPolling() {
  stopPolling();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, REFRESH_MS);
  clock = setInterval(() => (app.now = Date.now() / 1000), 1000);
}
function stopPolling() {
  clearInterval(timer);
  clearInterval(clock);
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.phase === 'ready') refresh();
  });
}

export async function login(password) {
  const r = await api.login(password);
  if (r.ok) await connect();
  return r;
}

export async function setup(code, password) {
  const r = await api.setup(code, password);
  if (r.ok) await connect();
  return r;
}

export async function logout() {
  await api.logout();
  stopPolling();
  app.phase = 'login';
  app.list = null;
  app.selected = null;
}

/** Run a mutation. Never retried; on any doubt the list is refreshed instead. */
export async function mutate(action, name) {
  app.pending[name] = action;
  let r;
  try {
    r = await (action === 'add' ? api.add(name) : api[action](name));
  } finally {
    delete app.pending[name];
  }
  if (!r.ok) {
    const e = r.error;
    if (e.code === 'backend_failed' || e.code === 'timeout') {
      app.failures.push({ id: crypto.randomUUID(), action, name, error: e, at: Date.now() });
      if (e.partial !== false) app.flagged[name] = true;
    }
  }
  await refresh();
  return r;
}

export function acknowledge(id) {
  app.failures = app.failures.filter((f) => f.id !== id);
}

export function notify(text) {
  app.notice = { text, id: Date.now() };
  setTimeout(() => {
    if (app.notice && Date.now() - app.notice.id >= 5900) app.notice = null;
  }, 6000);
}
