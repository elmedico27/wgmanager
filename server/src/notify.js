// Decides what to send to ntfy and when (the sending itself is ntfy.js; settings
// are in config.js; notes in ntfy.md of the project docs).
//
// Messages are generic on purpose: no client names, keys or addresses leave the
// server, because they pass through the ntfy server (and for iOS push, ntfy.sh's
// relay). The details are in the web UI.
//
// Nothing here throws or waits for the caller: a failed send is logged once per
// kind of problem and otherwise ignored.

const MAX_FAILURE_NOTICES_PER_HOUR = 5;
const MAX_HOST_NOTICES_PER_HOUR = 6; // problems and recoveries together
const STATE_FILE = 'ntfy-state.json'; // { appUpdate: "x.y.z", helperUpdate: "x.y.z" }: the releases already announced
const VERSION_RE = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/;

export const TEXT = {
  failure: 'WG Manager: a change to a client may be incomplete. Open WG Manager to see what to check.',
  appUpdate: (v) => `WG Manager: version ${v} is available.`,
  helperUpdate: (v) => `WG Manager: a helper update (${v}) is available for your VPN server. Open WG Manager for the update command.`,
  host: {
    identity: "WG Manager: your VPN server's identity changed. Open WG Manager before making any changes.",
    setup: "WG Manager: can't sign in to your VPN server. Open WG Manager for the fix.",
    protocol: "WG Manager: the helper on your VPN server doesn't match this version. Open WG Manager for the fix.",
    misconfigured: "WG Manager: your VPN server's setup has a problem. Open WG Manager for the fix.",
    unreachable: "WG Manager: can't reach your VPN server.",
    other: 'WG Manager: there is a problem with the connection to your VPN server. Open WG Manager for details.',
  },
  hostRecovered: 'WG Manager: the connection to your VPN server is working again.',
  test: 'WG Manager: test notification. If you can read this, notifications work.',
};

/**
 * @param ntfy  the sender from createNtfy (ntfy.js)
 * @param on    cfg.ntfy.on: which kinds of notification are wanted ({ errors, updates })
 * @param store the data-volume Store (only the "already announced" state is kept there)
 */
export function createNotifier({ ntfy, on, store, log = () => {}, now = () => Date.now() }) {
  let lastProblem = null; // why the last send failed; logged once until a send works again
  const recent = new Map(); // kind -> times of the notices sent in the last hour
  const capLogged = new Set();

  // At most `max` notices of one kind an hour; the first one over is logged, the rest are silent.
  function allow(kind, max) {
    const t = now();
    const times = (recent.get(kind) ?? []).filter((x) => t - x < 3600_000);
    recent.set(kind, times);
    if (times.length >= max) {
      if (!capLogged.has(kind)) {
        capLogged.add(kind);
        log(`wgmanager: ntfy: more than ${max} ${kind} notices in an hour; the rest are not sent`);
      }
      return false;
    }
    capLogged.delete(kind);
    times.push(t);
    return true;
  }

  async function deliver(text) {
    const r = await ntfy.send(text);
    if (r.ok) {
      if (lastProblem) log('wgmanager: ntfy works again');
      lastProblem = null;
    } else if (r.reason !== lastProblem) {
      lastProblem = r.reason;
      log(`wgmanager: ntfy: could not send a notification (${r.reason})`);
    }
    return r;
  }

  function readState() {
    try {
      const s = store.readJson(STATE_FILE);
      return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
    } catch {
      log(`wgmanager: ${STATE_FILE} is unreadable; starting a new one`);
      return {};
    }
  }

  return {
    /** A change failed or may be incomplete (the same cases that keep a warning banner). */
    async failure() {
      try {
        if (!on.errors || !allow('failure', MAX_FAILURE_NOTICES_PER_HOUR)) return;
        await deliver(TEXT.failure);
      } catch (e) {
        log(`wgmanager: ntfy: failure notice error (${e?.name ?? 'error'})`);
      }
    },

    /** The VPN server has a problem of this class (monitor.js): identity, setup, protocol, misconfigured, unreachable or other. */
    async hostProblem(cls) {
      try {
        if (!on.errors || !allow('host', MAX_HOST_NOTICES_PER_HOUR)) return;
        await deliver(TEXT.host[cls] ?? TEXT.host.other);
      } catch (e) {
        log(`wgmanager: ntfy: host notice error (${e?.name ?? 'error'})`);
      }
    },

    /** The problem announced earlier is gone. */
    async hostRecovered() {
      try {
        if (!on.errors || !allow('host', MAX_HOST_NOTICES_PER_HOUR)) return;
        await deliver(TEXT.hostRecovered);
      } catch (e) {
        log(`wgmanager: ntfy: host notice error (${e?.name ?? 'error'})`);
      }
    },

    /** The helper on the server is older than the one this image ships. Told once per shipped version. */
    async helperUpdate(version) {
      try {
        if (!on.updates || !VERSION_RE.test(version ?? '')) return;
        const state = readState();
        if (state.helperUpdate === version) return;
        const r = await deliver(TEXT.helperUpdate(version));
        if (!r.ok) return;
        try {
          store.writeJson(STATE_FILE, { ...state, helperUpdate: version });
        } catch (e) {
          log(`wgmanager: could not write ${STATE_FILE} (${e?.code ?? 'error'})`);
        }
      } catch (e) {
        log(`wgmanager: ntfy: helper notice error (${e?.name ?? 'error'})`);
      }
    },

    /** A newer app release exists. Told once per release; the release is remembered in the data volume. */
    async appUpdate(version) {
      try {
        if (!on.updates || !VERSION_RE.test(version ?? '')) return;
        const state = readState();
        if (state.appUpdate === version) return;
        const r = await deliver(TEXT.appUpdate(version));
        if (!r.ok) return; // not remembered, so the next check tries again
        try {
          store.writeJson(STATE_FILE, { ...state, appUpdate: version });
        } catch (e) {
          log(`wgmanager: could not write ${STATE_FILE} (${e?.code ?? 'error'})`);
        }
      } catch (e) {
        log(`wgmanager: ntfy: update notice error (${e?.name ?? 'error'})`);
      }
    },
  };
}
