// Mock of host/wgmanager-helper for UI development and the design preview.
//
// It answers the same request strings with the same JSON documents and exit
// codes as the real helper (protocol 1). Shapes were copied from the helper
// source (0.1.4: action_version, action_list, client_entry, ERRORS,
// backend_failure, the add/remove/toggle check functions) and
// docs/HELPER-SPEC.md sections 4-8. Client config text follows PiVPN v4.6.2
// scripts/wireguard/makeCONF.sh. All data is made up.
//
// Never used in production builds: src/lib/api.js imports it only in mock mode.

export const PROTOCOL = 1;
const HELPER_VERSION = '0.1.4';
const IFACE = 'wg0';
const SUBNET = { base: [10, 0, 0, 0], prefix: 24, text: '10.0.0.0/24' };
const ENDPOINT_HOST = 'vpn.example.com';
const LISTEN_PORT = 51820;

// helper ERRORS table (verified in source)
const ERRORS = {
  invalid_request: [2, 'invalid request'],
  not_found: [3, 'client not found'],
  exists: [4, 'client already exists'],
  backend_failed: [5, 'change may be incomplete'],
  host_misconfigured: [6, 'host is misconfigured'],
  busy: [7, 'another change is in progress'],
  internal: [10, 'internal error'],
};

// Request grammar and name rules (spec 4, 4.1)
const REQUEST_RE = /^[a-z][a-z-]{0,15}( [A-Za-z0-9_][A-Za-z0-9_-]{0,14})?$/;
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,14}$/;
const ACTIONS = { version: 0, list: 0, add: 1, remove: 1, enable: 1, disable: 1, 'get-config': 1 };

export function isSafeName(name) {
  return NAME_RE.test(name) && !/^[0-9]+$/.test(name) && name !== 'server';
}

// --- fake key material -------------------------------------------------------

function fakeKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s); // 44 chars ending in '=' like a real WireGuard key
}

let SERVER_PUBLIC_KEY = fakeKey();

// --- scenarios -----------------------------------------------------------------

export const scenarios = {
  interfaceDown: false,     // wg0 not running: interface.up false, all stats null
  unmanageable: false,      // adds a client with a dotted name and one outside the subnet
  inconsistent: false,      // adds a client with no marker block (enabled: null)
  bigCounters: false,       // one client past 1 TiB
  failNextMutation: false,  // next add/remove/enable/disable returns exit 5, partial
  busyNext: false,          // next mutation returns exit 7
  hostMisconfigured: false, // every call except version returns exit 6
  protocolMismatch: false,  // version reports protocol 2
  subnetFull: false,        // add fails as PiVPN would when no address is free (unverified: not run)
  mutationDelayMs: 1800,    // real worst case is about 45 s
};

// --- state -----------------------------------------------------------------------

const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

function ip(n) {
  return `${SUBNET.base[0]}.${SUBNET.base[1]}.${SUBNET.base[2]}.${n}`;
}

function mk(name, host, opts = {}) {
  const t = now();
  return {
    name,
    public_key: fakeKey(),
    private_key: fakeKey(),
    psk: fakeKey(),
    address: opts.address || ip(host),
    created_at: t - (opts.ageDays ?? 30) * DAY,
    enabled: opts.enabled ?? true,
    marker: opts.marker ?? true, // false = no marker block
    // live session simulation
    handshakeAgo: opts.handshakeAgo, // seconds, undefined = no handshake since start
    endpoint: opts.endpoint ?? null,
    rx: opts.rx ?? 0,
    tx: opts.tx ?? 0,
    rate: opts.rate ?? 0, // bytes/s while connected
  };
}

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

let clients = [
  mk('Alice_Phone', 2, { ageDays: 412, handshakeAgo: 41, endpoint: '198.51.100.23:49152', rx: 1.8 * GiB, tx: 23.4 * GiB, rate: 220000 }),
  mk('Alice_Laptop', 3, { ageDays: 410, handshakeAgo: 3 * 3600 + 120, endpoint: '198.51.100.23:51034', rx: 6.2 * GiB, tx: 48.9 * GiB }),
  mk('Bob_Phone', 4, { ageDays: 220, handshakeAgo: 97, endpoint: '203.0.113.77:38211', rx: 412 * MiB, tx: 3.1 * GiB, rate: 40000 }),
  mk('Bob_Tablet', 5, { ageDays: 219, handshakeAgo: 5 * DAY, endpoint: '203.0.113.77:40112', rx: 88 * MiB, tx: 1.2 * GiB }),
  mk('Carol_Laptop', 6, { ageDays: 96, handshakeAgo: 12, endpoint: '192.0.2.140:51820', rx: 2.4 * GiB, tx: 11.7 * GiB, rate: 900000 }),
  mk('Dave_Router', 7, { ageDays: 380, handshakeAgo: 64, endpoint: '192.0.2.9:51820', rx: 310 * GiB, tx: 122 * GiB, rate: 1500000 }),
  mk('Erin_Phone', 8, { ageDays: 4 }),
  mk('Frank_Desktop', 9, { ageDays: 150, enabled: false }),
];

const extras = {
  unmanageable: [
    mk('old.phone', 10, { ageDays: 700, handshakeAgo: 40 * DAY }),
    mk('Guest_Laptop', 0, { address: '10.0.1.7', ageDays: 300 }),
  ],
  inconsistent: [mk('Gina_Phone', 11, { ageDays: 60, marker: false })],
  bigCounters: [mk('Hank_Server', 12, { ageDays: 900, handshakeAgo: 8, endpoint: '198.51.100.200:51820', rx: 1.37 * 1024 ** 4, tx: 2.91 * 1024 ** 4, rate: 4000000 })],
};

let lastTick = Date.now();
function tick() {
  // advance the fake clock for handshakes and counters
  const dt = (Date.now() - lastTick) / 1000;
  lastTick = Date.now();
  for (const c of allClients()) {
    if (c.handshakeAgo === undefined) continue;
    c.handshakeAgo += dt;
    if (c.rate && c.enabled) {
      // active peers re-handshake about every 2 minutes (REKEY_AFTER_TIME = 120)
      if (c.handshakeAgo > 120) c.handshakeAgo = 0;
      c.tx += c.rate * dt * (0.6 + Math.random() * 0.8);
      c.rx += c.rate * dt * 0.18 * (0.6 + Math.random() * 0.8);
    }
  }
}

// Demo build only (backend.js keeps these in sessionStorage): the visitor's
// clients and the server key survive a refresh of the same tab.
export function snapshot() {
  tick();
  return { clients, serverKey: SERVER_PUBLIC_KEY, at: Date.now() };
}

export function restore(s) {
  if (!Array.isArray(s?.clients) || typeof s.serverKey !== 'string') return;
  clients = s.clients;
  SERVER_PUBLIC_KEY = s.serverKey;
  if (typeof s.at === 'number') lastTick = s.at; // the next tick covers the time away
}

function allClients() {
  const out = [...clients];
  for (const key of ['unmanageable', 'inconsistent', 'bigCounters']) {
    if (scenarios[key]) out.push(...extras[key]);
  }
  return out;
}

function inSubnet(address) {
  const p = address.split('.').map(Number);
  return p[0] === SUBNET.base[0] && p[1] === SUBNET.base[1] && p[2] === SUBNET.base[2];
}

function isLive(c) {
  // live = peer present on the running interface; disabled peers are removed.
  // `stuck` simulates a reload that did not take effect (state left partial).
  const wanted = !scenarios.interfaceDown && c.marker && c.enabled;
  return c.stuck ? !wanted && !scenarios.interfaceDown && c.marker : wanted;
}

function entry(c) {
  const live = isLive(c);
  const connected = live && c.handshakeAgo !== undefined;
  return {
    name: c.name,
    public_key: c.public_key,
    address: c.address,
    created_at: c.created_at,
    enabled: c.marker ? c.enabled : null,
    live,
    manageable: isSafeName(c.name) && inSubnet(c.address),
    endpoint: connected ? c.endpoint : null,
    latest_handshake: connected ? Math.floor(now() - c.handshakeAgo) : null,
    transfer_rx: live ? (connected ? Math.floor(c.rx) : 0) : null,
    transfer_tx: live ? (connected ? Math.floor(c.tx) : 0) : null,
  };
}

function config(c) {
  // Layout of PiVPN v4.6.2 makeCONF.sh (IPv4 only, two DNS servers, no keepalive)
  return [
    '[Interface]',
    `PrivateKey = ${c.private_key}`,
    `Address = ${c.address}/${SUBNET.prefix}`,
    'DNS = 9.9.9.9, 149.112.112.112',
    '',
    '[Peer]',
    `PublicKey = ${SERVER_PUBLIC_KEY}`,
    `PresharedKey = ${c.psk}`,
    `Endpoint = ${ENDPOINT_HOST}:${LISTEN_PORT}`,
    'AllowedIPs = 0.0.0.0/0, ::0/0',
    '',
  ].join('\n');
}

function backupName(action, name) {
  // <UTC timestamp to the ms>-<action>-<name>, e.g. 20261020T211500123Z-add-Bob_Phone
  const d = new Date().toISOString(); // 2026-10-20T21:15:00.123Z
  const stamp = d.replace(/[-:]/g, '').replace('.', '');
  return `${stamp}-${action}-${name}`;
}

// --- responses -------------------------------------------------------------------

class HelperError extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.code = code;
    this.extra = extra;
  }
}

const backendFailure = (failed, partial, exitCode, backup) =>
  new HelperError('backend_failed', { partial, failed_checks: failed, backend_exit_code: exitCode, backup });

function find(name) {
  const c = allClients().find((x) => x.name === name);
  if (!c) throw new HelperError('not_found');
  if (!(isSafeName(c.name) && inSubnet(c.address))) throw new HelperError('invalid_request');
  return c;
}

function actionVersion() {
  return {
    helper_version: HELPER_VERSION,
    protocol: scenarios.protocolMismatch ? 2 : PROTOCOL,
    backend: 'pivpn',
    interface: IFACE,
    pivpn_scripts: {
      'makeCONF.sh': 'a3f1c9e0b7d24c5e8f61a9b2c4d7e0f13a5b8c9d2e4f6a7b8c9d0e1f2a3b4c5d',
      'removeCONF.sh': '5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
      'enableCONF.sh': '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
      'disableCONF.sh': 'c0ffee00deadbeef0123456789abcdef0123456789abcdefc0ffee00deadbeef',
    },
  };
}

function actionList() {
  tick();
  const warnings = [];
  const list = allClients();
  for (const c of list) {
    if (!inSubnet(c.address)) {
      warnings.push(`${c.name}: address ${c.address} is outside the VPN subnet ${SUBNET.text}; listed but not manageable`);
    }
  }
  for (const c of list) {
    if (!c.marker) warnings.push(`${c.name}: no marker block in server config`);
  }
  const up = !scenarios.interfaceDown;
  return {
    interface: { name: IFACE, up, public_key: up ? SERVER_PUBLIC_KEY : null, listen_port: up ? LISTEN_PORT : null },
    clients: list.map(entry),
    warnings,
  };
}

// Simulated partial failure: PiVPN changed the files but the reload did not
// take effect, so the live interface disagrees (failed check: live_peer).
function takeFailure() {
  if (!scenarios.failNextMutation) return false;
  scenarios.failNextMutation = false;
  return true;
}

function actionAdd(name) {
  if (allClients().some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new HelperError('exists');
  if (scenarios.subnetFull) {
    // PiVPN refuses before creating anything; the helper's checks then all fail.
    // Unverified: derived from the helper and makeCONF.sh source, not run.
    throw backendFailure(['client_record', 'client_config_file', 'server_config_block', 'live_peer'], true, 1, backupName('add', name));
  }
  const fail = takeFailure();
  const used = new Set(allClients().map((c) => c.address));
  let host = 2;
  while (used.has(ip(host))) host++;
  const c = mk(name, host, { ageDays: 0 });
  clients.push(c);
  if (fail) {
    c.stuck = true;
    throw backendFailure(['live_peer'], true, 0, backupName('add', name));
  }
  return { client: entry(c), config: config(c) };
}

function actionRemove(name) {
  const c = find(name);
  if (takeFailure()) {
    // files gone, peer still on the interface
    c.marker = true;
    c.stuck = true;
    c.enabled = false;
    throw backendFailure(['client_record', 'client_config_file', 'live_peer'], true, 0, backupName('remove', name));
  }
  clients = clients.filter((x) => x !== c);
  for (const k of Object.keys(extras)) extras[k] = extras[k].filter((x) => x !== c);
  return { name, removed: true };
}

function actionToggle(action, name) {
  const want = action === 'enable';
  const c = find(name);
  if (!c.marker) throw backendFailure(['server_config_block'], false, null, null);
  if (scenarios.interfaceDown) {
    // marker flips but the peer cannot be live
    c.enabled = want;
    throw backendFailure(want ? ['live_peer'] : [], true, 0, backupName(action, name));
  }
  if (c.enabled === want) return { client: entry(c), changed: false };
  c.enabled = want;
  if (takeFailure()) {
    c.stuck = true;
    throw backendFailure(['live_peer'], true, 0, backupName(action, name));
  }
  c.stuck = false;
  return { client: entry(c), changed: true };
}

function actionGetConfig(name) {
  const c = find(name);
  return { name, config: config(c) };
}

function errorResponse(err) {
  const [exit, message] = ERRORS[err.code];
  return { exit, body: { ok: false, protocol: PROTOCOL, error: { code: err.code, message, ...err.extra } } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run one request string. Resolves to { exit, body } exactly like the helper. */
export async function run(request) {
  try {
    if (typeof request !== 'string' || request.length > 64 || !REQUEST_RE.test(request)) {
      throw new HelperError('invalid_request');
    }
    const [action, name] = request.split(' ');
    if (!(action in ACTIONS) || ACTIONS[action] !== (name === undefined ? 0 : 1)) {
      throw new HelperError('invalid_request');
    }
    if (name !== undefined && !isSafeName(name)) throw new HelperError('invalid_request');

    let data;
    if (action === 'version') data = actionVersion();
    else {
      if (scenarios.hostMisconfigured) throw new HelperError('host_misconfigured');
      if (action === 'list') data = actionList();
      else if (action === 'get-config') data = actionGetConfig(name);
      else {
        await sleep(scenarios.mutationDelayMs);
        if (scenarios.busyNext) {
          scenarios.busyNext = false;
          throw new HelperError('busy');
        }
        if (action === 'add') data = actionAdd(name);
        else if (action === 'remove') data = actionRemove(name);
        else data = actionToggle(action, name);
      }
    }
    return { exit: 0, body: { ok: true, protocol: PROTOCOL, data } };
  } catch (err) {
    if (err instanceof HelperError) return errorResponse(err);
    return errorResponse(new HelperError('internal'));
  }
}
