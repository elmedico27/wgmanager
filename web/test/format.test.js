import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientState, connection, handshakeTime, SESSION_WINDOW } from '../src/lib/format.js';

const NOW = 1_800_000_000;
const base = { manageable: true, enabled: true, live: true, latest_handshake: NOW - 41 };

test('a handshake under 180 s old is connected', () => {
  assert.equal(clientState(base, true, NOW), 'connected');
  assert.equal(clientState({ ...base, latest_handshake: NOW - (SESSION_WINDOW - 1) }, true, NOW), 'connected');
});

test('an old or missing handshake is idle', () => {
  assert.equal(clientState({ ...base, latest_handshake: NOW - SESSION_WINDOW }, true, NOW), 'idle');
  assert.equal(clientState({ ...base, latest_handshake: NOW - 3 * 3600 }, true, NOW), 'idle');
  assert.equal(clientState({ ...base, latest_handshake: 0 }, true, NOW), 'idle');
});

test('disabled, attention and read-only come before the handshake is looked at', () => {
  assert.equal(clientState({ ...base, enabled: false, live: false, latest_handshake: 0 }, true, NOW), 'off');
  assert.equal(clientState({ ...base, live: false }, true, NOW), 'attention'); // enabled but not on the interface
  assert.equal(clientState({ ...base, enabled: null }, true, NOW), 'attention'); // no entry in the server config
  assert.equal(clientState({ ...base, enabled: false }, true, NOW), 'attention'); // disabled but still on the interface
  assert.equal(clientState({ ...base, manageable: false }, true, NOW), 'readonly');
});

test('the meter fills as the session ages and is full at 180 s', () => {
  assert.equal(connection({ ...base, latest_handshake: NOW }, NOW).elapsed, 0);
  assert.equal(connection({ ...base, latest_handshake: NOW - 90 }, NOW).elapsed, 0.5);
  assert.equal(connection({ ...base, latest_handshake: NOW - 500 }, NOW).elapsed, 1);
  assert.equal(connection({ ...base, latest_handshake: NOW + 30 }, NOW).elapsed, 0); // clocks can disagree
});

test('the last-seen text, and nothing for a client that is not live', () => {
  assert.equal(connection(base, NOW).text, 'Last seen 41 s ago');
  assert.equal(connection({ ...base, latest_handshake: 0 }, NOW).text, 'Not seen since the interface started');
  assert.equal(connection({ ...base, live: false }, NOW), null);
});

test('the hover time names the handshake, and is absent when there is none', () => {
  assert.match(handshakeTime(NOW), /^Last handshake: /);
  assert.equal(handshakeTime(0), undefined);
});
