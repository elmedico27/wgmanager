// Background check of the VPN server, for ntfy notifications only (ntfy.md in the
// project docs, phase B). The web UI notices host problems and an outdated helper
// by polling; the server does not, so without this a notification could only come
// while a browser tab is open. It runs only when ntfy is on and a kind that needs
// it is wanted, and it makes the same two read-only requests the UI makes:
// `version`, and `list` (which is what reveals a misconfigured host). Neither is
// logged by the helper (only add, remove, enable, disable and get-config are).
//
// Each check ends in one of two states: fine, or a problem of some class. A
// problem is announced once, after it has been seen on two checks in a row (one
// at once for a changed server identity), and a recovery is announced once, only
// if a problem had been announced (even if it changed class since). A busy answer (a change in progress holds the
// lock) is ignored. State is kept in memory only: after a restart a problem that
// is still there is announced again.

import { PROTOCOL } from './app.js';

export const CHECK_INTERVAL_MS = 60_000;
const FIRST_CHECK_DELAY_MS = 20_000;

// What the helper or the transport reports, grouped by what the user should do.
const CLASS_OF = {
  hostkey_changed: 'identity',
  hostkey_unconfirmed: 'setup',
  key_refused: 'setup',
  protocol_mismatch: 'protocol',
  host_misconfigured: 'misconfigured',
  busy: 'busy',
  unreachable: 'unreachable',
  timeout: 'unreachable',
  bad_response: 'unreachable',
  server_error: 'unreachable',
  // `internal` (helper exit 10) means the helper was reached and failed
  // unexpectedly, so it is not "can't reach": it falls through to 'other'.
};
const classify = (code) => CLASS_OF[code] ?? 'other';

// Same rule as versionOlder in web/src/lib/format.js: three plain numbers, else false.
export function versionOlder(a, b) {
  const parse = (v) => (typeof v === 'string' && /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/.test(v) ? v.split('.').map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}

/**
 * @param call          sends one helper request, like the app does (app.helper); resolves to the helper's JSON or an error envelope
 * @param notifier      from notify.js (hostProblem, hostRecovered, helperUpdate)
 * @param on            cfg.ntfy.on
 * @param bundledHelper the helper version this image ships, or null
 */
export function createMonitor({ call, notifier, on, bundledHelper = null, log = () => {}, intervalMs = CHECK_INTERVAL_MS, firstDelayMs = FIRST_CHECK_DELAY_MS }) {
  let state = { cls: null, count: 0, notified: false };
  // True from the first problem notice until the recovery notice. Kept apart from
  // `state`, which resets when the problem changes class, so a problem that changes
  // class before it clears still gets its recovery notice.
  let announced = false;
  let running = false;
  let timer = null;
  let first = null;

  async function probe() {
    const v = await call('version');
    if (!v?.ok) return { cls: classify(v?.error?.code) };
    if ((v.data?.protocol ?? v.protocol) !== PROTOCOL) return { cls: 'protocol' };
    if (on.errors) {
      const l = await call('list');
      if (!l?.ok) return { cls: classify(l?.error?.code) };
    }
    return { cls: null, helper: v.data?.helper_version };
  }

  async function check() {
    if (running) return;
    running = true;
    try {
      const { cls, helper } = await probe();
      if (cls === 'busy') return;
      if (cls) {
        if (!on.errors) return;
        if (state.cls !== cls) state = { cls, count: 0, notified: false };
        state.count++;
        if (!state.notified && state.count >= (cls === 'identity' ? 1 : 2)) {
          state.notified = true;
          announced = true;
          await notifier.hostProblem(cls);
        }
        return;
      }
      state = { cls: null, count: 0, notified: false };
      if (announced) {
        announced = false;
        await notifier.hostRecovered();
      }
      if (on.updates && bundledHelper && versionOlder(helper, bundledHelper)) await notifier.helperUpdate(bundledHelper);
    } catch (e) {
      log(`wgmanager: ntfy: status check error (${e?.name ?? 'error'})`);
    } finally {
      running = false;
    }
  }

  return {
    check,
    start() {
      if (timer) return;
      first = setTimeout(check, firstDelayMs);
      timer = setInterval(check, intervalMs);
      first.unref?.();
      timer.unref?.();
    },
    stop() {
      clearTimeout(first);
      clearInterval(timer);
      first = null;
      timer = null;
    },
  };
}
