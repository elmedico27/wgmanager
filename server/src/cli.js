// Admin commands, run inside the container:
//   docker exec wgmanager wgmanager reset-password
//   docker exec wgmanager wgmanager ntfy-test
// (`wgmanager` is a small wrapper in the image: docker/wgmanager).

import { loadConfig } from './config.js';
import { Store } from './store.js';
import { Admin } from './auth.js';
import { createNtfy } from './ntfy.js';
import { TEXT } from './notify.js';

const cmd = process.argv[2];
let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  console.error(`wgmanager: bad setting: ${e.message}`);
  process.exit(1);
}
const store = new Store(cfg.dataDir);
store.init();

if (cmd === 'reset-password') {
  const code = new Admin(store).reset();
  console.log('The admin password was removed and everyone is signed out.');
  console.log(`Setup code: ${code}`);
  console.log('Open the web UI and enter this code to choose a new password.');
} else if (cmd === 'ntfy-test') {
  // Sends one test message with the NTFY_* settings the container runs with, whatever
  // NTFY_ON_* says. Prints why it failed; never prints the address or the credential.
  const ntfy = createNtfy(cfg.ntfy);
  if (!ntfy.enabled) {
    console.log('ntfy is off. Set NTFY_ENABLE=true (and NTFY_URL, NTFY_TOPIC and a token) in .env, then run: docker compose up -d');
    console.log('If they are already set: a compose.yaml from before 0.3.3 does not pass NTFY_* settings to the container; download the current one (see the Update steps in the docs).');
    process.exit(1);
  }
  const r = await ntfy.send(TEXT.test);
  console.log(r.ok ? 'Sent. Look for the notification in your ntfy app.' : `Not sent: ${r.reason}.`);
  process.exit(r.ok ? 0 : 1);
} else {
  console.log('Usage: wgmanager reset-password | wgmanager ntfy-test');
  process.exit(2);
}
