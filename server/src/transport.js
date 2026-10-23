// How the app reaches the host helper.
//
// SshTransport runs the system `ssh` client with execFile (never a shell). The
// request string ("list", "add Bob_Phone") is the remote command; sshd's
// ForceCommand ignores it and hands it to the helper as SSH_ORIGINAL_COMMAND.
// Verified against OpenSSH 10.0p2 manuals (ssh(1), ssh_config(5), sshd(8),
// ssh-keyscan(1)) and a local sshd with a ForceCommand (2026-10-22):
// - `-F none` reads no config files; StrictHostKeyChecking=yes with our own
//   UserKnownHostsFile refuses unknown or changed host keys.
// - ssh exits with the remote command's status, or 255 on its own errors
//   (refused connection, unknown/changed host key, rejected client key).
//   The helper never exits 255.
// - `ssh-keyscan -t ed25519 -p PORT HOST` prints "[HOST]:PORT ssh-ed25519 KEY"
//   (plain "HOST ..." on port 22); comments go to stderr.
// - OpenSSH's SHA256 fingerprint is base64(sha256(key blob)) without padding,
//   checked against `ssh-keygen -lf`.
//
// Connection reuse (OpenSSH multiplexing): the first call opens one SSH
// connection that stays in the background for 5 minutes after the last use,
// and every call rides on it as a new session. On a sshd with PAM, 20 calls
// went from 20 logins and ~140 log lines to 1 login and 4 lines, and each call
// from ~250 ms to ~10 ms (lab, 2026-10-22). Checked: the backgrounded master
// sends its stdio to /dev/null before detaching (ssh.c control_persist_detach,
// 10.0p2), so execFile does not hang; ControlPath must stay under the 108-byte
// Unix socket limit and in a directory only we can write (ssh_config(5));
// %C is a hash of local host, host, port and user. Failures recover by
// themselves: a connection closed by the server or a killed master just leads
// to a new connection on the next call; a silently hung connection is dropped
// by ServerAlive (5 s x 2) and the call falls back to a fresh connection
// (lab: ~15 s, inside the 20 s read timeout); above sshd's MaxSessions
// (default 10) ssh falls back to separate connections. We still run at most
// MAX_PARALLEL calls at once.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const KEY_FILE = 'ssh/id_ed25519';
const MAX_PARALLEL = 4;
const PERSIST_SECONDS = 300;
const SSH_ENV = (home) => ({ PATH: '/usr/sbin:/usr/bin:/sbin:/bin', HOME: home, LC_ALL: 'C' });

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024, killSignal: 'SIGKILL', ...opts }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr, code: error ? (typeof error.code === 'number' ? error.code : null) : 0 });
    });
  });
}

export function fingerprint(base64Key) {
  return 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('base64').replace(/=+$/, '');
}

function knownHostsName(host, port) {
  return port === 22 ? host : `[${host}]:${port}`;
}

const appError = (code, message) => ({ ok: false, error: { code, message } });

export class SshTransport {
  constructor(cfg, store, log = console.log) {
    this.cfg = cfg;
    this.store = store;
    this.log = log;
    this.controlDir = cfg.controlDir;
    this.active = 0;
    this.waiting = [];
  }

  /** Options that make every call share one background connection. */
  muxOptions() {
    if (!this.controlDir) return ['-o', 'ControlPath=none'];
    return [
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${this.controlDir}/%C`,
      '-o', `ControlPersist=${PERSIST_SECONDS}`,
      '-o', 'ServerAliveInterval=5',
      '-o', 'ServerAliveCountMax=2',
    ];
  }

  /** Close the shared connection (after the server identity changes). */
  async closeShared() {
    if (!this.controlDir) return;
    const { host, port, user } = this.cfg.ssh;
    await run('ssh', ['-F', 'none', '-o', `ControlPath=${this.controlDir}/%C`, '-O', 'exit', '-p', String(port), '-l', user, host], {
      env: SSH_ENV(this.store.dir),
      timeout: 5000,
    });
  }

  async slot() {
    if (this.active < MAX_PARALLEL) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.waiting.push(resolve));
  }

  release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }

  /** Generate the app's own keypair on first start. */
  async init() {
    const key = this.store.p(KEY_FILE);
    if (!fs.existsSync(key)) {
      const r = await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'wgmanager@container', '-f', key], {
        env: SSH_ENV(this.store.dir),
        timeout: 15000,
      });
      if (r.error) throw new Error('could not create the app SSH key: ssh-keygen failed');
      this.log('wgmanager: created the app SSH key');
    }
    if (this.controlDir) {
      // Socket paths are limited to 108 bytes; %C adds 40 characters.
      if (this.controlDir.length > 60) {
        this.log(`wgmanager: SSH_CONTROL_DIR is too long for a socket path; connection reuse is off`);
        this.controlDir = null;
      } else {
        fs.mkdirSync(this.controlDir, { recursive: true, mode: 0o700 });
        fs.chmodSync(this.controlDir, 0o700);
      }
    }
  }

  publicKey() {
    return fs.readFileSync(this.store.p(KEY_FILE + '.pub'), 'utf8').trim();
  }

  /** The host key the server offers right now, or null if unreachable. */
  async scan() {
    const { host, port } = this.cfg.ssh;
    const r = await run('ssh-keyscan', ['-t', 'ed25519', '-T', String(this.cfg.timeouts.connectSec), '-p', String(port), host], {
      env: SSH_ENV(this.store.dir),
      timeout: (this.cfg.timeouts.connectSec + 5) * 1000,
    });
    for (const line of (r.stdout || '').split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3 && parts[1] === 'ssh-ed25519' && /^[A-Za-z0-9+/]+=*$/.test(parts[2])) {
        return { type: 'ED25519', keyType: parts[1], key: parts[2], fingerprint: fingerprint(parts[2]) };
      }
    }
    return null;
  }

  /** The confirmed host key for the configured host and port, or null. */
  pinned() {
    let rec;
    try {
      rec = this.store.readJson('hostkey.json');
    } catch {
      this.log("wgmanager: hostkey.json is damaged; the server's identity must be confirmed again");
      return null;
    }
    const { host, port } = this.cfg.ssh;
    if (!rec || rec.host !== host || rec.port !== port) return null;
    return rec;
  }

  async pin(expectedFingerprint) {
    const offered = await this.scan();
    if (!offered) return appError('unreachable', 'the server did not answer');
    if (offered.fingerprint !== expectedFingerprint) return appError('hostkey_mismatch', 'the server key changed while confirming');
    const { host, port } = this.cfg.ssh;
    const rec = { host, port, type: offered.type, keyType: offered.keyType, key: offered.key, fingerprint: offered.fingerprint, at: Date.now() };
    await this.closeShared(); // never reuse a connection made under a previous identity
    this.store.write('known_hosts', `${knownHostsName(host, port)} ${offered.keyType} ${offered.key}\n`);
    this.store.writeJson('hostkey.json', rec);
    this.log(`wgmanager: server identity confirmed ${offered.fingerprint}`);
    return { ok: true, data: { pinned: publicPin(rec) } };
  }

  forget() {
    this.closeShared();
    this.store.remove('hostkey.json');
    this.store.remove('known_hosts');
    this.log('wgmanager: server identity forgotten');
  }

  async hostKeyStatus() {
    const pinned = this.pinned();
    const offered = await this.scan();
    return {
      pinned: pinned ? publicPin(pinned) : null,
      offered: offered ? { fingerprint: offered.fingerprint, type: offered.type } : null,
    };
  }

  /** Run one helper request. Resolves to the helper's JSON or an app error envelope. */
  async call(request, { mutation = false } = {}) {
    const pinned = this.pinned();
    if (!pinned) return appError('hostkey_unconfirmed', "confirm the server's identity first");
    const { host, port, user } = this.cfg.ssh;
    const args = [
      '-F', 'none',
      '-T',
      '-i', this.store.p(KEY_FILE),
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${this.store.p('known_hosts')}`,
      '-o', 'GlobalKnownHostsFile=/dev/null',
      '-o', `HostKeyAlgorithms=${pinned.keyType}`,
      '-o', 'UpdateHostKeys=no',
      '-o', `ConnectTimeout=${this.cfg.timeouts.connectSec}`,
      '-o', 'LogLevel=ERROR',
      ...this.muxOptions(),
      '-p', String(port),
      '-l', user,
      host,
      '--',
      request,
    ];
    const timeout = mutation ? this.cfg.timeouts.mutationMs : this.cfg.timeouts.readMs;
    await this.slot();
    let r;
    try {
      r = await run('ssh', args, { env: SSH_ENV(this.store.dir), timeout });
    } finally {
      this.release();
    }

    if (r.error && typeof r.error.code === 'string') {
      // ENOENT (no ssh in the image), output over 1 MiB, and similar: our fault, not the helper's.
      this.log(`wgmanager: could not run ssh: ${r.error.code}`);
      return appError('server_error', `could not run ssh (${r.error.code})`);
    }
    if (r.error && r.error.killed) {
      return appError('timeout', `no answer from the host within ${Math.round(timeout / 1000)} seconds`);
    }
    if (r.code === 255) return this.diagnose();
    return parseHelperOutput(r.stdout);
  }

  /** ssh itself failed: find out whether the server is down, impersonated, or refusing our key. */
  async diagnose() {
    const offered = await this.scan();
    if (!offered) return appError('unreachable', 'the server did not answer on the SSH port');
    const pinned = this.pinned();
    if (pinned && offered.fingerprint !== pinned.fingerprint) {
      this.log(`wgmanager: SERVER IDENTITY CHANGED: expected ${pinned.fingerprint}, got ${offered.fingerprint}; nothing was sent`);
      return appError('hostkey_changed', 'the server presented a different host key');
    }
    return appError('key_refused', "the server refused the app's key");
  }
}

function publicPin(rec) {
  return { fingerprint: rec.fingerprint, type: rec.type, at: rec.at };
}

export function parseHelperOutput(stdout) {
  const line = (stdout || '').trim();
  let body;
  try {
    body = JSON.parse(line);
  } catch {
    return appError('bad_response', 'the helper sent something that is not JSON');
  }
  if (!body || typeof body !== 'object' || typeof body.ok !== 'boolean' || typeof body.protocol !== 'number') {
    return appError('bad_response', 'the helper sent an unexpected answer');
  }
  return body;
}

// --- mock mode (development and tests only) -----------------------------------------

export class MockTransport {
  constructor(cfg, mock, { delayMs = 1500 } = {}) {
    this.cfg = cfg;
    this.mock = mock;
    mock.scenarios.mutationDelayMs = delayMs;
    this.fake = { fingerprint: 'SHA256:mockmockmockmockmockmockmockmockmockmockmoc', type: 'ED25519', at: Date.now() };
  }
  async init() {}
  publicKey() {
    return 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockMockMockMockMockMockMockMockMockMockMo wgmanager@mock';
  }
  pinned() {
    return this.fake;
  }
  async pin() {
    return { ok: true, data: { pinned: this.fake } };
  }
  forget() {}
  async hostKeyStatus() {
    return { pinned: this.fake, offered: { fingerprint: this.fake.fingerprint, type: 'ED25519' } };
  }
  async call(request) {
    return (await this.mock.run(request)).body;
  }
}
