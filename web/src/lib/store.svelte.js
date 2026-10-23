// App state (Svelte 5 runes).
//
// Which screen shows (app.phase):
//   loading   first request in flight
//   offline   the wgmanager server itself did not answer (Retry)
//   setup     no admin password yet (setup code from the container log)
//   login     password set, not signed in (also after the session ends)
//   firstrun  signed in, but the server is not set up for this app yet:
//             its identity is unconfirmed (hostkey_unconfirmed) or it refuses
//             the app's key (key_refused). Only these two lead here.
//   ready     everything else. Host problems (unreachable, timeout, changed
//             identity, protocol mismatch, ...) show as a banner on top of the
//             last known data; polling keeps checking and recovers on its own.
import { api, onUnauthenticated } from './api.js';

export const PROTOCOL = 1;
const REFRESH_MS = 15000;
const SETUP_CODES = ['hostkey_unconfirmed', 'key_refused'];

export const app = $state({
  phase: 'loading',
  view: 'clients', // clients | host | settings
  list: null, // helper `list` data (may be stale while hostError is set)
  version: null, // helper `version` data
  settings: null,
  listError: null, // error from the last list call
  hostError: null, // problem reaching or trusting the host; blocks changes
  hostKey: null, // {pinned, offered} while the server identity needs confirming
  lastRefresh: 0,
  now: Date.now() / 1000,
  selected: null, // client name in the detail panel
  adding: false,
  pending: {}, // name -> action in flight
  failures: [], // unacknowledged failure warnings (from the server, plus local ones)
  notice: null, // short-lived message
  signedOutNotice: null, // why the login screen is showing, if not obvious
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

// Bumped whenever the signed-in session ends, so slow requests that started
// before a sign-out cannot pull the app back into a signed-in screen.
let epoch = 0;

/** Forget everything from the signed-in session (keeps theme and layout). */
function resetSessionState() {
  epoch++;
  stopPolling();
  Object.assign(app, {
    view: 'clients', list: null, version: null, settings: null, listError: null, hostError: null,
    hostKey: null, lastRefresh: 0, selected: null, adding: false, pending: {}, failures: [],
  });
}

// Any call that finds the session gone lands here (the 6-hour idle limit, a
// password change in another browser, a container restart, a reset).
onUnauthenticated((code) => {
  if (app.phase === 'login' || app.phase === 'setup') return;
  resetSessionState();
  app.signedOutNotice = 'You were signed out. This happens after 6 hours without use, after a password change, or when the app restarts.';
  app.phase = code === 'no_password' ? 'setup' : 'login';
});

export async function boot() {
  app.phase = 'loading';
  const s = await api.session();
  if (!s.ok) {
    app.phase = 'offline';
    return;
  }
  if (s.data.passwordSet === false) app.phase = 'setup';
  else if (!s.data.authenticated) app.phase = 'login';
  else await connect();
}

/** Check the host: settings, version (protocol), then the list and failures. */
export async function connect({ background = false } = {}) {
  const mine = epoch;
  const st = await api.settings({ background });
  if (st.ok) app.settings = st.data;
  const v = await api.version({ background });
  if (mine !== epoch) return v; // signed out meanwhile
  if (!v.ok) {
    const code = v.error.code;
    app.hostError = v.error;
    if (code === 'hostkey_unconfirmed') {
      const hk = await api.hostKey();
      app.hostKey = hk.ok ? hk.data : null;
    }
    app.phase = SETUP_CODES.includes(code) ? 'firstrun' : 'ready';
    if (app.phase === 'ready') {
      if (code === 'hostkey_changed') app.view = 'host';
      await loadFailures(background);
      startPolling();
    }
    return v;
  }
  app.hostKey = null;
  app.version = v.data;
  if (v.data.protocol !== PROTOCOL) {
    app.hostError = { code: 'protocol_mismatch', message: `helper protocol ${v.data.protocol}, app expects ${PROTOCOL}` };
    app.phase = 'ready';
    app.view = 'host';
    startPolling();
    return v;
  }
  app.hostError = null;
  app.phase = 'ready';
  await refresh({ background });
  startPolling();
  return v;
}

let listSeq = 0;
export async function refresh({ background = false } = {}) {
  if (app.hostError) return;
  const seq = ++listSeq;
  const mine = epoch;
  const [r] = await Promise.all([api.list({ background }), loadFailures(background)]);
  if (seq !== listSeq || mine !== epoch) return; // a newer refresh answered, or signed out
  app.now = Date.now() / 1000;
  if (!r.ok) {
    app.listError = r.error;
    // Losing the host mid-session: treat like a host problem so changes pause
    // and the poller switches to reconnecting.
    if (['unreachable', 'timeout', 'hostkey_changed', 'protocol_mismatch', 'bad_response', 'server_error'].includes(r.error.code)) {
      app.hostError = r.error;
    } else if (SETUP_CODES.includes(r.error.code)) {
      await connect({ background: true });
    }
    return;
  }
  app.listError = null;
  app.list = r.data;
  app.lastRefresh = Date.now();
}

async function loadFailures(background) {
  const f = await api.failures({ background });
  if (f.ok) {
    const local = app.failures.filter((x) => x.local);
    app.failures = [...f.data.failures, ...local];
  }
}

// --- polling: one request at a time, never overlapping --------------------------

let timer = null;
let clock = null;
let busy = false;
async function tick() {
  if (busy || document.visibilityState !== 'visible' || app.phase !== 'ready') return;
  busy = true;
  try {
    // While the host has a problem, keep trying to reconnect instead.
    if (app.hostError) await connect({ background: true });
    else await refresh({ background: true });
  } finally {
    busy = false;
  }
}
function startPolling() {
  if (timer) return;
  timer = setInterval(tick, REFRESH_MS);
  clock = setInterval(() => (app.now = Date.now() / 1000), 1000);
}
function stopPolling() {
  clearInterval(timer);
  clearInterval(clock);
  timer = clock = null;
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
}

// --- sign-in -----------------------------------------------------------------------

export async function login(password) {
  const r = await api.login(password);
  if (r.ok) {
    app.signedOutNotice = null;
    await connect();
  } else if (r.error.code === 'no_password') {
    app.phase = 'setup'; // reset on the server since this page loaded
  }
  return r;
}

export async function setup(code, password) {
  const r = await api.setup(code, password);
  if (r.ok) {
    app.signedOutNotice = null;
    await connect();
  } else if (r.error.code === 'already_set') {
    app.phase = 'login';
    app.signedOutNotice = 'A password was already set (perhaps in another browser). Sign in with it.';
  }
  return r;
}

export async function logout() {
  await api.logout();
  resetSessionState();
  app.signedOutNotice = null;
  app.phase = 'login';
}

// --- changes ---------------------------------------------------------------------------

/** Run a change. Never retried; on any doubt the list is refreshed instead. */
export async function mutate(action, name) {
  app.pending[name] = action;
  let r;
  try {
    r = await (action === 'add' ? api.add(name) : api[action](name));
  } finally {
    delete app.pending[name];
  }
  if (!r.ok && r.error.code === 'network') {
    // The wgmanager server went away mid-change (restart, network): it could
    // not record a warning, so keep one here.
    app.failures = [
      ...app.failures,
      { id: `local-${Date.now()}`, local: true, action, client: name, at: Date.now(), error: { code: 'network' } },
    ];
  }
  await refresh();
  return r;
}

export async function acknowledge(f) {
  app.failures = app.failures.filter((x) => x.id !== f.id);
  if (!f.local) await api.ackFailure(f.id);
}

/** A client's card is flagged while a warning about it is open and the list
 *  still shows it inconsistent (HELPER-SPEC 8.1). */
export function isFlagged(name) {
  const open = app.failures.some((f) => f.client === name && f.error?.partial !== false);
  if (!open) return false;
  const c = app.list?.clients.find((x) => x.name === name);
  return !c || c.enabled === null || c.enabled !== c.live;
}

export function notify(text) {
  const id = Date.now();
  app.notice = { text, id };
  setTimeout(() => {
    if (app.notice?.id === id) app.notice = null;
  }, 6000);
}
