// Settings from the environment. Nothing here is specific to any one server;
// SSH_PORT and friends are set in the compose file.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function int(name, value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be a number`);
  const n = Number(value);
  if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
}

function host(name, value, fallback) {
  const v = value === undefined || value === '' ? fallback : value;
  // A hostname or an IP address. No spaces, no leading '-', nothing ssh would
  // read as an option or a user@ prefix.
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/.test(v)) throw new Error(`${name} is not a valid host name or address`);
  return v;
}

// "1"/"true" and "0"/"false", any capitals. Empty or unset means the default.
function bool(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const v = value.trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  throw new Error(`${name} must be 1, 0, true or false`);
}

// A header-safe secret: visible ASCII only, no spaces, so it cannot smuggle a
// line break or a second header into a request.
const SECRET_RE = /^[\x21-\x7e]{1,512}$/;

// Notifications to a ntfy server (see ntfy.md in the project notes). Everything is
// off unless NTFY_ENABLE is true; while it is off the other NTFY_* settings are
// not even read, so a half-filled .env cannot stop the app from starting.
//
// NTFY_URL is one full address. Its scheme is the TLS setting: https:// is used
// with normal certificate checks, http:// is accepted as written (a ntfy on your
// own network). There is deliberately no separate "allow http" switch.
// Error messages never repeat a value, because a pasted URL or secret may be in it.
function ntfy(env) {
  const enabled = bool('NTFY_ENABLE', env.NTFY_ENABLE, false);
  if (!enabled) return { enabled: false };
  const get = (name) => (env[name] ?? '').trim();

  const rawUrl = get('NTFY_URL');
  if (!rawUrl) throw new Error('NTFY_URL is required when NTFY_ENABLE is true');
  const example = 'a full address such as https://ntfy.example.com or http://192.168.0.5:2586';
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`NTFY_URL must be ${example}`);
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname) throw new Error(`NTFY_URL must be ${example}`);
  if (u.username || u.password) throw new Error('NTFY_URL must not contain a user name or password; use NTFY_TOKEN, or NTFY_USER and NTFY_PASSWORD');
  if (u.search || u.hash) throw new Error('NTFY_URL must not contain a query (?) or a fragment (#)');
  // Scheme, host and port, plus a path prefix if the server sits under one. No trailing slash.
  const url = u.origin + u.pathname.replace(/\/+$/, '');

  // The topic goes into the request path. Letters, digits, "_" and "-" only, up to
  // 64 characters (unverified: ntfy's documented rule, remembered; its server is
  // the final judge). Keeping to this means a topic can never change the path.
  const topic = get('NTFY_TOPIC');
  if (!topic) throw new Error('NTFY_TOPIC is required when NTFY_ENABLE is true');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) throw new Error('NTFY_TOPIC may only contain letters, digits, "_" and "-" (up to 64 characters)');

  const token = get('NTFY_TOKEN');
  const user = get('NTFY_USER');
  const password = env.NTFY_PASSWORD ?? '';
  let auth = null;
  if (token && (user || password)) throw new Error('Set NTFY_TOKEN, or NTFY_USER and NTFY_PASSWORD, not both');
  if (token) {
    if (!SECRET_RE.test(token)) throw new Error('NTFY_TOKEN must be one word of printable characters, with no spaces');
    auth = { type: 'token', token };
  } else if (user || password) {
    if (!user || !password) throw new Error('NTFY_USER and NTFY_PASSWORD must be set together');
    if (user.includes(':') || !SECRET_RE.test(user)) throw new Error('NTFY_USER must be printable characters with no spaces and no ":"');
    if (!/^[\x20-\x7e]{1,512}$/.test(password)) throw new Error('NTFY_PASSWORD must be printable ASCII characters');
    auth = { type: 'basic', user, password };
  }
  // Which kinds of notification are wanted. Default: all that exist.
  const on = {
    errors: bool('NTFY_ON_ERRORS', env.NTFY_ON_ERRORS, true),
    updates: bool('NTFY_ON_UPDATES', env.NTFY_ON_UPDATES, true),
  };
  return { enabled: true, url, topic, secure: u.protocol === 'https:', auth, on };
}

export function loadConfig(env = process.env) {
  const cfg = {
    // Inside the container the app always listens on this port; WEB_PORT and
    // WEB_BIND in the compose file decide what the host publishes.
    listenHost: env.LISTEN_HOST || '0.0.0.0',
    listenPort: int('LISTEN_PORT', env.LISTEN_PORT, 7501, 1, 65535),
    ssh: {
      // Default: the gateway of the pinned bridge network 172.29.88.0/29
      // (unverified until the compose step: Docker's gateway assignment).
      host: host('SSH_HOST', env.SSH_HOST, '172.29.88.1'),
      port: int('SSH_PORT', env.SSH_PORT, 22, 1, 65535),
      user: env.SSH_USER || 'wgweb',
    },
    // Must match the installer's default allowed sources (wgmanager-host
    // DEFAULT_SOURCES); shown on the connect screen.
    allowFrom: ['127.0.0.1', '::1', '172.29.88.0/29'],
    dataDir: env.DATA_DIR || '/data',
    uiDir: env.UI_DIR || path.resolve(here, '../../web/dist'),
    helperMode: env.HELPER_MODE || 'ssh', // ssh | mock
    // Where the shared SSH connection's socket lives (tmpfs in the container).
    // Empty turns connection reuse off.
    controlDir: env.SSH_CONTROL_DIR === undefined ? '/tmp/wgm-ssh' : env.SSH_CONTROL_DIR || null,
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    // Ask GitHub for the latest release at start and every 12 hours (updates.js).
    // Off unless UPDATE_CHECK is 1 or true: the app makes no outbound connection
    // (besides SSH to the server) that the user has not asked for.
    updateCheck: bool('UPDATE_CHECK', env.UPDATE_CHECK, false),
    ntfy: ntfy(env),
    timeouts: { readMs: 20000, mutationMs: 60000, connectSec: 10 },
    session: { idleMs: 6 * 3600 * 1000, absoluteMs: 7 * 24 * 3600 * 1000 },
  };
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(cfg.ssh.user)) throw new Error('SSH_USER is not a valid account name');
  if (!['ssh', 'mock'].includes(cfg.helperMode)) throw new Error('HELPER_MODE must be ssh or mock');
  return cfg;
}
