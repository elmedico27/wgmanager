// Admin password, first-run setup code, sessions, CSRF tokens and rate limits.
//
// Password: scrypt from node:crypto (no native dependency). Parameters follow
// the OWASP Password Storage Cheat Sheet's scrypt table: N=2^16, r=8, p=2
// (64 MiB), listed there as equivalent to N=2^17, r=8, p=1 with half the RAM.
// The hash lives in admin.json in the data volume, never in the environment.
//
// Setup code: while no password exists, a one-time code is kept in
// setup-code (0600) and printed to the container log. Only someone who can
// read the log (that is, who controls the server) can set the first password.

import crypto from 'node:crypto';

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 1024;
const SCRYPT = { N: 2 ** 16, r: 8, p: 2, keylen: 32 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
// Crockford base32 without I, L, O, U: easy to read off a terminal.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// --- password hashing ---------------------------------------------------------

// One scrypt at a time, so parallel login attempts cannot pile up memory.
let chain = Promise.resolve();
function scrypt(password, salt, params) {
  const run = () =>
    new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM }, (err, key) =>
        err ? reject(err) : resolve(key),
      );
    });
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return {
    algorithm: 'scrypt',
    params: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keylen: SCRYPT.keylen },
    salt: salt.toString('base64'),
    hash: key.toString('base64'),
  };
}

export async function verifyPassword(password, record) {
  if (!record || record.algorithm !== 'scrypt') return false;
  const expected = Buffer.from(record.hash, 'base64');
  const key = await scrypt(password, Buffer.from(record.salt, 'base64'), record.params);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return 'weak_password';
  if (pw.length > MAX_PASSWORD) return 'weak_password';
  return null;
}

// --- admin record and setup code -------------------------------------------------

export class Admin {
  constructor(store, log = console.log) {
    this.store = store;
    this.log = log;
    this.cache = { mtime: undefined, record: null };
  }

  /** The current admin record, re-read when the file changes (the reset CLI runs in another process). */
  record() {
    const mtime = this.store.mtime('admin.json');
    if (mtime !== this.cache.mtime) {
      let record = null;
      if (mtime !== null) {
        try {
          record = this.store.readJson('admin.json');
          if (!record || typeof record.hash !== 'string' || typeof record.generation !== 'string') throw new Error('incomplete');
        } catch {
          // Locked rather than open: nobody can sign in until the reset
          // command writes a fresh setup code.
          this.log('wgmanager: admin.json is damaged; sign-in is disabled. Run the reset-password command.');
          record = { broken: true, generation: 'broken' };
        }
      }
      this.cache = { mtime, record };
    }
    return this.cache.record;
  }

  isSet() {
    return this.record() !== null;
  }

  /** Make sure a setup code exists while no password is set, and print it. */
  announceSetupCode() {
    if (this.isSet()) return null;
    let code = this.store.read('setup-code')?.trim();
    if (!code) {
      code = newSetupCode();
      this.store.write('setup-code', code + '\n');
    }
    this.log(
      [
        '',
        '============================================================',
        ' wgmanager has no admin password yet.',
        ` Setup code: ${code}`,
        ' Open the web UI and enter this code to choose the password.',
        '============================================================',
        '',
      ].join('\n'),
    );
    return code;
  }

  checkSetupCode(given) {
    const stored = this.store.read('setup-code');
    if (!stored || typeof given !== 'string') return false;
    const a = Buffer.from(normalizeCode(stored));
    const b = Buffer.from(normalizeCode(given));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async setPassword(password) {
    const rec = await hashPassword(password);
    // Random, not a counter: after a reset and a new setup, sessions from before
    // the reset must not become valid again.
    rec.generation = crypto.randomBytes(12).toString('hex');
    rec.changedAt = new Date().toISOString();
    this.store.writeJson('admin.json', rec);
    this.store.remove('setup-code');
    return rec;
  }

  async check(password) {
    const rec = this.record();
    if (!rec || rec.broken || typeof password !== 'string' || password.length > MAX_PASSWORD) return false;
    return verifyPassword(password, rec);
  }

  /** Used by the reset CLI: forget the password and issue a new setup code. */
  reset() {
    this.store.remove('admin.json');
    const code = newSetupCode();
    this.store.write('setup-code', code + '\n');
    return code;
  }
}

export function newSetupCode() {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b & 31];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`; // 60 bits
}

function normalizeCode(c) {
  return c
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

// --- sessions ----------------------------------------------------------------------

export class Sessions {
  constructor({ idleMs, absoluteMs }, now = () => Date.now()) {
    this.idleMs = idleMs;
    this.absoluteMs = absoluteMs;
    this.now = now;
    this.map = new Map();
  }

  create(generation) {
    const id = crypto.randomBytes(32).toString('base64url');
    const t = this.now();
    const s = { id, created: t, seen: t, csrf: crypto.randomBytes(32).toString('base64url'), generation };
    this.map.set(id, s);
    return s;
  }

  /** Returns the live session for an id, or null. `touch` (default) counts the request as use. */
  get(id, generation, touch = true) {
    if (!id) return null;
    const s = this.map.get(id);
    if (!s) return null;
    const t = this.now();
    if (t - s.seen > this.idleMs || t - s.created > this.absoluteMs || s.generation !== generation) {
      this.map.delete(id);
      return null;
    }
    if (touch) s.seen = t;
    return s;
  }

  destroy(id) {
    this.map.delete(id);
  }

  /** After a password change: keep only the session that made the change. */
  keepOnly(id, generation) {
    for (const key of this.map.keys()) if (key !== id) this.map.delete(key);
    const s = this.map.get(id);
    if (s) s.generation = generation;
  }

  sweep() {
    const t = this.now();
    for (const [id, s] of this.map) {
      if (t - s.seen > this.idleMs || t - s.created > this.absoluteMs) this.map.delete(id);
    }
  }
}

export function csrfMatches(session, header) {
  if (!session || typeof header !== 'string') return false;
  const a = Buffer.from(session.csrf);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- rate limiting -------------------------------------------------------------------

/** Counts failed attempts per client address and overall, in a sliding window. */
export class FailureLimiter {
  // perIp stops guessing from one machine; the global cap is high so that
  // someone else on the network cannot keep the admin locked out for long.
  constructor({ perIp = 5, global = 100, windowMs = 15 * 60 * 1000 } = {}, now = () => Date.now()) {
    Object.assign(this, { perIp, global, windowMs, now });
    this.byIp = new Map();
    this.all = [];
  }

  prune(list) {
    const cutoff = this.now() - this.windowMs;
    while (list.length && list[0] < cutoff) list.shift();
    return list;
  }

  blocked(ip) {
    const mine = this.prune(this.byIp.get(ip) ?? []);
    return mine.length >= this.perIp || this.prune(this.all).length >= this.global;
  }

  fail(ip) {
    const t = this.now();
    const mine = this.byIp.get(ip) ?? [];
    mine.push(t);
    this.byIp.set(ip, mine);
    this.all.push(t);
  }

  succeed(ip) {
    this.byIp.delete(ip);
  }

  sweep() {
    for (const [ip, list] of this.byIp) if (!this.prune(list).length) this.byIp.delete(ip);
    this.prune(this.all);
  }
}
