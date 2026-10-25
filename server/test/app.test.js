import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { MockTransport } from '../src/transport.js';
import { createApp } from '../src/app.js';
import { loadUi } from '../src/http.js';
import { Admin } from '../src/auth.js';

const mock = await import('../../web/src/mock/helper.js');

let ctx;

async function start({ transport, clock } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgm-'));
  const uiDir = path.join(dir, 'ui');
  fs.mkdirSync(path.join(uiDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(uiDir, 'assets', 'app-abc.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'nope');
  const cfg = loadConfig({ DATA_DIR: path.join(dir, 'data'), UI_DIR: uiDir, HELPER_MODE: 'mock' });
  const store = new Store(cfg.dataDir);
  store.init();
  const logs = [];
  const t = { now: Date.parse('2026-10-22T12:00:00Z') };
  const tr = transport ?? new MockTransport(cfg, mock, { delayMs: 0 });
  const app = createApp({ cfg, store, transport: tr, ui: loadUi(uiDir), log: (l) => logs.push(l), now: clock ?? (() => t.now) });
  app.admin.announceSetupCode();
  const server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { dir, cfg, store, app, server, base, logs, t, transport: tr };
}

beforeEach(async (t) => {
  if (ctx) ctx.server.close();
  ctx = await start();
});

/** Minimal client with a cookie jar and the CSRF token. */
function client(c = ctx) {
  const jar = { cookie: null, csrf: null };
  async function req(method, url, body, headers = {}) {
    const h = { ...headers };
    if (jar.cookie) h.Cookie = jar.cookie;
    if (body !== undefined) h['Content-Type'] ??= 'application/json';
    if (method !== 'GET' && jar.csrf && !('X-CSRF-Token' in h)) h['X-CSRF-Token'] = jar.csrf;
    const res = await fetch(c.base + url, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = set.split(';')[0].endsWith('=') ? null : set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const json = type.startsWith('application/json') ? await res.json() : null;
    if (json?.data && 'csrf' in json.data) jar.csrf = json.data.csrf;
    return { res, json, text: json ? null : await res.text().catch(() => null) };
  }
  return { req, jar };
}

const code = (c = ctx) => c.store.read('setup-code').trim();

async function signedIn(c = ctx) {
  const cl = client(c);
  const r = await cl.req('POST', '/api/setup', { code: code(c), password: 'correct horse battery' });
  assert.equal(r.json.ok, true);
  return cl;
}

// --- setup and sign-in ----------------------------------------------------------------

test('fresh install: no password, setup code printed to the log', async () => {
  const { json } = await client().req('GET', '/api/session');
  assert.deepEqual(json.data, { authenticated: false, passwordSet: false, csrf: null });
  assert.match(ctx.logs.join('\n'), new RegExp(`Setup code: ${code()}`));
  assert.match(code(), /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  const mode = fs.statSync(ctx.store.p('setup-code')).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('setup: wrong code refused, then rate limited after 5 failures', async () => {
  const cl = client();
  for (let i = 0; i < 5; i++) {
    const r = await cl.req('POST', '/api/setup', { code: 'AAAA-AAAA-AAAA', password: 'correct horse battery' });
    assert.equal(r.res.status, 401);
    assert.equal(r.json.error.code, 'bad_code');
  }
  const r = await cl.req('POST', '/api/setup', { code: code(), password: 'correct horse battery' });
  assert.equal(r.res.status, 429);
});

test('setup: code is case- and dash-insensitive; short password refused; then signed in', async () => {
  const cl = client();
  const loose = code().toLowerCase().replace(/-/g, ' ');
  let r = await cl.req('POST', '/api/setup', { code: loose, password: 'short' });
  assert.equal(r.json.error.code, 'weak_password');
  r = await cl.req('POST', '/api/setup', { code: loose, password: 'correct horse battery' });
  assert.equal(r.json.ok, true);
  const cookie = r.res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /Secure/); // plain http
  assert.equal(ctx.store.read('setup-code'), null, 'setup code is used up');
  const rec = ctx.store.readJson('admin.json');
  assert.equal(rec.algorithm, 'scrypt');
  assert.deepEqual(rec.params, { N: 65536, r: 8, p: 2, keylen: 32 });
  assert.ok(!JSON.stringify(rec).includes('correct horse'));
  assert.equal(fs.statSync(ctx.store.p('admin.json')).mode & 0o777, 0o600);
  r = await client().req('POST', '/api/setup', { code: 'X', password: 'correct horse battery' });
  assert.equal(r.json.error.code, 'already_set');
});

test('Secure cookie behind a trusted HTTPS proxy only', async () => {
  ctx.server.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgm-'));
  ctx = await start();
  ctx.cfg.trustProxy = true;
  const r = await client().req('POST', '/api/setup', { code: code(), password: 'correct horse battery' }, { 'X-Forwarded-Proto': 'https' });
  assert.match(r.res.headers.get('set-cookie'), /Secure/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sign in, wrong password, sign out', async () => {
  await signedIn();
  const cl = client();
  let r = await cl.req('POST', '/api/session', { password: 'wrong password!!' });
  assert.equal(r.res.status, 401);
  r = await cl.req('POST', '/api/session', { password: 'correct horse battery' });
  assert.equal(r.json.ok, true);
  r = await cl.req('GET', '/api/clients');
  assert.equal(r.json.ok, true);
  r = await cl.req('DELETE', '/api/session');
  assert.equal(r.json.ok, true);
  r = await cl.req('GET', '/api/clients');
  assert.equal(r.res.status, 401);
});

// --- protections ----------------------------------------------------------------------

test('API needs a session', async () => {
  for (const [m, u] of [['GET', '/api/clients'], ['GET', '/api/settings'], ['GET', '/api/clients/Bob_Phone/config'], ['GET', '/api/clients/Bob_Phone/qrcode.svg']]) {
    const r = await client().req(m, u);
    assert.equal(r.res.status, 401, u);
  }
});

test('CSRF: token required on changes; cross-site Origin refused; JSON only', async () => {
  const cl = await signedIn();
  let r = await cl.req('POST', '/api/clients', { name: 'Zed_Phone' }, { 'X-CSRF-Token': 'nope' });
  assert.equal(r.res.status, 403);
  r = await cl.req('POST', '/api/clients/Bob_Phone/disable', undefined, { 'X-CSRF-Token': '' });
  assert.equal(r.res.status, 403);
  r = await cl.req('POST', '/api/clients', { name: 'Zed_Phone' }, { Origin: 'http://evil.example' });
  assert.equal(r.json.error.code, 'csrf');
  r = await cl.req('POST', '/api/clients', 'name=Zed_Phone', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(r.res.status, 415);
  r = await cl.req('POST', '/api/clients', { name: 'Zed_Phone' }, { Origin: ctx.base });
  assert.equal(r.json.ok, true);
});

test('security headers on UI and API', async () => {
  for (const u of ['/', '/api/session']) {
    const { res } = await client().req('GET', u);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /style-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  }
});

function rawGet(pathname) {
  // http.get sends the path as written; fetch would normalise ../
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: ctx.server.address().port, path: pathname }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
  });
}

test('raw paths with ../ never escape the build or reach the helper', async () => {
  for (const u of ['/../secret.txt', '/assets/../../secret.txt', '/..%2fsecret.txt', '/api/clients/..%2F..%2Fx/config']) {
    const status = await rawGet(u);
    assert.ok([400, 401, 404].includes(status), `${u} -> ${status}`);
  }
});

test('UI files: index, hashed assets cached, nothing outside the build', async () => {
  let r = await client().req('GET', '/');
  assert.equal(r.res.status, 200);
  assert.equal(r.res.headers.get('cache-control'), 'no-cache');
  r = await client().req('GET', '/assets/app-abc.js');
  assert.match(r.res.headers.get('cache-control'), /immutable/);
  for (const u of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/nothing']) {
    r = await client().req('GET', u);
    assert.equal(r.res.status, 404, u);
  }
});

test('page addresses: app pages get the app, anything else the app with 404', async () => {
  for (const u of ['/', '/clients', '/clients/', '/host', '/settings/', '/clients/Alice_Phone', '/clients/Bob%20Phone']) {
    const r = await client().req('GET', u);
    assert.equal(r.res.status, 200, u);
    assert.match(r.text, /<title>t<\/title>/, u);
  }
  for (const u of ['/wrongfolder', '/clients/a/b', '/hosts', '/settings/x', '/assets/missing.js', '/index.htm']) {
    const r = await client().req('GET', u);
    assert.equal(r.res.status, 404, u);
    assert.match(r.text, /<title>t<\/title>/, u); // the app, which shows "Page not found"
    assert.equal(r.res.headers.get('cache-control'), 'no-cache', u);
  }
  // API addresses never fall back to the app: still JSON (401 here, since nobody is signed in).
  const r = await client().req('GET', '/api/nothing');
  assert.ok([401, 404].includes(r.res.status));
  assert.match(r.res.headers.get('content-type'), /json/);
});

// --- sessions ----------------------------------------------------------------------------

test('session expires after 6 hours idle and after 7 days regardless', async () => {
  const cl = await signedIn();
  ctx.t.now += 5 * 3600e3;
  assert.equal((await cl.req('GET', '/api/clients')).res.status, 200, 'used within 6 h');
  ctx.t.now += 6 * 3600e3 + 1000;
  assert.equal((await cl.req('GET', '/api/clients')).res.status, 401, 'idle > 6 h');

  const cl2 = client();
  await cl2.req('POST', '/api/session', { password: 'correct horse battery' });
  for (let i = 0; i < 7 * 5; i++) {
    ctx.t.now += 5 * 3600e3; // keep it busy
    if ((await cl2.req('GET', '/api/session')).json.data.authenticated === false) break;
  }
  assert.equal((await cl2.req('GET', '/api/clients')).res.status, 401, 'over 7 days');
});

test('password change keeps this session and signs out the others', async () => {
  const a = await signedIn();
  const b = client();
  await b.req('POST', '/api/session', { password: 'correct horse battery' });
  let r = await a.req('POST', '/api/password', { current: 'wrong one here', password: 'another long password' });
  assert.equal(r.json.error.code, 'bad_login');
  r = await a.req('POST', '/api/password', { current: 'correct horse battery', password: 'short' });
  assert.equal(r.json.error.code, 'weak_password');
  r = await a.req('POST', '/api/password', { current: 'correct horse battery', password: 'another long password' });
  assert.equal(r.json.ok, true);
  assert.equal((await a.req('GET', '/api/clients')).res.status, 200);
  assert.equal((await b.req('GET', '/api/clients')).res.status, 401);
  r = await client().req('POST', '/api/session', { password: 'another long password' });
  assert.equal(r.json.ok, true);
});

test('reset-password: everyone signed out, new setup code, old sessions never come back', async () => {
  const a = await signedIn();
  const newCode = new Admin(ctx.store).reset();
  // The server notices the file change on the next request.
  ctx.store.p('admin.json');
  assert.equal((await a.req('GET', '/api/clients')).res.status, 401);
  let r = await client().req('GET', '/api/session');
  assert.equal(r.json.data.passwordSet, false);
  const b = client();
  r = await b.req('POST', '/api/setup', { code: newCode, password: 'correct horse battery' });
  assert.equal(r.json.ok, true);
  assert.equal((await a.req('GET', '/api/clients')).res.status, 401, 'pre-reset session stays dead');
});

// --- helper calls ------------------------------------------------------------------------

test('list and version pass the helper envelope through', async () => {
  const cl = await signedIn();
  let r = await cl.req('GET', '/api/clients');
  assert.equal(r.json.protocol, 1);
  assert.ok(Array.isArray(r.json.data.clients));
  r = await cl.req('GET', '/api/version');
  assert.equal(r.json.data.backend, 'pivpn');
});

test('invalid names never reach the helper', async () => {
  const calls = [];
  ctx.server.close();
  ctx = await start({ transport: { init() {}, publicKey: () => 'k', hostKeyStatus: async () => ({}), call: async (r) => (calls.push(r), { ok: true, protocol: 1, data: {} }) } });
  const cl = await signedIn();
  for (const n of ['../x', 'server', '12345', 'a b', '-rf', 'x;id', 'ThisNameIsWayTooLong', '']) {
    const r = await cl.req('POST', '/api/clients', { name: n });
    assert.equal(r.res.status, 400, n);
  }
  for (const u of ['/api/clients/server/disable', '/api/clients/1/config', '/api/clients/a%20b', '/api/clients/%2e%2e/config', '/api/clients/%E0%A4%A']) {
    const r = await cl.req(u.endsWith('disable') ? 'POST' : 'GET', u);
    // fetch itself collapses %2e%2e, so that one lands on no route (404).
    assert.ok([400, 404].includes(r.res.status), u);
  }
  assert.deepEqual(calls, []);
});

test('add returns the config; the log never contains it', async () => {
  const cl = await signedIn();
  const r = await cl.req('POST', '/api/clients', { name: 'Yan_Laptop' });
  assert.equal(r.json.ok, true);
  assert.match(r.json.data.config, /PrivateKey = /);
  assert.match(r.res.headers.get('cache-control'), /no-store/);
  const all = ctx.logs.join('\n');
  assert.match(all, /action=add client=Yan_Laptop result=ok/);
  assert.doesNotMatch(all, /PrivateKey|PresharedKey/);
});

test('config, QR and download are no-store; download is an attachment', async () => {
  const cl = await signedIn();
  let r = await cl.req('GET', '/api/clients/Alice_Phone/download');
  assert.equal(r.res.headers.get('content-disposition'), 'attachment; filename="Alice_Phone.conf"');
  assert.match(r.res.headers.get('cache-control'), /no-store/);
  assert.match(r.text, /^\[Interface\]/);
  r = await cl.req('GET', '/api/clients/Alice_Phone/qrcode.svg');
  assert.equal(r.res.headers.get('content-type'), 'image/svg+xml');
  assert.match(r.res.headers.get('cache-control'), /no-store/);
  assert.match(r.text, /^<svg /);
  r = await cl.req('GET', '/api/clients/Nobody/qrcode.svg');
  assert.equal(r.json.error.code, 'not_found');
});

test('helper errors keep their structure (exit 5 detail reaches the UI)', async () => {
  const cl = await signedIn();
  mock.scenarios.failNextMutation = true;
  const r = await cl.req('POST', '/api/clients/Bob_Phone/disable');
  assert.equal(r.res.status, 502);
  assert.equal(r.json.error.code, 'backend_failed');
  assert.deepEqual(r.json.error.failed_checks, ['live_peer']);
  assert.match(r.json.error.backup, /^\d{8}T\d{9}Z-disable-Bob_Phone$/);
  await cl.req('POST', '/api/clients/Bob_Phone/enable'); // tidy the shared mock
});

test('protocol mismatch: list refused, version passed through for display', async () => {
  ctx.server.close();
  ctx = await start({
    transport: { init() {}, publicKey: () => 'k', hostKeyStatus: async () => ({}), call: async (r) => ({ ok: true, protocol: 2, data: { protocol: 2 } }) },
  });
  const cl = await signedIn();
  let r = await cl.req('GET', '/api/clients');
  assert.equal(r.json.error.code, 'protocol_mismatch');
  r = await cl.req('GET', '/api/version');
  assert.equal(r.json.ok, true);
});

test('settings show the SSH target and the public key', async () => {
  const cl = await signedIn();
  const r = await cl.req('GET', '/api/settings');
  assert.deepEqual(r.json.data.ssh, { host: '172.29.88.1', port: 22, user: 'wgweb' });
  assert.match(r.json.data.publicKey, /^ssh-ed25519 /);
  assert.deepEqual(r.json.data.allowFrom, ['127.0.0.1', '::1', '172.29.88.0/29']);
});

test('config: bad environment values are refused', () => {
  assert.throws(() => loadConfig({ SSH_PORT: '0' }));
  assert.throws(() => loadConfig({ SSH_PORT: '22x' }));
  assert.throws(() => loadConfig({ SSH_HOST: '-oProxyCommand=x' }));
  assert.throws(() => loadConfig({ SSH_HOST: 'a b' }));
  assert.throws(() => loadConfig({ SSH_USER: 'root;id' }));
  assert.equal(loadConfig({ SSH_PORT: '31000' }).ssh.port, 31000);
});

test.after(() => ctx?.server.close());

// --- review fixes (2026-10-22) ---------------------------------------------------------

test('background refreshes do not keep an idle session alive', async () => {
  const cl = await signedIn();
  for (let i = 0; i < 30; i++) {
    ctx.t.now += 15 * 60e3; // 7.5 hours of 15-minute background polls
    await cl.req('GET', '/api/clients', undefined, { 'X-WGM-Background': '1' });
  }
  assert.equal((await cl.req('GET', '/api/clients')).res.status, 401);
});

test('failures: exit 5 and timeouts are kept for every browser until acknowledged', async () => {
  const a = await signedIn();
  const b = client();
  await b.req('POST', '/api/session', { password: 'correct horse battery' });
  mock.scenarios.failNextMutation = true;
  await a.req('POST', '/api/clients/Bob_Phone/disable');
  let r = await b.req('GET', '/api/failures');
  assert.equal(r.json.data.failures.length, 1);
  const f = r.json.data.failures[0];
  assert.equal(f.action, 'disable');
  assert.equal(f.client, 'Bob_Phone');
  assert.deepEqual(f.error.failed_checks, ['live_peer']);
  assert.equal(f.error.partial, true);
  assert.match(f.error.backup, /-disable-Bob_Phone$/);
  // survives a restart (it is in the data volume)
  assert.equal(ctx.store.readJson('failures.json').length, 1);
  r = await b.req('DELETE', `/api/failures/${f.id}`);
  assert.equal(r.json.ok, true);
  assert.equal((await a.req('GET', '/api/failures')).json.data.failures.length, 0);
  await a.req('POST', '/api/clients/Bob_Phone/enable');
});

test('failures: a plain error (busy) is not kept; ack needs the CSRF token', async () => {
  const cl = await signedIn();
  mock.scenarios.busyNext = true;
  await cl.req('POST', '/api/clients/Bob_Phone/disable');
  assert.equal((await cl.req('GET', '/api/failures')).json.data.failures.length, 0);
  const r = await cl.req('DELETE', '/api/failures/abc', undefined, { 'X-CSRF-Token': 'nope' });
  assert.equal(r.res.status, 403);
});

test('sign-in after a reset says no_password (UI goes to setup)', async () => {
  await signedIn();
  new Admin(ctx.store).reset();
  const r = await client().req('POST', '/api/session', { password: 'correct horse battery' });
  assert.equal(r.json.error.code, 'no_password');
});

test('two setups at once: only one wins', async () => {
  const c1 = client();
  const c2 = client();
  const [r1, r2] = await Promise.all([
    c1.req('POST', '/api/setup', { code: code(), password: 'correct horse battery' }),
    c2.req('POST', '/api/setup', { code: code(), password: 'a different password' }),
  ]);
  const oks = [r1, r2].filter((r) => r.json.ok);
  assert.equal(oks.length, 1);
  assert.equal([r1, r2].find((r) => !r.json.ok).json.error.code, 'already_set');
  // the winner's session is valid
  const winner = r1.json.ok ? c1 : c2;
  assert.equal((await winner.req('GET', '/api/clients')).res.status, 200);
});

test('damaged admin.json locks sign-in instead of crashing; reset recovers', async () => {
  await signedIn();
  fs.writeFileSync(ctx.store.p('admin.json'), '{not json');
  let r = await client().req('POST', '/api/session', { password: 'correct horse battery' });
  assert.equal(r.res.status, 401);
  r = await client().req('GET', '/api/session');
  assert.equal(r.res.status, 200);
  assert.match(ctx.logs.join('\n'), /admin\.json is damaged/);
  const c = new Admin(ctx.store).reset();
  r = await client().req('POST', '/api/setup', { code: c, password: 'correct horse battery' });
  assert.equal(r.json.ok, true);
});

test('app errors are server_error, not the helper\'s internal', async () => {
  ctx.server.close();
  ctx = await start({ transport: { init() {}, publicKey: () => 'k', hostKeyStatus: async () => ({}), call: async () => { throw new Error('boom'); } } });
  const cl = await signedIn();
  const r = await cl.req('GET', '/api/clients');
  assert.equal(r.res.status, 500);
  assert.equal(r.json.error.code, 'server_error');
});

test('QR encodes non-ASCII text as UTF-8', async () => {
  const qrcode = (await import('qrcode-generator')).default;
  await import('../src/app.js'); // installs the UTF-8 conversion
  assert.deepEqual(qrcode.stringToBytes('ä'), [0xc3, 0xa4]);
});

test('behind a trusted proxy, Origin may match X-Forwarded-Host', async () => {
  ctx.cfg.trustProxy = true;
  const cl = await signedIn();
  const r = await cl.req('POST', '/api/clients', { name: 'Pat_Phone' }, { Origin: 'https://vpn-admin.example', 'X-Forwarded-Host': 'vpn-admin.example' });
  assert.equal(r.json.ok, true);
  ctx.cfg.trustProxy = false;
});
