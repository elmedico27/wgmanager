// Admin commands, run inside the container:
//   docker exec wgmanager wgmanager reset-password
// (`wgmanager` is a small wrapper in the image: docker/wgmanager).

import { loadConfig } from './config.js';
import { Store } from './store.js';
import { Admin } from './auth.js';

const cmd = process.argv[2];
const cfg = loadConfig();
const store = new Store(cfg.dataDir);
store.init();

if (cmd === 'reset-password') {
  const code = new Admin(store).reset();
  console.log('The admin password was removed and everyone is signed out.');
  console.log(`Setup code: ${code}`);
  console.log('Open the web UI and enter this code to choose a new password.');
} else {
  console.log('Usage: wgmanager reset-password');
  process.exit(2);
}
