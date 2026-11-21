import test from 'node:test';
import assert from 'node:assert/strict';
import { createNtfy, cleanMessage } from '../src/ntfy.js';
import { loadConfig } from '../src/config.js';

// Shapes copied from the owner's real ntfy (2026-11-20), with made-up values:
// a 200 with id/time/expires/event/topic/message, and a 403 with code/http/error/link.
const OK = { id: 'AbC123xYz0pQ', time: 1700000000, expires: 1702592000, event: 'message', topic: 'homelab', message: 'hello' };
const FORBIDDEN = { code: 40301, http: 403, error: 'forbidden', link: 'https://ntfy.sh/docs/publish/#authentication' };
const answer = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const cfgFor = (over = {}) => loadConfig({ NTFY_ENABLE: 'true', NTFY_URL: 'http://192.168.0.5:2586', NTFY_TOPIC: 'homelab', NTFY_TOKEN: 'tk_exampleexampleexample1234567890', ...over }).ntfy;

test('off: sends nothing', async () => {
  let called = false;
  const n = createNtfy({ enabled: false }, { fetchFn: async () => { called = true; } });
  assert.equal(n.enabled, false);
  assert.deepEqual(await n.send('x'), { ok: false, reason: 'ntfy is off' });
  assert.equal(called, false);
});

test('sends the verified request: POST to <url>/<topic>, bearer token, plain-text body, no redirects', async () => {
  let seen;
  const n = createNtfy(cfgFor(), { fetchFn: async (url, init) => { seen = { url, init }; return answer(OK)(); } });
  const r = await n.send('test from wgmanager');
  assert.deepEqual(r, { ok: true, id: 'AbC123xYz0pQ' });
  assert.equal(seen.url, 'http://192.168.0.5:2586/homelab');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.body, 'test from wgmanager');
  assert.equal(seen.init.redirect, 'manual');
  assert.equal(seen.init.headers.Authorization, 'Bearer tk_exampleexampleexample1234567890');
  assert.ok(seen.init.signal);
});

test('a path prefix is kept; no auth means no Authorization header; basic auth is user:password in base64', async () => {
  let seen;
  const f = async (url, init) => { seen = { url, init }; return answer(OK)(); };
  await createNtfy(cfgFor({ NTFY_URL: 'https://example.com/ntfy/', NTFY_TOKEN: '' }), { fetchFn: f }).send('x');
  assert.equal(seen.url, 'https://example.com/ntfy/homelab');
  assert.equal('Authorization' in seen.init.headers, false);
  await createNtfy(cfgFor({ NTFY_TOKEN: '', NTFY_USER: 'wgmanager', NTFY_PASSWORD: 'pass word 1!' }), { fetchFn: f }).send('x');
  assert.equal(seen.init.headers.Authorization, `Basic ${Buffer.from('wgmanager:pass word 1!').toString('base64')}`);
});

test('the real 403 becomes a readable failure without the credential', async () => {
  const n = createNtfy(cfgFor(), { fetchFn: answer(FORBIDDEN, 403) });
  const r = await n.send('x');
  assert.deepEqual(r, { ok: false, status: 403, reason: 'ntfy answered 403 (forbidden)' });
});

test('odd error text from the server is not repeated', async () => {
  const n = createNtfy(cfgFor(), { fetchFn: answer({ error: 'tk_exampleexampleexample1234567890 <script>' }, 500) });
  const r = await n.send('x');
  assert.equal(r.reason, 'ntfy answered 500');
  const m = createNtfy(cfgFor(), { fetchFn: answer('not json at all', 502) });
  assert.equal((await m.send('x')).reason, 'ntfy answered 502');
});

test('redirects, non-ntfy answers and oversized answers are failures', async () => {
  assert.match((await createNtfy(cfgFor(), { fetchFn: answer('', 302) }).send('x')).reason, /redirect/);
  assert.match((await createNtfy(cfgFor(), { fetchFn: answer('<html>hi</html>') }).send('x')).reason, /not with a message/);
  assert.match((await createNtfy(cfgFor(), { fetchFn: answer({ event: 'open', id: 'a' }) }).send('x')).reason, /not with a message/);
  assert.match((await createNtfy(cfgFor(), { fetchFn: answer('x'.repeat(200_000)) }).send('x')).reason, /too large/);
});

test('network failures and timeouts are returned, never thrown, and never name the address or credential', async () => {
  const boom = async () => { throw new Error('connect ECONNREFUSED 192.168.0.5:2586 tk_exampleexampleexample1234567890'); };
  const r = await createNtfy(cfgFor(), { fetchFn: boom }).send('x');
  assert.deepEqual(r, { ok: false, reason: 'could not reach ntfy' });
  const slow = async (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  const keepAlive = setTimeout(() => {}, 2000); // AbortSignal.timeout's own timer does not keep the process alive
  const t = await createNtfy(cfgFor(), { fetchFn: slow, timeoutMs: 20 }).send('x');
  clearTimeout(keepAlive);
  assert.deepEqual(t, { ok: false, reason: 'ntfy did not answer in time' });
});

test('messages are cleaned: control characters out, newlines kept, long text cut, empty refused', async () => {
  assert.equal(cleanMessage('a\r\nb\u0000c\u001b[31m\td'), 'a\nbc[31m\td');
  assert.equal(cleanMessage('x'.repeat(2000)).length, 1000);
  assert.ok(cleanMessage('x'.repeat(2000)).endsWith('...'));
  let called = false;
  const n = createNtfy(cfgFor(), { fetchFn: async () => { called = true; return answer(OK)(); } });
  assert.deepEqual(await n.send('  \n '), { ok: false, reason: 'empty message' });
  assert.equal(called, false);
});

test('the sender reports whether TLS is in use', () => {
  assert.equal(createNtfy(cfgFor()).secure, false);
  assert.equal(createNtfy(cfgFor({ NTFY_URL: 'https://ntfy.example.com' })).secure, true);
});
