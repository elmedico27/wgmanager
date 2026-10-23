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
// protocol_mismatch, bad_code, weak_password, already_set, rate_limited,
// hostkey_unconfirmed, hostkey_changed, hostkey_mismatch.
//
// The admin password hash lives in a file on the app's data volume (not in the
// environment), so it can be set on first run and changed in Settings.
//
//   GET    /api/session                 -> {authenticated, passwordSet}
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

export const MOCK = __MOCK__;

let mock = null;
async function getMock() {
  // The literal check lets the production build drop the mock entirely.
  if (__MOCK__ && !mock) mock = await import('../mock/backend.js');
  return mock;
}

async function call(method, path, body) {
  if (MOCK) {
    const m = await getMock();
    await new Promise((r) => setTimeout(r, 120)); // a little network latency
    return m.handle(method, path, body);
  }
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { ok: false, error: { code: 'network', message: 'the wgmanager server did not answer' } };
  }
}

const enc = encodeURIComponent;

export const api = {
  session: () => call('GET', '/api/session'),
  login: (password) => call('POST', '/api/session', { password }),
  setup: (code, password) => call('POST', '/api/setup', { code, password }),
  changePassword: (current, password) => call('POST', '/api/password', { current, password }),
  logout: () => call('DELETE', '/api/session'),
  settings: () => call('GET', '/api/settings'),
  hostKey: () => call('GET', '/api/hostkey'),
  pinHostKey: (fingerprint) => call('POST', '/api/hostkey', { fingerprint }),
  forgetHostKey: () => call('DELETE', '/api/hostkey'),
  version: () => call('GET', '/api/version'),
  list: () => call('GET', '/api/clients'),
  add: (name) => call('POST', '/api/clients', { name }),
  remove: (name) => call('DELETE', `/api/clients/${enc(name)}`),
  enable: (name) => call('POST', `/api/clients/${enc(name)}/enable`),
  disable: (name) => call('POST', `/api/clients/${enc(name)}/disable`),
  config: (name) => call('GET', `/api/clients/${enc(name)}/config`),
  async qrUrl(name) {
    if (MOCK) return (await getMock()).qrUrl(name);
    return `/api/clients/${enc(name)}/qrcode.svg`;
  },
  downloadUrl: (name) => `/api/clients/${enc(name)}/download`,
};

export { getMock };
