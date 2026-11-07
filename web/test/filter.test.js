import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterClients, matchesClient, normalizeQuery } from '../src/lib/filter.js';

const KEY = (ch) => ch.repeat(43) + '=';
const clients = [
  { name: 'Alice_Phone', address: '10.0.0.2', public_key: KEY('A') },
  { name: 'Bob_Laptop', address: '10.0.0.12', public_key: KEY('B') },
  { name: 'Guest_Tablet', address: '10.0.1.7', public_key: KEY('C') },
];
const notes = { [KEY('B')]: 'Work laptop\nReplace in spring' };
const names = (q) => filterClients(clients, q, notes).map((c) => c.name);

test('empty or blank text shows everything, same array', () => {
  assert.equal(filterClients(clients, '', notes), clients);
  assert.equal(filterClients(clients, '   ', notes), clients);
  assert.equal(filterClients(clients, undefined, notes), clients);
});

test('matches name, case-insensitive substring', () => {
  assert.deepEqual(names('phone'), ['Alice_Phone']);
  assert.deepEqual(names('ALICE'), ['Alice_Phone']);
  assert.deepEqual(names('_'), ['Alice_Phone', 'Bob_Laptop', 'Guest_Tablet']);
});

test('matches address as text', () => {
  assert.deepEqual(names('10.0.1.'), ['Guest_Tablet']);
  assert.deepEqual(names('0.0.1'), ['Bob_Laptop', 'Guest_Tablet']); // substring: 10.0.0.12 contains it
});

test('matches note text, including later lines', () => {
  assert.deepEqual(names('spring'), ['Bob_Laptop']);
  assert.deepEqual(names('work'), ['Bob_Laptop']);
});

test('surrounding spaces are ignored; inner text is not', () => {
  assert.deepEqual(names('  laptop  '), ['Bob_Laptop']);
  assert.deepEqual(names('work laptop'), ['Bob_Laptop']);
  assert.deepEqual(names('worklaptop'), []);
});

test('no match, missing notes, missing fields', () => {
  assert.deepEqual(names('zzz'), []);
  assert.equal(matchesClient(clients[0], 'alice', undefined), true);
  assert.equal(matchesClient({ name: 'X', address: null, public_key: null }, 'x', {}), true);
  assert.equal(normalizeQuery(' AbC '), 'abc');
});
