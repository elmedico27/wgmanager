// SshTransport against a real sshd. Runs only when WGM_SSH_LAB points at a lab
// directory prepared by test/ssh-lab.sh (a throwaway sshd on 127.0.0.1:2222
// with a ForceCommand that answers like the helper). Skipped otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { SshTransport } from '../src/transport.js';

const LAB = process.env.WGM_SSH_LAB;
const skip = !LAB && 'set WGM_SSH_LAB (see test/ssh-lab.sh)';

let seq = 0;
function setup({ port = 2222, readMs = 20000, appKey = 'app_key', reuse = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgm-ssh-'));
  // Each test gets its own short socket dir, so no test rides on another's connection.
  const control = reuse ? `/tmp/wgmt-${process.pid}-${++seq}` : '';
  const cfg = loadConfig({ DATA_DIR: dir, SSH_HOST: '127.0.0.1', SSH_PORT: String(port), SSH_USER: 'wgweb', SSH_CONTROL_DIR: control });
  cfg.timeouts.readMs = readMs;
  cfg.timeouts.connectSec = 3;
  const store = new Store(dir);
  store.init();
  for (const ext of ['', '.pub']) {
    fs.copyFileSync(path.join(LAB, appKey + ext), store.p('ssh/id_ed25519' + ext));
    fs.chmodSync(store.p('ssh/id_ed25519' + ext), 0o600);
  }
  const tr = new SshTransport(cfg, store, () => {});
  return { tr, store, dir, control, ready: tr.init() };
}

function labFingerprint() {
  // "256 SHA256:... comment (ED25519)"
  return execFileSync('ssh-keygen', ['-lf', path.join(LAB, 'host_ed25519.pub')], { encoding: 'utf8' }).split(' ')[1];
}

test('nothing is sent before the server identity is confirmed', { skip }, async () => {
  const { tr, ready } = setup();
  await ready;
  const r = await tr.call('version');
  assert.equal(r.error.code, 'hostkey_unconfirmed');
});

test('offered fingerprint matches ssh-keygen -lf of the host key', { skip }, async () => {
  const { tr, ready } = setup();
  await ready;
  const st = await tr.hostKeyStatus();
  assert.equal(st.pinned, null);
  assert.equal(st.offered.fingerprint, labFingerprint());
  assert.equal(st.offered.type, 'ED25519');
});

test('pinning: wrong fingerprint refused; right one written as known_hosts', { skip }, async () => {
  const { tr, store, ready } = setup();
  await ready;
  let r = await tr.pin('SHA256:not-the-right-one');
  assert.equal(r.error.code, 'hostkey_mismatch');
  r = await tr.pin(labFingerprint());
  assert.equal(r.ok, true);
  assert.match(store.read('known_hosts'), /^\[127\.0\.0\.1\]:2222 ssh-ed25519 AAAA[A-Za-z0-9+/=]+\n$/);
  assert.equal(fs.statSync(store.p('known_hosts')).mode & 0o777, 0o600);
});

test('confirmed: the request reaches the forced command and the JSON comes back', { skip }, async () => {
  const { tr, ready } = setup();
  await ready;
  await tr.pin(labFingerprint());
  let r = await tr.call('version');
  assert.equal(r.ok, true);
  assert.equal(r.data.helper_version, '0.1.4');
  r = await tr.call('get-config Bob_Phone');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'not_found'); // helper exit 3, envelope passed through
  r = await tr.call('echo Bob_Phone');
  assert.equal(r.error.code, 'bad_response'); // JSON without ok/protocol
});

test('timeout: killed, reported, not retried', { skip }, async () => {
  const { tr, ready } = setup({ readMs: 1500 });
  await ready;
  await tr.pin(labFingerprint());
  const t0 = Date.now();
  const r = await tr.call('slow');
  assert.equal(r.error.code, 'timeout');
  assert.ok(Date.now() - t0 < 5000);
});

test('changed host key: refused and reported, nothing sent', { skip }, async () => {
  const { tr, store, ready } = setup();
  await ready;
  await tr.pin(labFingerprint());
  const other = fs.readFileSync(path.join(LAB, 'other_host.pub'), 'utf8').split(' ')[1];
  store.write('known_hosts', `[127.0.0.1]:2222 ssh-ed25519 ${other}\n`);
  const rec = store.readJson('hostkey.json');
  rec.key = other;
  rec.fingerprint = 'SHA256:' + 'x'.repeat(43);
  store.writeJson('hostkey.json', rec);
  const r = await tr.call('version');
  assert.equal(r.error.code, 'hostkey_changed');
});

test('app key not installed: key_refused', { skip }, async () => {
  const { tr, ready } = setup({ appKey: 'stranger_key' });
  await ready;
  await tr.pin(labFingerprint());
  const r = await tr.call('version');
  assert.equal(r.error.code, 'key_refused');
});

test('nothing listening: unreachable', { skip }, async () => {
  const { tr, ready } = setup({ port: 2299 });
  await ready;
  assert.equal((await tr.hostKeyStatus()).offered, null);
  const r = await tr.pin('SHA256:x');
  assert.equal(r.error.code, 'unreachable');
});

test('first start creates the app key with ssh-keygen', { skip: !LAB && skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgm-key-'));
  const store = new Store(dir);
  store.init();
  const tr = new SshTransport(loadConfig({ DATA_DIR: dir }), store, () => {});
  await tr.init();
  assert.match(tr.publicKey(), /^ssh-ed25519 AAAA\S+ wgmanager@container$/);
  assert.equal(fs.statSync(store.p('ssh/id_ed25519')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(store.p('ssh')).mode & 0o777, 0o700);
});


// --- connection reuse ------------------------------------------------------------

const accepted = () => (fs.readFileSync(path.join(LAB, 'sshd.log'), 'utf8').match(/Accepted publickey/g) || []).length;
const masters = (control) => (fs.existsSync(control) ? fs.readdirSync(control) : []);

test('reuse: ten calls, one login', { skip }, async () => {
  const { tr, ready, control } = setup();
  await ready;
  await tr.pin(labFingerprint());
  const before = accepted();
  for (let i = 0; i < 10; i++) assert.equal((await tr.call('version')).ok, true);
  assert.equal(accepted() - before, 1);
  assert.equal(masters(control).length, 1);
  assert.equal(fs.statSync(control).mode & 0o777, 0o700);
  await tr.closeShared();
});

test('reuse off (SSH_CONTROL_DIR empty): one login per call', { skip }, async () => {
  const { tr, ready } = setup({ reuse: false });
  await ready;
  await tr.pin(labFingerprint());
  const before = accepted();
  for (let i = 0; i < 3; i++) await tr.call('version');
  assert.equal(accepted() - before, 3);
});

test('reuse: the server dropping the connection is invisible to the next call', { skip }, async () => {
  const { tr, ready } = setup();
  await ready;
  await tr.pin(labFingerprint());
  await tr.call('version');
  // end every wgweb session process on the server side
  execFileSync('pkill', ['-u', 'wgweb', 'sshd']);
  await new Promise((r) => setTimeout(r, 500));
  const r = await tr.call('version');
  assert.equal(r.ok, true);
  await tr.closeShared();
});

test('reuse: confirming the identity again closes the shared connection', { skip }, async () => {
  const { tr, ready, control } = setup();
  await ready;
  await tr.pin(labFingerprint());
  await tr.call('version');
  assert.equal(masters(control).length, 1);
  await tr.pin(labFingerprint());
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(masters(control).length, 0);
});

test('reuse: at most 4 calls at once, all answered', { skip }, async () => {
  const { tr, ready } = setup();
  await ready;
  await tr.pin(labFingerprint());
  let peak = 0;
  const orig = tr.slot.bind(tr);
  tr.slot = async () => {
    await orig();
    peak = Math.max(peak, tr.active);
  };
  const results = await Promise.all(Array.from({ length: 9 }, () => tr.call('version')));
  assert.ok(results.every((r) => r.ok));
  assert.ok(peak <= 4, `peak ${peak}`);
  await tr.closeShared();
});

test('reuse: a too-long socket dir turns reuse off instead of failing', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgm-ssh-'));
  const cfg = loadConfig({ DATA_DIR: dir, SSH_CONTROL_DIR: '/tmp/' + 'x'.repeat(80) });
  const store = new Store(dir);
  store.init();
  const logs = [];
  const tr = new SshTransport(cfg, store, (l) => logs.push(l));
  await tr.init();
  assert.equal(tr.controlDir, null);
  assert.deepEqual(tr.muxOptions(), ['-o', 'ControlPath=none']);
  assert.match(logs.join(), /connection reuse is off/);
});
