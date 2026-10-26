# wgmanager web UI

Svelte 5 + Vite + Tailwind 4 single-page app. The Express backend (next step)
serves the built files and the `/api` routes listed in `src/lib/api.js`.

- `npm install` then `npm run dev`: runs against the in-browser mock helper
  (`src/mock/`), fake data only.
- `npm run dev:real`: UI dev server against a real backend on port 7501
  (see `server/README.md`).
- `npm run build`: the real app into `dist/`; the mock is not included.
- `npm run build:demo`: the public demo site in `dist-demo/`: mock built in,
  no Preview panel, each visitor's changes kept only in their browser tab.
- `npm run build:preview`: one self-contained HTML file in `dist-preview/`
  with the mock built in, for design review. `node scripts/artifact.mjs OUT`
  turns it into a body-only page for a claude.ai Artifact.

Dependencies are pinned to exact versions, each at least two weeks old when
chosen (2026-10-22).
