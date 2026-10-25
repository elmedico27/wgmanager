// Small HTTP layer on node:http: security headers, JSON bodies, cookies,
// a route table and the built UI held in memory (only files that exist in
// the build at start-up can ever be served, so no path tricks are possible).

import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// Strict policy: everything from this origin only, no inline script, no
// framing. Style sheets only from the app's own files; inline style
// *attributes* are allowed (style-src-attr) because the UI sets a few (the
// session bar width, safe-area padding). Checked in Chromium on 2026-10-22: with
// plain style-src 'self' the only violations were style-src-attr.
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' blob:", // QR codes are fetched, then shown from a blob: URL
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}

export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

export function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  noStore(res);
  res.end(text);
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

export function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return reject(Object.assign(new Error('json required'), { status: 415 }));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('object expected');
        resolve(v);
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Load the built UI (web/dist) into memory. */
export function loadUi(dir) {
  const files = new Map();
  if (!fs.existsSync(dir)) return files;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const rel = '/' + path.relative(dir, full).split(path.sep).join('/');
        const type = TYPES[path.extname(e.name).toLowerCase()];
        if (type) files.set(rel, { body: fs.readFileSync(full), type, immutable: rel.startsWith('/assets/') });
      }
    }
  };
  walk(dir);
  return files;
}

// The app's pages (web/src/lib/routes.js): answered with index.html and 200.
// Any other address gets index.html with 404, and the app shows "Page not found".
const APP_ROUTE = /^\/(?:clients(?:\/[^/]+)?|host|settings)\/?$/;
export function isAppRoute(url) {
  return APP_ROUTE.test(url);
}

/** index.html for an address that isn't a file; false if no UI was built. */
export function serveIndex(files, req, res) {
  const file = files.get('/index.html');
  if (!file) return false;
  const url = req.url.split('?')[0];
  res.statusCode = isAppRoute(url) ? 200 : 404;
  res.setHeader('Content-Type', file.type);
  res.setHeader('Cache-Control', 'no-cache');
  res.end(req.method === 'HEAD' ? undefined : file.body);
  return true;
}

export function serveUi(files, req, res) {
  const url = req.url.split('?')[0];
  const file = files.get(url === '/' ? '/index.html' : url);
  if (!file) return false;
  res.statusCode = 200;
  res.setHeader('Content-Type', file.type);
  // Vite puts a content hash in every file name under /assets.
  res.setHeader('Cache-Control', file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.end(req.method === 'HEAD' ? undefined : file.body);
  return true;
}
