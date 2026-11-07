import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  passwordCode, passwordProblem, MIN_PASSWORD, MAX_PASSWORD_BYTES, PASSWORD_TOO_SHORT, PASSWORD_TOO_LONG,
} from '../src/lib/format.js';

// These mirror server/test/app.test.js ("password length"): the UI and the server
// must agree, or the form would accept what the server refuses.

test('limits are 12 characters and 128 bytes', () => {
  assert.equal(MIN_PASSWORD, 12);
  assert.equal(MAX_PASSWORD_BYTES, 128);
});

test('minimum counts code points: an emoji is one character', () => {
  assert.equal(passwordCode('\u{1F600}'.repeat(6)), 'weak_password');
  assert.equal(passwordCode('\u{1F600}'.repeat(12)), null);
  assert.equal(passwordCode('x'.repeat(11)), 'weak_password');
  assert.equal(passwordCode('x'.repeat(12)), null);
});

test('maximum counts UTF-8 bytes', () => {
  assert.equal(passwordCode('x'.repeat(128)), null);
  assert.equal(passwordCode('x'.repeat(129)), 'password_too_long');
  assert.equal(passwordCode('\u00e9'.repeat(64)), null); // 2 bytes each, exactly 128
  assert.equal(passwordCode('\u00e9'.repeat(65)), 'password_too_long');
  assert.equal(passwordCode('\u20ac'.repeat(43)), 'password_too_long'); // 3 bytes each: 129
  assert.equal(passwordCode('\u20ac'.repeat(42)), null);
});

test('messages: nothing while empty, then short, long, mismatch', () => {
  assert.equal(passwordProblem('', ''), null);
  assert.equal(passwordProblem('short'), PASSWORD_TOO_SHORT);
  assert.equal(passwordProblem('x'.repeat(129)), PASSWORD_TOO_LONG);
  assert.match(PASSWORD_TOO_LONG, /128 bytes/);
  assert.equal(passwordProblem('x'.repeat(12), 'x'.repeat(13)), 'The two passwords do not match.');
  assert.equal(passwordProblem('x'.repeat(12), 'x'.repeat(12)), null);
});
