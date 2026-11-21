import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMonitor, versionOlder } from '../src/monitor.js';
import { createNotifier, TEXT } from '../src/notify.js';
import { Store } from '../src/store.js';

const ok = (data) => ({ ok: true, protocol: 1, data });
const fail = (code) => ({ ok: false, protocol: 1, error: { code, message: 'x' } });

function setup({ on = { errors: true, updates: true }, bundledHelper = '0.1.5', answers = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgm-mon-'));
  const store = new Store(dir);
  store.init();
  const sent = [];
  const ntfy = { enabled: true, send: async (t) => (sent.push(t), { ok: true, id: 'AbC123xYz0pQ' }) };
  const notifier = createNotifier({ ntfy, on, store, log: () => {}, now: () => Date.now() });
  const calls = [];
  const a = { version: ok({ helper_version: '0.1.5', protocol: 1 }), list: ok({ clients: [] }), ...answers };
  const call = async (req) => (calls.push(req), a[req]);
  const monitor = createMonitor({ call, notifier, on, bundledHelper });
  return { monitor, sent, calls, a, store };
}

test('versionOlder follows the web UI rule', () => {
  assert.equal(versionOlder('0.1.3', '0.1.5'), true);
  assert.equal(versionOlder('0.1.5', '0.1.5'), false);
  assert.equal(versionOlder('0.2.0', '0.1.9'), false);
  assert.equal(versionOlder('dev', '0.1.5'), false);
  assert.equal(versionOlder(undefined, '0.1.5'), false);
});

test('a healthy server sends nothing', async () => {
  const s = setup();
  await s.monitor.check();
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.calls, ['version', 'list']);
});

test('a problem is announced on the second check, once, then recovery once', async () => {
  const s = setup();
  s.a.version = fail('unreachable');
  await s.monitor.check();
  assert.deepEqual(s.sent, []);
  await s.monitor.check();
  await s.monitor.check();
  assert.deepEqual(s.sent, [TEXT.host.unreachable]);
  s.a.version = ok({ helper_version: '0.1.5', protocol: 1 });
  await s.monitor.check();
  await s.monitor.check();
  assert.deepEqual(s.sent, [TEXT.host.unreachable, TEXT.hostRecovered]);
});

test('one bad check followed by a good one sends nothing', async () => {
  const s = setup();
  s.a.version = fail('timeout');
  await s.monitor.check();
  s.a.version = ok({ helper_version: '0.1.5', protocol: 1 });
  await s.monitor.check();
  assert.deepEqual(s.sent, []);
});

test('a changed server identity is announced at once', async () => {
  const s = setup();
  s.a.version = fail('hostkey_changed');
  await s.monitor.check();
  assert.deepEqual(s.sent, [TEXT.host.identity]);
});

test('busy is ignored; a misconfigured host (list fails) is a problem', async () => {
  const s = setup();
  s.a.version = fail('busy');
  await s.monitor.check();
  await s.monitor.check();
  assert.deepEqual(s.sent, []);
  s.a.version = ok({ helper_version: '0.1.5', protocol: 1 });
  s.a.list = fail('host_misconfigured');
  await s.monitor.check();
  await s.monitor.check();
  assert.deepEqual(s.sent, [TEXT.host.misconfigured]);
});

test('a protocol mismatch is its own problem', async () => {
  const s = setup();
  s.a.version = ok({ helper_version: '0.1.5', protocol: 2 });
  await s.monitor.check();
  await s.monitor.check();
  assert.deepEqual(s.sent, [TEXT.host.protocol]);
});

test('an outdated helper is announced once per shipped version', async () => {
  const s = setup();
  s.a.version = ok({ helper_version: '0.1.3', protocol: 1 });
  await s.monitor.check();
  await s.monitor.check();
  assert.deepEqual(s.sent, [TEXT.helperUpdate('0.1.5')]);
  assert.equal(JSON.parse(fs.readFileSync(s.store.p('ntfy-state.json'), 'utf8')).helperUpdate, '0.1.5');
});

test('errors off: no list call and no problem notices; updates off: no helper notice', async () => {
  const s = setup({ on: { errors: false, updates: true } });
  s.a.version = ok({ helper_version: '0.1.3', protocol: 1 });
  await s.monitor.check();
  assert.deepEqual(s.calls, ['version']);
  assert.equal(s.sent.length, 1);
  const t = setup({ on: { errors: true, updates: false } });
  t.a.version = ok({ helper_version: '0.1.3', protocol: 1 });
  await t.monitor.check();
  assert.deepEqual(t.sent, []);
});

test('a problem that changes class before it clears still gets its recovery notice', async () => {
  const s = setup();
  s.a.version = fail('unreachable');
  await s.monitor.check();
  await s.monitor.check();
  s.a.version = fail('key_refused');
  await s.monitor.check();
  s.a.version = ok({ helper_version: '0.1.5', protocol: 1 });
  await s.monitor.check();
  assert.deepEqual(s.sent, [TEXT.host.unreachable, TEXT.hostRecovered]);
  await s.monitor.check();
  assert.equal(s.sent.length, 2);
});

test("the helper's internal error is not reported as can't reach", async () => {
  const s = setup({ answers: { version: fail('internal') } });
  await s.monitor.check();
  await s.monitor.check();
  assert.deepEqual(s.sent, [TEXT.host.other]);
});
