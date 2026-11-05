// The helper version that ships in this image. The image keeps the host tools
// at /opt/wgmanager/host (a checkout has them in host/), next to server/; the
// install command copies them to the server. The UI compares this with the
// server's `version` answer and offers the update when the server is behind.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLED_HELPER_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../host/wgmanager-helper');

const VERSION_RE = /^HELPER_VERSION = "([0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4})"$/m;

/** The helper's version string, or null if the file is missing or has no version line. */
export function readHelperVersion(file = BUNDLED_HELPER_PATH) {
  try {
    const m = fs.readFileSync(file, 'utf8').match(VERSION_RE);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
