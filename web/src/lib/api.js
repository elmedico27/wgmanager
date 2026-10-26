// HTTP API the UI talks to. The Express backend (next step) implements these
// routes; in mock mode (preview build, `npm run dev`) an in-browser stand-in
// answers instead.
//
// Every response is an envelope:
//   success  {ok: true, data}                      (helper `data` passed through)
//   failure  {ok: false, error: {code, message, ...}}
// Helper error codes pass through unchanged (invalid_request, not_found, exists,
// backend_failed + failed_checks/partial/backup, host_misconfigured, busy,
// internal). The backend adds app-level codes: unauthenticated, bad_login,
// unreachable (SSH refused or host down), timeout (60 s, outcome unknown),
// protocol_mismatch, bad_code, weak_password, already_set, no_password, rate_limited,
// hostkey_unconfirmed, hostkey_changed, hostkey_mismatch, key_refused (server
// reachable but it refused the app's key), bad_response, csrf, no_route,
// server_error (the app's own fault, not the helper's `internal`), and on the
// browser side network (the wgmanager server did not answer).
//
// The admin password hash lives in a file on the app's data volume (not in the
// environment), so it can be set on first run and changed in Settings.
//
//   GET    /api/session                 -> {authenticated, passwordSet, csrf}
//   POST   /api/setup    {code, password}  first password; code from the container log
//   POST   /api/session  {password}     -> {authenticated}
//   DELETE /api/session
//   POST   /api/password {current, password}  change; signs out other sessions
//   GET    /api/settings                -> {ssh:{host,port,user}, publicKey, allowFrom[]}
//   GET    /api/hostkey                 -> {pinned: {fingerprint,type,at}|null, offered: {fingerprint,type}}
//   POST   /api/hostkey  {fingerprint}  pin the key the server offers now (must match)
//   DELETE /api/hostkey                 forget the pin; the next connection asks again
//
// Server identity: the app pins the server's SSH host key (known_hosts in its
// volume). On first contact the admin compares the fingerprint with the one the
// installer prints. Until then every helper call fails with hostkey_unconfirmed;
// a different key later fails with hostkey_changed and nothing is sent.
//   GET    /api/version                 -> helper `version`
//   GET    /api/clients                 -> helper `list`
//   POST   /api/clients  {name}         -> helper `add`
//   DELETE /api/clients/:name           -> helper `remove`
//   POST   /api/clients/:name/enable    -> helper `enable`
//   POST   /api/clients/:name/disable   -> helper `disable`
//   GET    /api/clients/:name/config    -> helper `get-config` (no-store)
//   GET    /api/clients/:name/qrcode.svg  (no-store, generated on demand)
//   GET    /api/clients/:name/download    (attachment NAME.conf, no-store)
//   GET    /api/failures                -> {failures: [{id, action, client, at, error}]}
//          Unacknowledged warnings for changes that failed or may be incomplete
//          (helper exit 5, or no answer within 60 s). Kept in the data volume.
//   DELETE /api/failures/:id            acknowledge one
//
// Requests made by the automatic 15 s refresh carry X-WGM-Background: 1 and do
// not count as use for the 6-hour idle sign-out.

export const MOCK = __MOCK__;
// Public demo build: mock inside, Preview panel left out, state kept per tab.
export const DEMO = __DEMO__;

let mock = null;
async function getMock() {
  // The literal check lets the production build drop the mock entirely.
  if (__MOCK__ && !mock) mock = await import('../mock/backend.js');
  return mock;
}

// CSRF token for this session; the server hands it out with the session and
// requires it on every POST and DELETE once signed in.
let csrf = null;

// Called when any request finds the session gone, so the app can go back to
// the sign-in screen from wherever it is.
let unauthenticatedHandler = () => {};
export function onUnauthenticated(fn) {
  unauthenticatedHandler = fn;
}

const network = () => ({ ok: false, error: { code: 'network', message: 'the wgmanager server did not answer' } });

async function call(method, path, body, { background = false } = {}) {
  const r = await send(method, path, body, background);
  if (r?.ok && r.data && 'csrf' in r.data) csrf = r.data.csrf;
  if (r && !r.ok && r.error?.code === 'unauthenticated') {
    csrf = null;
    unauthenticatedHandler(r.error.code);
  }
  return r;
}

function headers(method, body, background) {
  return {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}),
    // Automatic refreshes say so, so they do not count as use for the idle sign-out.
    ...(background ? { 'X-WGM-Background': '1' } : {}),
  };
}

async function send(method, path, body, background) {
  if (MOCK) {
    const m = await getMock();
    await new Promise((r) => setTimeout(r, 120)); // a little network latency
    return m.handle(method, path, body);
  }
  try {
    const res = await fetch(path, {
      method,
      headers: headers(method, body, background),
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return network();
  }
}

/** GET a file (QR SVG, config download). Resolves to {ok, blob} or the JSON error. */
async function fetchFile(path) {
  try {
    const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) return { ok: true, blob: await res.blob() };
    const body = await res.json().catch(() => network());
    if (body?.error?.code === 'unauthenticated') unauthenticatedHandler('unauthenticated');
    return body;
  } catch {
    return network();
  }
}

const enc = encodeURIComponent;

export const api = {
  session: () => call('GET', '/api/session'),
  login: (password) => call('POST', '/api/session', { password }),
  setup: (code, password) => call('POST', '/api/setup', { code, password }),
  changePassword: (current, password) => call('POST', '/api/password', { current, password }),
  logout: async () => {
    const r = await call('DELETE', '/api/session');
    csrf = null;
    return r;
  },
  settings: (o) => call('GET', '/api/settings', undefined, o),
  hostKey: () => call('GET', '/api/hostkey'),
  pinHostKey: (fingerprint) => call('POST', '/api/hostkey', { fingerprint }),
  forgetHostKey: () => call('DELETE', '/api/hostkey'),
  version: (o) => call('GET', '/api/version', undefined, o),
  list: (o) => call('GET', '/api/clients', undefined, o),
  failures: (o) => call('GET', '/api/failures', undefined, o),
  ackFailure: (id) => call('DELETE', `/api/failures/${enc(id)}`),
  add: (name) => call('POST', '/api/clients', { name }),
  remove: (name) => call('DELETE', `/api/clients/${enc(name)}`),
  enable: (name) => call('POST', `/api/clients/${enc(name)}/enable`),
  disable: (name) => call('POST', `/api/clients/${enc(name)}/disable`),
  config: (name) => call('GET', `/api/clients/${enc(name)}/config`),
  /** Object URL of the QR code SVG, or {ok:false, error}. Caller revokes it. */
  async qr(name) {
    if (MOCK) return (await getMock()).qr(name);
    const r = await fetchFile(`/api/clients/${enc(name)}/qrcode.svg`);
    return r.ok ? { ok: true, url: URL.createObjectURL(r.blob) } : r;
  },
  /** The config file as a Blob for saving, or {ok:false, error}. */
  async download(name) {
    if (MOCK) return (await getMock()).download(name);
    return fetchFile(`/api/clients/${enc(name)}/download`);
  },
};

export { getMock };
