// Update check: asks GitHub for the latest release of WG Manager once at start
// and then every 12 hours, and remembers only the newer version number, if any.
// It is an outbound call, so it is off unless UPDATE_CHECK=1 (see config.js). It
// sends no data about you or your server (just a User-Agent with this app's
// version), keeps nothing on disk, and any failure (offline, rate limited, odd
// answer) is ignored: the notice simply does not appear.
//
// Verified 2026-11-18 against the real endpoint: `GET /repos/elmedico27/wgmanager/
// releases/latest` answers 200 with `tag_name` ("v0.3.1"), `draft`, `prerelease`
// and `html_url`. GitHub allows 60 unauthenticated requests per hour per IP.

export const UPDATE_REPO = 'elmedico27/wgmanager';
export const UPDATE_INTERVAL_MS = 12 * 3600 * 1000;

const MAX_BODY = 1_000_000; // a release answer is a few KB; refuse anything absurd
const TAG_RE = /^v([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,4})$/;
const VERSION_RE = /^([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,4})$/;

/** True for a release number ("0.3.1"); false for edge and dev builds, which have nothing to compare. */
export const isRelease = (v) => VERSION_RE.test(v ?? '');

/** True when `latest` ("x.y.z") is a higher release than `current` ("x.y.z"). Anything else is false. */
export function isNewer(latest, current) {
  const a = VERSION_RE.exec(latest ?? '');
  const b = VERSION_RE.exec(current ?? '');
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  }
  return false;
}

export function createUpdateChecker({
  currentVersion,
  fetchFn = globalThis.fetch,
  intervalMs = UPDATE_INTERVAL_MS,
  timeoutMs = 10000,
  log = () => {},
  onNewer = () => {}, // called with "x.y.z" each time a check finds a release newer than this app
}) {
  let latest = null; // newest release number seen, "x.y.z"
  let timer = null;
  let running = false;
  let warned = false; // log a failure once, not every 12 hours

  async function check() {
    if (running) return;
    running = true;
    try {
      const res = await fetchFn(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers: {
          'User-Agent': `wgmanager/${currentVersion}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_BODY) throw new Error('answer too large');
      const rel = JSON.parse(text);
      const m = typeof rel?.tag_name === 'string' ? TAG_RE.exec(rel.tag_name) : null;
      if (!m || rel.draft === true || rel.prerelease === true) throw new Error('no usable release in the answer');
      latest = `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`;
      warned = false;
      if (isNewer(latest, currentVersion)) {
        try {
          Promise.resolve(onNewer(latest)).catch(() => {});
        } catch {
          // a failing listener must not break the check
        }
      }
    } catch (e) {
      if (!warned) {
        warned = true;
        const why = e?.name === 'TimeoutError' ? 'timed out' : String(e?.message ?? e).replace(/[^\x20-\x7e]/g, '?').slice(0, 80);
        log(`wgmanager: update check failed (${why}); trying again in ${Math.round(intervalMs / 3600000)} hours`);
      }
    } finally {
      running = false;
    }
  }

  return {
    check,
    /** `{latest}` when a newer release than this app exists, else null. */
    get: () => (isNewer(latest, currentVersion) ? { latest } : null),
    start() {
      if (timer) return;
      void check();
      timer = setInterval(check, intervalMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
