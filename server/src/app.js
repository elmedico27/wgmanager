// Request handling: authentication, CSRF, rate limits and the /api routes the
// UI uses (listed at the top of web/src/lib/api.js). Helper answers are passed
// through unchanged; the app adds its own codes for login, SSH and identity.

import qrcode from 'qrcode-generator';
import crypto from 'node:crypto';
import { Admin, Sessions, FailureLimiter, csrfMatches, passwordProblem } from './auth.js';
import { securityHeaders, noStore, sendJson, parseCookies, readJson, serveUi, serveIndex } from './http.js';

export const PROTOCOL = 1;
const COOKIE = 'wgm_sid';
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,14}$/;
const MAX_FAILURES = 50;

// qrcode-generator's default byte conversion keeps only the low 8 bits of each
// character (`c & 0xff`), which corrupts anything non-ASCII. Encode as UTF-8.
qrcode.stringToBytes = (s) => Array.from(Buffer.from(s, 'utf8'));

export function isSafeName(name) {
  return typeof name === 'string' && NAME_RE.test(name) && !/^[0-9]+$/.test(name) && name !== 'server';
}

// HTTP status for each error code (the UI reads the JSON either way).
const STATUS = {
  invalid_request: 400, not_found: 404, exists: 409, busy: 409,
  backend_failed: 502, host_misconfigured: 502, internal: 502, bad_response: 502,
  unreachable: 502, key_refused: 502, timeout: 504, protocol_mismatch: 502,
  hostkey_unconfirmed: 409, hostkey_changed: 502, hostkey_mismatch: 409,
  unauthenticated: 401, bad_login: 401, bad_code: 401, no_password: 409, csrf: 403, rate_limited: 429,
  weak_password: 400, already_set: 409, no_route: 404, server_error: 500,
};

const err = (code, message) => ({ ok: false, error: { code, message } });

export function createApp({ cfg, store, transport, ui = new Map(), log = console.log, now = () => Date.now() }) {
  const admin = new Admin(store, log);
  const sessions = new Sessions(cfg.session, now);
  const limiter = new FailureLimiter({}, now);
  let settingUp = false;

  function clientIp(req) {
    if (cfg.trustProxy) {
      const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function isHttps(req) {
    if (req.socket.encrypted) return true;
    return cfg.trustProxy && (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  }

  function setCookie(req, res, value, maxAgeSec) {
    const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (isHttps(req)) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  function currentSession(req) {
    const rec = admin.record();
    if (!rec) return null;
    // The UI's 15 s refresh sends X-WGM-Background; it must not count as use,
    // or an open tab would never reach the 6-hour idle sign-out.
    const touch = req.headers['x-wgm-background'] !== '1';
    return sessions.get(parseCookies(req.headers.cookie)[COOKIE], rec.generation, touch);
  }

  // --- unacknowledged failure warnings (persist in the data volume) -------------

  function failures() {
    try {
      const list = store.readJson('failures.json');
      return Array.isArray(list) ? list : [];
    } catch {
      log('wgmanager: failures.json is unreadable; starting a new list');
      return [];
    }
  }

  function recordFailure(action, name, error) {
    const entry = {
      id: crypto.randomBytes(9).toString('base64url'),
      action,
      client: name,
      at: now(),
      error: {
        code: error.code,
        message: error.message,
        partial: error.partial,
        failed_checks: Array.isArray(error.failed_checks) ? error.failed_checks : undefined,
        backup: error.backup ?? null,
        backend_exit_code: error.backend_exit_code ?? null,
      },
    };
    store.writeJson('failures.json', [...failures(), entry].slice(-MAX_FAILURES));
  }

  function startSession(req, res) {
    const s = sessions.create(admin.record().generation);
    setCookie(req, res, s.id, Math.floor(cfg.session.absoluteMs / 1000));
    return s;
  }

  /** A browser sends Origin on cross-site requests; when present it must be us. */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const hosts = [req.headers.host];
    if (cfg.trustProxy && req.headers['x-forwarded-host']) hosts.push(req.headers['x-forwarded-host'].split(',')[0].trim());
    try {
      return hosts.includes(new URL(origin).host);
    } catch {
      return false;
    }
  }

  function reply(res, body) {
    sendJson(res, body.ok ? 200 : STATUS[body.error?.code] ?? 500, body);
  }

  /** Helper call with the protocol check. `version` passes through so the UI can show a mismatch. */
  async function helper(request, opts) {
    const body = await transport.call(request, opts);
    if (body.protocol !== undefined && body.protocol !== PROTOCOL && !request.startsWith('version')) {
      return err('protocol_mismatch', `helper protocol ${body.protocol}, app expects ${PROTOCOL}`);
    }
    return body;
  }

  async function mutate(res, action, name) {
    const body = await helper(name ? `${action} ${name}` : action, { mutation: true });
    const result = body.ok ? 'ok' : `error:${body.error?.code}`;
    log(`wgmanager: action=${action} client=${name ?? '-'} result=${result}`);
    // Exit 5 and our own timeout leave the outcome uncertain: keep a warning
    // every browser sees until someone acknowledges it.
    if (!body.ok && (body.error?.code === 'backend_failed' || body.error?.code === 'timeout')) {
      recordFailure(action, name, body.error);
    }
    reply(res, body);
  }

  // --- route handlers -------------------------------------------------------------

  async function handleApi(req, res, url) {
    const method = req.method;
    const ip = clientIp(req);
    let session = currentSession(req);

    // Unsafe methods: same origin, JSON only (forms cannot send it cross-site
    // without a preflight we never allow), and the CSRF token once signed in.
    if (method !== 'GET' && method !== 'HEAD') {
      if (!sameOrigin(req)) return reply(res, err('csrf', 'cross-site request refused'));
    }

    if (url === '/api/session' && method === 'GET') {
      return reply(res, {
        ok: true,
        data: { authenticated: !!session, passwordSet: admin.isSet(), csrf: session?.csrf ?? null },
      });
    }

    if (url === '/api/setup' && method === 'POST') {
      if (limiter.blocked(ip)) return reply(res, err('rate_limited', 'too many attempts'));
      const body = await readJson(req);
      if (admin.isSet() || settingUp) return reply(res, err('already_set', 'a password is already set'));
      if (!admin.checkSetupCode(body.code)) {
        limiter.fail(ip);
        log(`wgmanager: setup code rejected from ${ip}`);
        return reply(res, err('bad_code', 'wrong setup code'));
      }
      if (passwordProblem(body.password)) return reply(res, err('weak_password', 'password too short'));
      settingUp = true; // a second request arriving while this one hashes gets already_set
      try {
        await admin.setPassword(body.password);
      } finally {
        settingUp = false;
      }
      limiter.succeed(ip);
      session = startSession(req, res);
      log('wgmanager: admin password set');
      return reply(res, { ok: true, data: { authenticated: true, csrf: session.csrf } });
    }

    if (url === '/api/session' && method === 'POST') {
      if (limiter.blocked(ip)) return reply(res, err('rate_limited', 'too many attempts'));
      const body = await readJson(req);
      if (!admin.isSet()) return reply(res, err('no_password', 'no password is set; use the setup code'));
      if (!(await admin.check(body.password))) {
        limiter.fail(ip);
        log(`wgmanager: failed sign-in from ${ip}`);
        return reply(res, err('bad_login', 'wrong password'));
      }
      limiter.succeed(ip);
      if (session) sessions.destroy(session.id);
      session = startSession(req, res);
      return reply(res, { ok: true, data: { authenticated: true, csrf: session.csrf } });
    }

    // Everything below needs a session.
    if (!session) return reply(res, err('unauthenticated', 'sign in first'));
    if (method !== 'GET' && method !== 'HEAD' && !csrfMatches(session, req.headers['x-csrf-token'])) {
      return reply(res, err('csrf', 'missing or wrong CSRF token'));
    }

    if (url === '/api/session' && method === 'DELETE') {
      sessions.destroy(session.id);
      setCookie(req, res, '', 0);
      return reply(res, { ok: true, data: { authenticated: false } });
    }

    if (url === '/api/password' && method === 'POST') {
      if (limiter.blocked(ip)) return reply(res, err('rate_limited', 'too many attempts'));
      const body = await readJson(req);
      if (!(await admin.check(body.current))) {
        limiter.fail(ip);
        return reply(res, err('bad_login', 'current password is wrong'));
      }
      if (passwordProblem(body.password)) return reply(res, err('weak_password', 'password too short'));
      const rec = await admin.setPassword(body.password);
      sessions.keepOnly(session.id, rec.generation);
      log('wgmanager: admin password changed; other sessions signed out');
      return reply(res, { ok: true, data: { changed: true, otherSessionsSignedOut: true } });
    }

    if (url === '/api/settings' && method === 'GET') {
      return reply(res, {
        ok: true,
        data: { ssh: { ...cfg.ssh }, publicKey: transport.publicKey(), allowFrom: cfg.allowFrom },
      });
    }

    if (url === '/api/hostkey') {
      if (method === 'GET') return reply(res, { ok: true, data: await transport.hostKeyStatus() });
      if (method === 'POST') {
        const body = await readJson(req);
        if (typeof body.fingerprint !== 'string') return reply(res, err('invalid_request', 'fingerprint required'));
        return reply(res, await transport.pin(body.fingerprint));
      }
      if (method === 'DELETE') {
        transport.forget();
        return reply(res, { ok: true, data: { pinned: null } });
      }
    }

    if (url === '/api/failures' && method === 'GET') return reply(res, { ok: true, data: { failures: failures() } });
    const fm = url.match(/^\/api\/failures\/([A-Za-z0-9_-]{1,32})$/);
    if (fm && method === 'DELETE') {
      store.writeJson('failures.json', failures().filter((f) => f.id !== fm[1]));
      return reply(res, { ok: true, data: { acknowledged: fm[1] } });
    }

    if (url === '/api/version' && method === 'GET') return reply(res, await helper('version'));
    if (url === '/api/clients' && method === 'GET') return reply(res, await helper('list'));
    if (url === '/api/clients' && method === 'POST') {
      const body = await readJson(req);
      if (!isSafeName(body.name)) return reply(res, err('invalid_request', 'invalid client name'));
      return mutate(res, 'add', body.name);
    }

    const m = url.match(/^\/api\/clients\/([^/]+)(?:\/(enable|disable|config|qrcode\.svg|download))?$/);
    if (m) {
      let name;
      try {
        name = decodeURIComponent(m[1]);
      } catch {
        name = null;
      }
      if (!isSafeName(name)) return reply(res, err('invalid_request', 'invalid client name'));
      const sub = m[2];
      if (!sub && method === 'DELETE') return mutate(res, 'remove', name);
      if ((sub === 'enable' || sub === 'disable') && method === 'POST') return mutate(res, sub, name);
      if (sub === 'config' && method === 'GET') return reply(res, await helper(`get-config ${name}`));
      if ((sub === 'qrcode.svg' || sub === 'download') && method === 'GET') {
        const body = await helper(`get-config ${name}`);
        if (!body.ok) return reply(res, body);
        noStore(res);
        res.statusCode = 200;
        if (sub === 'download') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${name}.conf"`);
          return res.end(body.data.config);
        }
        const qr = qrcode(0, 'M');
        qr.addData(body.data.config, 'Byte');
        qr.make();
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.end(qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }));
      }
    }
    return reply(res, err('no_route', 'no such route'));
  }

  // --- entry point --------------------------------------------------------------------

  async function handle(req, res) {
    securityHeaders(res);
    const url = req.url.split('?')[0];
    try {
      if (url.startsWith('/api/')) return await handleApi(req, res, url);
      if ((req.method === 'GET' || req.method === 'HEAD') && (serveUi(ui, req, res) || serveIndex(ui, req, res))) return;
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
    } catch (e) {
      if (e && e.status) return sendJson(res, e.status, err('invalid_request', e.message));
      log(`wgmanager: server error on ${req.method} ${url}: ${e?.message}`);
      // Not the helper's `internal`: this one is the app's own fault.
      if (!res.headersSent) sendJson(res, 500, err('server_error', 'wgmanager hit an unexpected error; see its log'));
      else res.end();
    }
  }

  const timer = setInterval(() => {
    sessions.sweep();
    limiter.sweep();
  }, 10 * 60 * 1000);
  timer.unref();

  return { handle, admin, sessions };
}
