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
    timeouts: { readMs: 20000, mutationMs: 60000, connectSec: 10 },
    session: { idleMs: 6 * 3600 * 1000, absoluteMs: 7 * 24 * 3600 * 1000 },
  };
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(cfg.ssh.user)) throw new Error('SSH_USER is not a valid account name');
  if (!['ssh', 'mock'].includes(cfg.helperMode)) throw new Error('HELPER_MODE must be ssh or mock');
  return cfg;
}
