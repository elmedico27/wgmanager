# wgmanager web UI

Svelte 5 + Vite + Tailwind 4 single-page app. The Express backend (next step)
serves the built files and the `/api` routes listed in `src/lib/api.js`.

- `npm install` then `npm run dev`: runs against the in-browser mock helper
  (`src/mock/`), fake data only.
- `npm run build`: the real app into `dist/`; the mock is not included.
- `npm run build:preview`: one self-contained HTML file in `dist-preview/`
  with the mock built in, for design review. `node scripts/artifact.mjs OUT`
  turns it into a body-only page for a claude.ai Artifact.

Dependencies are pinned to exact versions, each at least two weeks old when
chosen (2026-10-22).
