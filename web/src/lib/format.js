// Formatting helpers.

// Same binary units as `wg show` (wireguard-tools src/show.c: B, KiB, MiB, GiB,
// TiB, base 1024). Counters are 64-bit and can pass 1 TiB.
export function bytes(n) {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${v} B`;
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

// A WireGuard session's keys are refused 180 s after the handshake that made
// them (REJECT_AFTER_TIME = 180, messages.h); active peers re-handshake every
// 120 s (REKEY_AFTER_TIME). So a handshake under 180 s old means the peer has a
// usable session right now.
export const SESSION_WINDOW = 180;

export function ago(epoch, nowSec = Date.now() / 1000) {
  if (!epoch) return null;
  const s = Math.max(0, Math.floor(nowSec - epoch));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} days ago`;
}

export function date(epoch) {
  if (!epoch) return '—';
  return new Date(epoch * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Status for the dot: green live, red disabled, yellow anything else (owner, 2026-10-22). */
export function status(c, ifaceUp) {
  if (!c.manageable) return { tone: 'warn', label: 'Managed outside wgmanager' };
  if (c.enabled === true && c.live) return { tone: 'live', label: 'Live' };
  if (c.enabled === false && !c.live) return { tone: 'off', label: 'Disabled' };
  if (c.enabled === null) return { tone: 'warn', label: 'No entry in server config' };
  if (c.enabled === true && !c.live) {
    return { tone: 'warn', label: ifaceUp ? 'Enabled but not on the interface' : 'Enabled, interface down' };
  }
  return { tone: 'warn', label: 'Disabled but still on the interface' };
}

export function connection(c, nowSec) {
  if (!c.live) return null;
  if (!c.latest_handshake) return { connected: false, text: 'No handshake since the interface started' };
  const age = nowSec - c.latest_handshake;
  return {
    connected: age < SESSION_WINDOW,
    text: `Handshake ${ago(c.latest_handshake, nowSec)}`,
    remaining: Math.min(1, Math.max(0, 1 - age / SESSION_WINDOW)), // clamp: clocks can disagree
  };
}

// --- client name rule (helper spec 4.1) ------------------------------------------

export function nameProblem(name, existing) {
  if (!name) return null;
  if (name.length > 15) return 'Use 15 characters or fewer.';
  if (name.startsWith('-')) return 'Start with a letter, digit or underscore.';
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'Use only letters, digits, underscores and hyphens.';
  if (/^[0-9]+$/.test(name)) return 'Include at least one letter or underscore. PiVPN reads all-digit names as list numbers.';
  if (name === 'server') return '"server" is reserved by PiVPN.';
  const clash = existing.find((n) => n.toLowerCase() === name.toLowerCase());
  if (clash) return `A client named ${clash} already exists.`;
  return null;
}

/** Why an unmanageable client is unmanageable. The helper warns only about the
 *  subnet case, so the name case is worked out here. */
export function unmanageableReason(c, isSafeName) {
  if (!isSafeName(c.name)) return 'Its name uses characters wgmanager does not accept. Manage it with pivpn directly.';
  return 'Its address is outside the VPN subnet. Manage it with pivpn directly.';
}

export function isSafeName(name) {
  return /^[A-Za-z0-9_][A-Za-z0-9_-]{0,14}$/.test(name) && !/^[0-9]+$/.test(name) && name !== 'server';
}

// --- failed checks in plain language (helper spec 8.1) ---------------------------

const CHECKS = {
  add: {
    client_record: "PiVPN's client list does not include it",
    client_config_file: 'Its config file was not created',
    server_config_block: 'The server config has no enabled entry for it',
    live_peer: 'It is not active on the running interface',
  },
  remove: {
    client_record: "It is still in PiVPN's client list",
    client_config_file: 'Its config file still exists',
    server_config_block: 'The server config still has an entry for it',
    live_peer: 'It is still active on the running interface',
  },
  enable: {
    client_record: "PiVPN's client list no longer includes it",
    server_config_block: 'The server config does not show it as enabled',
    live_peer: 'It is not active on the running interface',
  },
  disable: {
    client_record: "PiVPN's client list no longer includes it",
    server_config_block: 'The server config does not show it as disabled',
    live_peer: 'It is still active on the running interface',
  },
};

export function checkText(action, check) {
  if (check === 'backend_timeout') return 'PiVPN did not finish within 30 seconds and was stopped';
  if (check === 'backend_not_run') return 'PiVPN could not be started';
  return CHECKS[action]?.[check] ?? check;
}

export const ACTION_WORDS = { add: 'Add', remove: 'Delete', enable: 'Enable', disable: 'Disable' };

export function errorText(err) {
  switch (err?.code) {
    case 'busy': return 'Another change is still running on the host. Wait a moment and try again.';
    case 'not_found': return 'That client no longer exists on the host.';
    case 'exists': return 'A client with that name already exists.';
    case 'invalid_request': return 'The host refused the request. The name or client is not one wgmanager can manage.';
    case 'host_misconfigured': return 'The host setup has a problem. Run wgmanager-host doctor on the server for details.';
    case 'unreachable': return 'Cannot reach the server over SSH. Check that it is running and that SSH_HOST and SSH_PORT are right.';
    case 'key_refused': return "The server answered but refused this app's key. Run the install command on the server (step 1).";
    case 'bad_response': return 'The helper on the server sent an answer wgmanager does not understand. Check that the helper is installed and up to date.';
    case 'csrf': return 'The request was refused for safety. Reload the page and try again.';
    case 'timeout': return 'The server did not answer in time. If this was a change, it may or may not have happened; it was not retried.';
    case 'rate_limited': return 'Too many failed attempts. Wait 15 minutes and try again.';
    case 'unauthenticated': return 'Your session ended. Sign in again.';
    case 'server_error': return 'WG Manager hit an unexpected error. Details are in the container log (docker logs wgmanager).';
    case 'no_route': return 'WG Manager did not recognise that request. Reload the page; the app may have been updated.';
    case 'hostkey_changed': return "The server's SSH identity is not the one you confirmed, so wgmanager stopped talking to it. If you rebuilt the server or regenerated its SSH keys, confirm the new identity in Settings. If not, something else may be answering in its place.";
    case 'hostkey_unconfirmed': return "Confirm the server's identity first.";
    case 'hostkey_mismatch': return 'The server presented a different key while you were confirming. Test the connection again.';
    case 'protocol_mismatch': return 'The helper on the host speaks a different protocol version. Update wgmanager or the helper so they match.';
    case 'network': return 'The wgmanager server did not answer.';
    default: return 'Something went wrong on the host. Details are in the helper log (journalctl -t wgmanager-helper).';
  }
}

// --- admin password ----------------------------------------------------------------

export const MIN_PASSWORD = 12;

/** Problem with a new password pair, or null. Length only: no composition rules. */
export function passwordProblem(pw, confirm) {
  if (!pw) return null;
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (confirm && pw !== confirm) return 'The two passwords do not match.';
  return null;
}

// The project's home; used by the sidebar link and the recovery link.
export const REPO_URL = 'https://github.com/elmedico27/wgmanager';
