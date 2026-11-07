---
title: Contributing
outline: deep
---

# Contributing

How to work on WG Manager's code. To install and use it, see [Getting started](../guide/getting-started).

## Repository layout

| Folder | What it holds |
|---|---|
| `web/` | The web UI: Svelte 5, Vite and Tailwind 4, a single-page app. |
| `server/` | The backend: Node built-in modules plus one dependency, `qrcode-generator` (which has none of its own). It serves the built UI and the `/api` routes listed at the top of `web/src/lib/api.js`, and talks to the helper over SSH. |
| `host/` | The server side: the helper and the `wgmanager-host` tool. |
| `docs/` | This documentation site (VitePress). |
| `docker/` | The `wgmanager` command inside the container (`reset-password`). |

In `host/`:

- `wgmanager-helper`: the root-owned helper, installed to `/usr/local/sbin`. One Python file, standard library only. Its contract is the [Helper protocol](../reference/helper-protocol).
- `wgmanager-host`: `doctor`, `install` and `uninstall` (`--help` on each). It finds the helper and the `etc/` templates next to its own file, and asks for confirmation only on a real terminal.
- `etc/`: templates for the sudo rule, the sshd drop-in and the optional `/etc/wgmanager/config` (`config.example`).
- `tests/`: see [Tests](#tests).

The image ships `host/` at `/opt/wgmanager/host`, and the install command copies it to `/usr/local/lib/wgmanager`. `install` runs as root and copies the helper from wherever `wgmanager-host` sits, so keep that folder writable only by root (or by you, for a checkout).

## Web UI

In `web/`, after `npm install`:

- `npm run dev`: runs the UI against a built-in mock of the helper (`src/mock/`), with fake data only.
- `npm run dev:real`: the UI dev server against a real backend on port 7501 (see [Backend](#backend)). Requests to `/api` are passed through to it.
- `npm run build`: the real app into `dist/`. The mock is not included.
- `npm run build:demo`: the public demo site into `dist-demo/`: the mock built in, and each visitor's changes kept only in their own browser tab.
- `npm test`: unit tests for the UI's logic that runs without a browser (for now, the client search filter).

The [live demo](https://wgmdemo.pages.dev) is built by Cloudflare Pages straight from this repository: root directory `web`, build command `npm run build:demo`, output `dist-demo`, Node 26 (`NODE_VERSION`). Every push to `master` rebuilds it.

## Backend

In `server/`:

- `npm start`: run the server.
- `node src/cli.js reset-password`: forget the password, sign everyone out and print a new setup code.
- `npm test`: unit and HTTP tests. See [Tests](#tests) for the SSH tests.

To develop without a VPN server, run the backend against the mock helper:

```sh
HELPER_MODE=mock DATA_DIR=./tmp-data node src/main.js
```

Then, in `web/`, run `npm run dev:real`, or run `npm run build` and open `http://localhost:7501`.

Besides the settings in the [Configuration reference](../guide/configuration), the backend reads these, which are set inside the image and rarely need changing:

| Variable | Default | Meaning |
|---|---|---|
| `LISTEN_PORT` | `7501` | The port inside the container. Publish it with `WEB_PORT` in `.env`. |
| `DATA_DIR` | `/data` | Where the app keeps its data (see [What the app stores](../guide/how-it-works#app-data)). |
| `HELPER_MODE` | `ssh` | `mock` uses fake data, for development. |
| `SSH_CONTROL_DIR` | `/tmp/wgm-ssh` | Socket folder for the shared SSH connection. Empty turns sharing off. |

## Host tools from a checkout

Instead of copying the tools out of the container, you can run them from a checkout, for example to read the code first or to test changes:

```sh
sudo python3 host/wgmanager-host install --pubkey-file app_key.pub
sudo python3 host/wgmanager-host doctor
sudo python3 host/wgmanager-host uninstall
```

Only ever pass the app's public key.

## Building the image

From a checkout:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

## Tests

### Host tests {#host-tests}

Standard library only. No root, WireGuard, PiVPN, sshd or sudo needed; every external command is faked. From the repository root:

```sh
python3 -m unittest discover -s host/tests -v
```

Run them under different umasks (002, 022, 077) when touching file modes.

- `test_helper.py` tests `wgmanager-helper`: the request parser against hostile input, the backend steps, and reading state from files in PiVPN's real layout. `fakes/pivpn` and `fakes/wg` are test doubles. `fakes/pivpn` reproduces real PiVPN quirks on purpose (exit 0 on "does not exist", reload failures that still exit 0), so the helper's checks after each change are exercised. The fake `wg` dump contains secret sentinel strings, and the tests assert they never appear in output or logs.
- `test_host.py` tests `wgmanager-host doctor` against a throwaway folder tree. Every external command (`sshd`, `sudo`, `visudo`, `id`, `getent`) is answered from a table, so each way a real server can be misconfigured is reproducible. It also asserts that `doctor` changes nothing.
- `test_install.py` tests `install` and `uninstall` against a stateful fake system (accounts, files, sshd, sudo). It checks what ends up on disk, that sshd is changed last, that a failure at any step restores the previous state, and that running twice changes nothing.

### Web UI tests

In `web/`, `npm test` runs the unit tests in `test/` with Node's built-in test runner. No browser is needed.

### Backend tests

In `server/`, `npm test` runs the unit and HTTP tests. With `WGM_SSH_LAB` set, it also tests the SSH path against a real sshd. `test/ssh-lab.sh` sets one up; it needs root and creates a local `wgweb` account, so use it only on a throwaway machine or container:

```sh
sudo sh test/ssh-lab.sh /tmp/wgm-lab
WGM_SSH_LAB=/tmp/wgm-lab npm test
```

CI runs all of these on pushes to `master` and on pull requests; see `.github/workflows/build.yml`.

## Documentation

In `docs/`, after `npm install`, `npm run dev` serves this site locally with live reload, and `npm run build` builds it as it is published.

## Dependencies

Dependencies are pinned to exact versions, each at least 14 days old when chosen. Dependabot proposes updates weekly with the same 14-day wait (security updates are not delayed).
