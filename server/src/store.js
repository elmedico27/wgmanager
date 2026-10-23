// Files in the app's data volume. Everything is private to the container user:
// directories 0700, files 0600, written atomically (temp file + rename).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class Store {
  constructor(dir) {
    this.dir = dir;
  }

  init() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.p('ssh'), { recursive: true, mode: 0o700 });
  }

  p(...parts) {
    return path.join(this.dir, ...parts);
  }

  read(name) {
    try {
      return fs.readFileSync(this.p(name), 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  readJson(name) {
    const text = this.read(name);
    return text === null ? null : JSON.parse(text);
  }

  write(name, text) {
    const target = this.p(name);
    const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, target);
  }

  writeJson(name, value) {
    this.write(name, JSON.stringify(value, null, 2) + '\n');
  }

  remove(name) {
    fs.rmSync(this.p(name), { force: true });
  }

  mtime(name) {
    try {
      return fs.statSync(this.p(name)).mtimeMs;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
}
