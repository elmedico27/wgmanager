// Turns dist-preview/index.html into a body-only page for a claude.ai Artifact
// (the host adds its own <html>/<head>/<body>). Usage: node scripts/artifact.mjs OUT
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('../dist-preview/index.html', import.meta.url), 'utf8');
const pick = (re) => { const m = src.match(re); if (!m) throw new Error('missing ' + re); return m[1]; };
const style = pick(/<style[^>]*>([\s\S]*?)<\/style>/);
const script = pick(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
const out = `<title>WG Manager Preview</title>
<style>${style}</style>
<div id="app"></div>
<script type="module">${script}</script>
`;
writeFileSync(process.argv[2], out);
console.log('wrote', process.argv[2], out.length);
