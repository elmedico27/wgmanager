// The helper version that ships in this image. The image keeps the host tools
// at /opt/wgmanager/host (a checkout has them in host/), next to server/; the
// install command copies them to the server. The UI compares this with the
// server's `version` answer and offers the update when the server is behind.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLED_HELPER_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../host/wgmanager-helper');

const VERSION_RE = /^HELPER_VERSION = "([0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4})"$/m;

// The image's own version, written at build time from the git tag (Dockerfile,
// .github/workflows/build.yml). package.json's "version" is NOT used: it was
// bumped by hand at release time and got out of step (v0.3.1 shipped saying 0.3.0).
// A checkout has no such file, so a development run has no version.
export const APP_VERSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../VERSION');

// A release (0.3.1), an `edge` build (edge-f2be361) or a plain local build (dev).
const APP_VERSION_RE = /^(?:[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}|edge-[0-9a-f]{7}|dev)$/;

/** This app's version as the image states it, or null if the file is missing or says anything else. */
export function readAppVersion(file = APP_VERSION_PATH) {
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    return APP_VERSION_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** The helper's version string, or null if the file is missing or has no version line. */
export function readHelperVersion(file = BUNDLED_HELPER_PATH) {
  try {
    const m = fs.readFileSync(file, 'utf8').match(VERSION_RE);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
