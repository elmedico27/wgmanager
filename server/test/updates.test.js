import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateChecker, isNewer, isRelease } from '../src/updates.js';
import { loadConfig } from '../src/config.js';

// The answer's shape is copied from the real GitHub endpoint (checked 2026-11-18):
// tag_name, draft, prerelease, html_url (plus many fields the app ignores).
const release = (over = {}) => ({
  tag_name: 'v0.3.1',
  name: 'v0.3.1',
  draft: false,
  prerelease: false,
  html_url: 'https://github.com/elmedico27/wgmanager/releases/tag/v0.3.1',
  ...over,
});
const answer = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('isNewer compares release numbers, not text', () => {
  assert.equal(isNewer('0.3.1', '0.3.0'), true);
  assert.equal(isNewer('0.10.0', '0.9.9'), true);
  assert.equal(isNewer('1.0.0', '0.99.99'), true);
  assert.equal(isNewer('0.3.0', '0.3.0'), false);
  assert.equal(isNewer('0.2.9', '0.3.0'), false);
  for (const bad of [null, undefined, '', 'v0.3.1', '0.3', '0.3.1-beta', '0.3.1; x']) {
    assert.equal(isNewer(bad, '0.3.0'), false, String(bad));
    assert.equal(isNewer('0.3.1', bad), false, String(bad));
  }
});

test('only release numbers are checked; edge and dev builds are not', () => {
  assert.equal(isRelease('0.3.1'), true);
  for (const v of ['edge-f2be361', 'dev', '', null, undefined, 'v0.3.1', '0.3']) assert.equal(isRelease(v), false, String(v));
  assert.equal(isNewer('0.3.1', 'edge-f2be361'), false);
  assert.equal(isNewer('0.3.1', 'dev'), false);
});

test('a newer release is reported, with the request GitHub needs and nothing more', async () => {
  let seen;
  const u = createUpdateChecker({
    currentVersion: '0.3.0',
    fetchFn: async (url, opts) => {
      seen = { url, opts };
      return answer(release())();
    },
  });
  assert.equal(u.get(), null, 'nothing before the first check');
  await u.check();
  assert.deepEqual(u.get(), { latest: '0.3.1' });
  assert.equal(seen.url, 'https://api.github.com/repos/elmedico27/wgmanager/releases/latest');
  assert.equal(seen.opts.headers['User-Agent'], 'wgmanager/0.3.0');
  assert.deepEqual(Object.keys(seen.opts.headers).sort(), ['Accept', 'User-Agent', 'X-GitHub-Api-Version']);
  assert.ok(seen.opts.signal, 'has a timeout');
});

test('no notice when this app is current or ahead', async () => {
  for (const current of ['0.3.1', '0.4.0']) {
    const u = createUpdateChecker({ currentVersion: current, fetchFn: answer(release()) });
    await u.check();
    assert.equal(u.get(), null, current);
  }
});

test('drafts, prereleases and odd tags are ignored', async () => {
  for (const over of [{ draft: true }, { prerelease: true }, { tag_name: 'v0.4.0-rc1' }, { tag_name: '0.4.0' }, { tag_name: 'v9.9.9; rm -rf /' }, { tag_name: 5 }, { tag_name: undefined }]) {
    const logs = [];
    const u = createUpdateChecker({ currentVersion: '0.3.0', fetchFn: answer(release(over)), log: (l) => logs.push(l) });
    await u.check();
    assert.equal(u.get(), null, JSON.stringify(over));
  }
});

test('failures are silent to the app and logged once; the last good answer is kept', async () => {
  const logs = [];
  let mode = 'ok';
  const u = createUpdateChecker({
    currentVersion: '0.3.0',
    log: (l) => logs.push(l),
    fetchFn: async () => {
      if (mode === 'ok') return answer(release())();
      if (mode === 'down') throw new TypeError('fetch failed');
      if (mode === 'limited') return answer({ message: 'API rate limit exceeded' }, 403)();
      if (mode === 'junk') return answer('<html>nope</html>')();
      if (mode === 'huge') return answer('x'.repeat(1_000_001))();
      if (mode === 'timeout') throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    },
  });
  await u.check();
  assert.deepEqual(u.get(), { latest: '0.3.1' });
  for (const m of ['down', 'limited', 'junk', 'huge', 'timeout']) {
    mode = m;
    await u.check();
    assert.deepEqual(u.get(), { latest: '0.3.1' }, `${m} keeps the last good answer`);
  }
  assert.equal(logs.length, 1, 'only the first failure is logged');
  assert.match(logs[0], /^wgmanager: update check failed \(fetch failed\); trying again in 12 hours$/);
  mode = 'ok';
  await u.check();
  mode = 'down';
  await u.check();
  assert.equal(logs.length, 2, 'a new failure after a success is logged again');
});

test('a failure with no earlier answer shows nothing', async () => {
  const u = createUpdateChecker({ currentVersion: '0.3.0', fetchFn: async () => { throw new TypeError('fetch failed'); } });
  await u.check();
  assert.equal(u.get(), null);
});

test('checks do not overlap, and start/stop manage one timer', async () => {
  let calls = 0;
  let release_;
  const gate = new Promise((r) => (release_ = r));
  const u = createUpdateChecker({
    currentVersion: '0.3.0',
    intervalMs: 3600 * 1000,
    fetchFn: async () => {
      calls++;
      await gate;
      return answer(release())();
    },
  });
  const a = u.check();
  const b = u.check(); // ignored while the first is running
  release_();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  u.start();
  u.start(); // second start does nothing
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 2, 'start checks once, right away');
  u.stop();
});

test('UPDATE_CHECK accepts 1, 0, true and false in any case; default is off', () => {
  assert.equal(loadConfig({}).updateCheck, false);
  assert.equal(loadConfig({ UPDATE_CHECK: '' }).updateCheck, false);
  for (const v of ['1', 'true', 'TRUE', 'True', ' true ']) assert.equal(loadConfig({ UPDATE_CHECK: v }).updateCheck, true, v);
  for (const v of ['0', 'false', 'FALSE', 'False']) assert.equal(loadConfig({ UPDATE_CHECK: v }).updateCheck, false, v);
  for (const v of ['yes', 'off', '2', 'no']) assert.throws(() => loadConfig({ UPDATE_CHECK: v }), /UPDATE_CHECK must be 1, 0, true or false/, v);
});

test('onNewer is told each time a check finds a newer release, never for the same or an older one, and cannot break the check', async () => {
  const seen = [];
  const u = createUpdateChecker({ currentVersion: '0.3.0', fetchFn: answer(release({ tag_name: 'v0.3.1' })), onNewer: (v) => seen.push(v) });
  await u.check();
  await u.check();
  assert.deepEqual(seen, ['0.3.1', '0.3.1']);
  const same = [];
  await createUpdateChecker({ currentVersion: '0.3.1', fetchFn: answer(release()), onNewer: (v) => same.push(v) }).check();
  await createUpdateChecker({ currentVersion: '0.4.0', fetchFn: answer(release()), onNewer: (v) => same.push(v) }).check();
  assert.deepEqual(same, []);
  const bad = createUpdateChecker({ currentVersion: '0.3.0', fetchFn: answer(release()), onNewer: () => { throw new Error('x'); } });
  await bad.check();
  assert.deepEqual(bad.get(), { latest: '0.3.1' });
  const rej = createUpdateChecker({ currentVersion: '0.3.0', fetchFn: answer(release()), onNewer: async () => { throw new Error('x'); } });
  await rej.check();
  assert.deepEqual(rej.get(), { latest: '0.3.1' });
});
