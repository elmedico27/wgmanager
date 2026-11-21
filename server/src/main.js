// wgmanager backend entry point.
//   node src/main.js            start the server
// Settings come from the environment (see config.js).

import http from 'node:http';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { SshTransport, MockTransport } from './transport.js';
import { createApp } from './app.js';
import { readHelperVersion, readAppVersion, BUNDLED_HELPER_PATH } from './bundled.js';
import { loadUi } from './http.js';
import { createUpdateChecker, isRelease } from './updates.js';
import { createNtfy } from './ntfy.js';
import { createNotifier } from './notify.js';
import { createMonitor } from './monitor.js';

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  console.error(`wgmanager: bad setting: ${e.message}`);
  process.exit(1);
}
const store = new Store(cfg.dataDir);
try {
  store.init();
  store.write('.write-test', 'ok\n');
  store.remove('.write-test');
} catch (e) {
  const uid = process.getuid?.();
  console.error(
    `wgmanager: cannot write to ${cfg.dataDir} (${e.code || e.message}). The data volume must be writable by uid ${uid}.` +
      ` To fix an existing volume: docker run --rm -v wgmanager_wgmanager-data:/data alpine chown -R ${uid}:${uid} /data`,
  );
  process.exit(1);
}

let transport;
if (cfg.helperMode === 'mock') {
  // Development only: the same mock the UI preview uses.
  const mock = await import('../../web/src/mock/helper.js');
  transport = new MockTransport(cfg, mock, { delayMs: Number(process.env.MOCK_DELAY_MS ?? 1500) });
  console.log('wgmanager: HELPER_MODE=mock, fake data only');
} else {
  transport = new SshTransport(cfg, store);
}
await transport.init();

const ui = loadUi(cfg.uiDir);
if (!ui.size) console.log(`wgmanager: no built UI found in ${cfg.uiDir}; only /api is served`);

const bundledHelper = readHelperVersion();
if (!bundledHelper) console.log(`wgmanager: no helper version found in ${BUNDLED_HELPER_PATH}; the helper update check is off`);

const appVersion = readAppVersion();
if (!appVersion) console.log('wgmanager: no VERSION file found; the Host page will not show the app version');

// Notifications to ntfy: an outbound call, so off unless NTFY_ENABLE=true (config.js).
const ntfy = createNtfy(cfg.ntfy);
const notifier = ntfy.enabled ? createNotifier({ ntfy, on: cfg.ntfy.on, store, log: console.log }) : null;
if (!ntfy.enabled) {
  console.log('wgmanager: ntfy off (NTFY_ENABLE=true turns it on)');
} else {
  const kinds = Object.entries(cfg.ntfy.on).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nothing (all kinds are off)';
  console.log(`wgmanager: ntfy on (${ntfy.secure ? 'https' : 'http, no TLS'}); notifies about: ${kinds}`);
  if (!ntfy.secure && cfg.ntfy.auth) {
    console.log('wgmanager: warning: NTFY_URL is http://, so the ntfy credential is sent without encryption. Acceptable on a network you trust; otherwise use https://');
  }
  if (cfg.ntfy.on.updates && !cfg.updateCheck) console.log('wgmanager: ntfy: app update notices need UPDATE_CHECK=1');
}

// An outbound call, so off unless UPDATE_CHECK=1 (or true), and skipped even then
// unless this is a release build: an edge or dev build has no release number to compare.
const updates = cfg.updateCheck && isRelease(appVersion) ? createUpdateChecker({ currentVersion: appVersion, log: console.log, onNewer: (v) => notifier?.appUpdate(v) }) : null;
console.log(
  updates
    ? 'wgmanager: update check on: asks GitHub for the latest release at start and every 12 hours (UPDATE_CHECK=0 turns it off)'
    : `wgmanager: update check off (${cfg.updateCheck ? 'not a release build' : 'UPDATE_CHECK=1 turns it on'})`,
);

const app = createApp({ cfg, store, transport, ui, bundledHelper, appVersion, updates, notifier });
// The web UI notices a host problem or an outdated helper by polling; this does the
// same for ntfy while no browser is open (monitor.js). Only when ntfy wants it.
// Without a bundled helper version there is nothing to compare, so updates alone don't need it.
const monitor = notifier && (cfg.ntfy.on.errors || (cfg.ntfy.on.updates && bundledHelper)) ? createMonitor({ call: app.helper, notifier, on: cfg.ntfy.on, bundledHelper, log: console.log }) : null;
if (monitor) console.log('wgmanager: ntfy: checking the VPN server about once a minute (the same read-only requests the web UI makes)');
app.admin.announceSetupCode();

const server = http.createServer(app.handle);
server.headersTimeout = 20000;
server.requestTimeout = 90000; // longer than the 60 s helper timeout
updates?.start();
monitor?.start();
server.listen(cfg.listenPort, cfg.listenHost, () => {
  console.log(`wgmanager: listening on ${cfg.listenHost}:${cfg.listenPort}; helper via ${cfg.helperMode === 'mock' ? 'mock' : `ssh ${cfg.ssh.user}@${cfg.ssh.host}:${cfg.ssh.port}`}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
