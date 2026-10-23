// In-browser stand-in for the Express backend (preview and `npm run dev` only).
// It mirrors the HTTP API the real backend will expose (see src/lib/api.js),
// passing helper envelopes through unchanged, and adds the app-level states the
// backend owns: login, first run (helper unreachable), SSH timeout.

import { run, scenarios as helperScenarios } from './helper.js';
import QRCode from 'qrcode';

export const appScenarios = {
  firstRun: false,    // app key not yet installed on the host: SSH is refused
                      // (the preview also clears the host-key pin when this is turned on)
  sshTimeout: false,  // next mutation hits the 60 s SSH timeout (outcome unknown)
  noPassword: false,  // fresh install: no admin password yet, setup code in the log
  hostKeyPinned: true,    // server's SSH host key confirmed by the admin
  hostKeyChanged: false,  // the server now presents a different host key than the pinned one
};

// Fake ED25519 host-key fingerprints in OpenSSH's SHA256 format.
const OFFERED_FP = 'SHA256:q3Vt8mK2pXw7LhN4bRz9cYdF1sJ6uE0aTgW5oQiHnBk';
const OTHER_FP = 'SHA256:Zr1xY7cQ0vM3nB8kL5tW2pD9fH4sJ6gA1eU7iO3yRmT';
let pinned = { fingerprint: OFFERED_FP, type: 'ED25519', at: Date.now() - 86400000 * 3 };

// The real setup code is random and printed to the container log on start.
export const PREVIEW_SETUP_CODE = 'K7QM-4XTD-92PW';
export const MIN_PASSWORD = 12;

export const scenarios = helperScenarios;

let authenticated = false;
const PREVIEW_PASSWORD_HINT = 'any password works in the preview';

const settings = {
  ssh: { host: '172.29.88.1', port: 22, user: 'wgweb' },
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK7x2mQ9vR4tYw8pL3nHc6fJ1sB0aEdZuXgVqTyWiMoN wgmanager@container',
  allowFrom: ['127.0.0.1', '::1', '172.29.88.0/29'],
};

const appError = (code, message) => ({ ok: false, error: { code, message } });

async function helper(request) {
  // Order matters: the host key is checked before the app's key is offered.
  if (appScenarios.hostKeyChanged) return appError('hostkey_changed', 'the server presented a different host key');
  if (!appScenarios.hostKeyPinned) return appError('hostkey_unconfirmed', 'confirm the server identity first');
  if (appScenarios.firstRun) return appError('unreachable', 'the host refused the app key');
  const { body } = await run(request);
  return body;
}

export async function handle(method, path, body) {
  const m = path.match(/^\/api\/clients\/([^/]+)(?:\/(enable|disable|config))?$/);

  if (path === '/api/setup' && method === 'POST') {
    if (!appScenarios.noPassword) return appError('already_set', 'a password is already set');
    if (body?.code?.trim().toUpperCase() !== PREVIEW_SETUP_CODE) return appError('bad_code', 'wrong setup code');
    if (!body?.password || body.password.length < MIN_PASSWORD) return appError('weak_password', 'too short');
    appScenarios.noPassword = false;
    authenticated = true;
    return { ok: true, data: { authenticated } };
  }

  if (path === '/api/session') {
    if (method === 'GET') {
      return { ok: true, data: { authenticated: authenticated && !appScenarios.noPassword, passwordSet: !appScenarios.noPassword, hint: PREVIEW_PASSWORD_HINT } };
    }
    if (method === 'POST') {
      if (!body?.password) return appError('bad_login', 'wrong password');
      authenticated = true;
      return { ok: true, data: { authenticated } };
    }
    if (method === 'DELETE') {
      authenticated = false;
      return { ok: true, data: { authenticated } };
    }
  }
  if (!authenticated) return appError('unauthenticated', 'sign in first');

  if (path === '/api/settings') return { ok: true, data: settings };
  if (path === '/api/hostkey') {
    const offered = appScenarios.hostKeyChanged ? OTHER_FP : OFFERED_FP;
    if (method === 'GET') {
      return { ok: true, data: { pinned: appScenarios.hostKeyPinned ? pinned : null, offered: { fingerprint: offered, type: 'ED25519' } } };
    }
    if (method === 'POST') {
      if (body?.fingerprint !== offered) return appError('hostkey_mismatch', 'the server key changed while confirming');
      pinned = { fingerprint: offered, type: 'ED25519', at: Date.now() };
      appScenarios.hostKeyPinned = true;
      appScenarios.hostKeyChanged = false;
      appScenarios.firstRun = false; // preview only: assume the install command was run
      return { ok: true, data: { pinned } };
    }
    if (method === 'DELETE') {
      appScenarios.hostKeyPinned = false;
      return { ok: true, data: { pinned: null } };
    }
  }
  if (path === '/api/password' && method === 'POST') {
    // Preview: any non-empty current password is accepted.
    if (!body?.current) return appError('bad_login', 'current password is wrong');
    if (!body?.password || body.password.length < MIN_PASSWORD) return appError('weak_password', 'too short');
    return { ok: true, data: { changed: true, otherSessionsSignedOut: true } };
  }
  if (path === '/api/version') return helper('version');
  if (path === '/api/clients' && method === 'GET') return helper('list');
  if (path === '/api/clients' && method === 'POST') return mutation(`add ${body.name}`);

  if (m) {
    const name = decodeURIComponent(m[1]);
    if (method === 'DELETE' && !m[2]) return mutation(`remove ${name}`);
    if (method === 'POST' && (m[2] === 'enable' || m[2] === 'disable')) return mutation(`${m[2]} ${name}`);
    if (method === 'GET' && m[2] === 'config') return helper(`get-config ${name}`);
  }
  return appError('not_found', 'no such route');
}

async function mutation(request) {
  if (appScenarios.sshTimeout && !appScenarios.firstRun) {
    appScenarios.sshTimeout = false;
    // The real helper may still finish; the app never retries.
    run(request);
    await new Promise((r) => setTimeout(r, 2500));
    return appError('timeout', 'no answer from the host within 60 seconds');
  }
  return helper(request);
}

/** QR for a client config, rendered as SVG. The real backend serves
 *  /api/clients/:name/qrcode.svg; here we build an object URL. */
export async function qrUrl(name) {
  const res = await helper(`get-config ${name}`);
  if (!res.ok) throw res.error;
  const svg = await QRCode.toString(res.data.config, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}
