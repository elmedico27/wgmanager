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

// The app's only outbound call. Off with UPDATE_CHECK=0, and skipped unless this
// is a release build: an edge or dev build has no release number to compare.
const updates = cfg.updateCheck && isRelease(appVersion) ? createUpdateChecker({ currentVersion: appVersion, log: console.log }) : null;
console.log(
  updates
    ? 'wgmanager: update check on: asks GitHub for the latest release at start and every 12 hours (UPDATE_CHECK=0 turns it off)'
    : `wgmanager: update check off (${cfg.updateCheck ? 'not a release build' : 'UPDATE_CHECK'})`,
);

const app = createApp({ cfg, store, transport, ui, bundledHelper, appVersion, updates });
app.admin.announceSetupCode();

const server = http.createServer(app.handle);
server.headersTimeout = 20000;
server.requestTimeout = 90000; // longer than the 60 s helper timeout
updates?.start();
server.listen(cfg.listenPort, cfg.listenHost, () => {
  console.log(`wgmanager: listening on ${cfg.listenHost}:${cfg.listenPort}; helper via ${cfg.helperMode === 'mock' ? 'mock' : `ssh ${cfg.ssh.user}@${cfg.ssh.host}:${cfg.ssh.port}`}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
