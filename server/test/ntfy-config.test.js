import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

// Only the settings are tested here: how NTFY_* is read and refused. Every value
// below is made up.
const on = (over = {}) => ({ NTFY_ENABLE: 'true', NTFY_URL: 'https://ntfy.example.com', NTFY_TOPIC: 'homelab', ...over });
const err = (env, re) => assert.throws(() => loadConfig(env), re);

test('ntfy is off by default, and its other settings are not read while it is off', () => {
  assert.deepEqual(loadConfig({}).ntfy, { enabled: false });
  assert.deepEqual(loadConfig({ NTFY_ENABLE: '' }).ntfy, { enabled: false });
  assert.deepEqual(loadConfig({ NTFY_ENABLE: 'false', NTFY_URL: 'not a url', NTFY_TOPIC: '!!', NTFY_TOKEN: 'a b' }).ntfy, { enabled: false });
  assert.deepEqual(loadConfig({ NTFY_URL: 'https://ntfy.example.com' }).ntfy, { enabled: false });
});

test('NTFY_ENABLE accepts 1, 0, true and false in any case, and refuses anything else', () => {
  for (const v of ['1', 'true', 'TRUE', ' True ']) assert.equal(loadConfig(on({ NTFY_ENABLE: v })).ntfy.enabled, true, v);
  for (const v of ['0', 'false', 'FALSE']) assert.equal(loadConfig(on({ NTFY_ENABLE: v })).ntfy.enabled, false, v);
  for (const v of ['yes', 'on', '2']) err(on({ NTFY_ENABLE: v }), /NTFY_ENABLE must be 1, 0, true or false/);
});

test('https address: TLS is on; path prefix kept, trailing slash dropped', () => {
  const n = loadConfig(on()).ntfy;
  assert.deepEqual(n, { enabled: true, url: 'https://ntfy.example.com', topic: 'homelab', secure: true, auth: null, on: { errors: true, updates: true } });
  assert.equal(loadConfig(on({ NTFY_URL: 'https://ntfy.example.com/' })).ntfy.url, 'https://ntfy.example.com');
  assert.equal(loadConfig(on({ NTFY_URL: ' https://example.com:8443/ntfy// ' })).ntfy.url, 'https://example.com:8443/ntfy');
});

test('http address is accepted as written, and is reported as not secure', () => {
  const n = loadConfig(on({ NTFY_URL: 'http://192.168.0.5:2586' })).ntfy;
  assert.equal(n.url, 'http://192.168.0.5:2586');
  assert.equal(n.secure, false);
  assert.equal(loadConfig(on({ NTFY_URL: 'http://[fd00::5]:2586' })).ntfy.url, 'http://[fd00::5]:2586');
});

test('NTFY_URL and NTFY_TOPIC are required when enabled', () => {
  err(on({ NTFY_URL: '' }), /NTFY_URL is required/);
  err(on({ NTFY_TOPIC: '' }), /NTFY_TOPIC is required/);
  err({ NTFY_ENABLE: 'true' }, /NTFY_URL is required/);
});

test('NTFY_URL must be a full http or https address', () => {
  for (const v of ['ntfy.example.com', 'ntfy.example.com:2586', 'localhost:2586', '192.168.0.5', 'ftp://ntfy.example.com', 'ws://x.example.com', 'https://', '//ntfy.example.com']) {
    err(on({ NTFY_URL: v }), /NTFY_URL must be a full address/);
  }
});

test('NTFY_URL may not carry credentials, a query or a fragment, and the error never repeats it', () => {
  const secret = 'hunter2-secret';
  try {
    loadConfig(on({ NTFY_URL: `https://user:${secret}@ntfy.example.com` }));
    assert.fail('should throw');
  } catch (e) {
    assert.match(e.message, /must not contain a user name or password/);
    assert.ok(!e.message.includes(secret));
  }
  err(on({ NTFY_URL: 'https://ntfy.example.com/?auth=x' }), /query/);
  err(on({ NTFY_URL: 'https://ntfy.example.com/#x' }), /fragment/);
});

test('NTFY_TOPIC: letters, digits, _ and -, up to 64', () => {
  for (const v of ['homelab', 'a', 'My_Topic-2', 'x'.repeat(64)]) assert.equal(loadConfig(on({ NTFY_TOPIC: v })).ntfy.topic, v);
  for (const v of ['a/b', 'a b', 'a?b', 'a#b', '../x', 'x'.repeat(65), 'tópico']) err(on({ NTFY_TOPIC: v }), /NTFY_TOPIC may only contain/);
});

test('token auth', () => {
  const n = loadConfig(on({ NTFY_TOKEN: 'tk_exampleexampleexample1234567890' })).ntfy;
  assert.deepEqual(n.auth, { type: 'token', token: 'tk_exampleexampleexample1234567890' });
  for (const v of ['tk_a b', 'tk_a\nX-Evil: 1', 'tk_é']) err(on({ NTFY_TOKEN: v }), /NTFY_TOKEN must be one word/);
});

test('user and password auth', () => {
  const n = loadConfig(on({ NTFY_USER: 'wgmanager', NTFY_PASSWORD: 'pass word 1!' })).ntfy;
  assert.deepEqual(n.auth, { type: 'basic', user: 'wgmanager', password: 'pass word 1!' });
  err(on({ NTFY_USER: 'wgmanager' }), /must be set together/);
  err(on({ NTFY_PASSWORD: 'x' }), /must be set together/);
  err(on({ NTFY_USER: 'a:b', NTFY_PASSWORD: 'x' }), /NTFY_USER must be/);
  err(on({ NTFY_USER: 'wgmanager', NTFY_PASSWORD: 'a\nb' }), /NTFY_PASSWORD must be/);
});

test('a token and a user together are refused; empty credential variables count as unset', () => {
  err(on({ NTFY_TOKEN: 'tk_x', NTFY_USER: 'wgmanager', NTFY_PASSWORD: 'x' }), /not both/);
  err(on({ NTFY_TOKEN: 'tk_x', NTFY_PASSWORD: 'x' }), /not both/);
  assert.equal(loadConfig(on({ NTFY_TOKEN: '', NTFY_USER: '', NTFY_PASSWORD: '' })).ntfy.auth, null);
  assert.deepEqual(loadConfig(on({ NTFY_TOKEN: 'tk_x', NTFY_USER: '', NTFY_PASSWORD: '' })).ntfy.auth, { type: 'token', token: 'tk_x' });
});

test('no credential value appears in any error message', () => {
  const secrets = ['tk_supersecrettoken', 'p4ssw0rd-secret'];
  const cases = [
    on({ NTFY_TOKEN: secrets[0], NTFY_USER: 'u', NTFY_PASSWORD: secrets[1] }),
    on({ NTFY_USER: 'a:b', NTFY_PASSWORD: secrets[1] }),
    on({ NTFY_PASSWORD: secrets[1] }),
    on({ NTFY_TOKEN: secrets[0] + ' x' }),
  ];
  for (const env of cases) {
    try {
      loadConfig(env);
      assert.fail('should throw');
    } catch (e) {
      for (const s of secrets) assert.ok(!e.message.includes(s), e.message);
    }
  }
});

test('NTFY_ON_ERRORS and NTFY_ON_UPDATES default to on, take 1/0/true/false, and are not read while ntfy is off', () => {
  assert.deepEqual(loadConfig(on()).ntfy.on, { errors: true, updates: true });
  assert.deepEqual(loadConfig(on({ NTFY_ON_ERRORS: 'false', NTFY_ON_UPDATES: '0' })).ntfy.on, { errors: false, updates: false });
  assert.deepEqual(loadConfig(on({ NTFY_ON_ERRORS: '', NTFY_ON_UPDATES: ' TRUE ' })).ntfy.on, { errors: true, updates: true });
  err(on({ NTFY_ON_ERRORS: 'sometimes' }), /NTFY_ON_ERRORS must be 1, 0, true or false/);
  err(on({ NTFY_ON_UPDATES: 'no' }), /NTFY_ON_UPDATES must be 1, 0, true or false/);
  assert.deepEqual(loadConfig({ NTFY_ON_ERRORS: 'sometimes' }).ntfy, { enabled: false });
});
