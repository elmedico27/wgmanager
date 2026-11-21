// Sends one notification to a ntfy server (settings: config.js, notes: ntfy.md in
// the project docs). It sends nothing by itself; callers decide what and when.
//
// The request is the one checked against the owner's real ntfy on 2026-11-20:
//   POST <url>/<topic>   Authorization: Bearer <token>   body = the message text
//   -> 200 {"id","time","expires","event":"message","topic","message"}
//   -> 403 {"code":40301,"http":403,"error":"forbidden","link":...} without access.
// Unverified (so not used yet): the Title, Priority and Tags headers, JSON
// publishing, and Basic auth against a real server (Basic is plain HTTP, but only
// the token path has been exercised).
//
// Never in a result or a log line: the token, the password, or the message.
// Redirects are not followed (a redirect could carry the credential to another
// host or from https to http). A failure is returned, never thrown.

const MAX_MESSAGE = 1000; // characters; ntfy's own limit is higher (about 4 KB)
const MAX_BODY = 100_000; // a publish answer is a few hundred bytes

// Newlines and tabs stay; other control characters go. Long text is cut with "...".
export function cleanMessage(text) {
  let s = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  s = s.trim();
  if (s.length > MAX_MESSAGE) s = `${s.slice(0, MAX_MESSAGE - 3)}...`;
  return s;
}

function authHeader(auth) {
  if (!auth) return null;
  if (auth.type === 'token') return `Bearer ${auth.token}`;
  return `Basic ${Buffer.from(`${auth.user}:${auth.password}`, 'latin1').toString('base64')}`;
}

// What the server called the problem, if it is short and plain: used only to make
// a failure readable ("forbidden"), never to repeat arbitrary server text.
function plainError(text) {
  try {
    const e = JSON.parse(text)?.error;
    return typeof e === 'string' && /^[A-Za-z0-9 ._-]{1,60}$/.test(e) ? e : null;
  } catch {
    return null;
  }
}

/** `ntfyCfg` is cfg.ntfy from config.js. Returns { enabled, secure, send(message) }. */
export function createNtfy(ntfyCfg, { fetchFn = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!ntfyCfg?.enabled) return { enabled: false, secure: false, send: async () => ({ ok: false, reason: 'ntfy is off' }) };
  const target = `${ntfyCfg.url}/${ntfyCfg.topic}`;
  const authorization = authHeader(ntfyCfg.auth);

  async function send(message) {
    const body = cleanMessage(message);
    if (!body) return { ok: false, reason: 'empty message' };
    try {
      const res = await fetchFn(target, {
        method: 'POST',
        headers: { ...(authorization ? { Authorization: authorization } : {}), 'Content-Type': 'text/plain; charset=utf-8' },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 300 && res.status < 400) return { ok: false, reason: `ntfy answered ${res.status}, a redirect; redirects are not followed` };
      const text = await res.text();
      if (text.length > MAX_BODY) return { ok: false, reason: 'ntfy answer too large' };
      if (!res.ok) {
        const why = plainError(text);
        return { ok: false, status: res.status, reason: `ntfy answered ${res.status}${why ? ` (${why})` : ''}` };
      }
      let answer;
      try {
        answer = JSON.parse(text);
      } catch {
        return { ok: false, status: res.status, reason: 'ntfy answered 200 but not with a message (is this a ntfy server?)' };
      }
      if (answer?.event !== 'message' || typeof answer.id !== 'string') {
        return { ok: false, status: res.status, reason: 'ntfy answered 200 but not with a message (is this a ntfy server?)' };
      }
      return { ok: true, id: answer.id };
    } catch (e) {
      // Only the kind of failure is reported; an error's own text can name the address.
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      return { ok: false, reason: timedOut ? 'ntfy did not answer in time' : 'could not reach ntfy' };
    }
  }

  return { enabled: true, secure: ntfyCfg.secure, send };
}
