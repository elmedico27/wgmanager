import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNotifier, TEXT } from '../src/notify.js';
import { Store } from '../src/store.js';

function setup({ on = { errors: true, updates: true }, results = [], t0 = 1_000_000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wgm-notify-'));
  const store = new Store(dir);
  store.init();
  const sent = [];
  const logs = [];
  const clock = { now: t0 };
  const ntfy = {
    enabled: true,
    send: async (text) => {
      sent.push(text);
      return results.length ? results.shift() : { ok: true, id: 'AbC123xYz0pQ' };
    },
  };
  const make = (over = {}) => createNotifier({ ntfy, on, store, log: (l) => logs.push(l), now: () => clock.now, ...over });
  return { store, sent, logs, clock, ntfy, make, dir };
}

test('a failed change sends the generic message, with nothing about the client', async () => {
  const s = setup();
  await s.make().failure();
  assert.deepEqual(s.sent, [TEXT.failure]);
  assert.match(TEXT.failure, /may be incomplete/);
  assert.doesNotMatch(TEXT.failure, /Bob_Phone|key|address/i);
});

test('errors off: nothing is sent', async () => {
  const s = setup({ on: { errors: false, updates: true } });
  await s.make().failure();
  assert.deepEqual(s.sent, []);
});

test('failure notices are capped at 5 an hour, logged once, and resume later', async () => {
  const s = setup();
  const n = s.make();
  for (let i = 0; i < 8; i++) await n.failure();
  assert.equal(s.sent.length, 5);
  assert.equal(s.logs.filter((l) => /more than 5 failure notices/.test(l)).length, 1);
  s.clock.now += 3600_000 + 1;
  await n.failure();
  assert.equal(s.sent.length, 6);
});

test('a failing ntfy is logged once per reason, never thrown, and a recovery is logged', async () => {
  const bad = { ok: false, reason: 'ntfy answered 403 (forbidden)' };
  const s = setup({ results: [bad, bad, bad, { ok: true, id: 'x' }] });
  const n = s.make();
  await n.failure();
  await n.failure();
  await n.failure();
  assert.deepEqual(s.logs, ['wgmanager: ntfy: could not send a notification (ntfy answered 403 (forbidden))']);
  await n.failure();
  assert.equal(s.logs.at(-1), 'wgmanager: ntfy works again');
});

test('an exception inside is swallowed', async () => {
  const s = setup();
  s.ntfy.send = async () => { throw new Error('boom'); };
  await assert.doesNotReject(s.make().failure());
  await assert.doesNotReject(s.make().appUpdate('0.3.3'));
  assert.ok(s.logs.every((l) => !l.includes('boom')));
});

test('an app update is announced once per release, and remembered across restarts', async () => {
  const s = setup();
  await s.make().appUpdate('0.3.3');
  await s.make().appUpdate('0.3.3'); // same store, new notifier: a restart
  await s.make().appUpdate('0.3.3');
  assert.deepEqual(s.sent, [TEXT.appUpdate('0.3.3')]);
  assert.equal(TEXT.appUpdate('0.3.3'), 'WG Manager: version 0.3.3 is available.');
  assert.deepEqual(s.store.readJson('ntfy-state.json'), { appUpdate: '0.3.3' });
  await s.make().appUpdate('0.4.0');
  assert.equal(s.sent.length, 2);
  assert.equal(s.store.readJson('ntfy-state.json').appUpdate, '0.4.0');
});

test('an update notice that could not be sent is not remembered, so the next check tries again', async () => {
  const s = setup({ results: [{ ok: false, reason: 'could not reach ntfy' }] });
  const n = s.make();
  await n.appUpdate('0.3.3');
  assert.equal(s.store.readJson('ntfy-state.json'), null);
  await n.appUpdate('0.3.3');
  assert.equal(s.sent.length, 2);
  assert.equal(s.store.readJson('ntfy-state.json').appUpdate, '0.3.3');
});

test('updates off, or an odd version: nothing is sent', async () => {
  const s = setup({ on: { errors: true, updates: false } });
  await s.make().appUpdate('0.3.3');
  const t = setup();
  for (const v of ['', null, undefined, 'v0.3.3', '0.3', '0.3.3; x', '0.3.3\nX: 1']) await t.make().appUpdate(v);
  assert.deepEqual([...s.sent, ...t.sent], []);
});

test('a damaged state file is replaced, not fatal', async () => {
  const s = setup();
  fs.writeFileSync(path.join(s.dir, 'ntfy-state.json'), '{not json');
  await s.make().appUpdate('0.3.3');
  assert.equal(s.sent.length, 1);
  assert.equal(s.store.readJson('ntfy-state.json').appUpdate, '0.3.3');
  assert.ok(s.logs.some((l) => /ntfy-state.json is unreadable/.test(l)));
});
