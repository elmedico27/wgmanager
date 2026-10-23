# wgmanager backend

Serves the built UI (`web/dist`) and the `/api` routes listed at the top of
`web/src/lib/api.js`, and talks to the host helper over SSH. Node built-ins
only; the one dependency is `qrcode-generator` (no dependencies of its own).

## Settings (environment)

| Variable | Default | Meaning |
|---|---|---|
| `SSH_HOST` | `172.29.88.1` | WireGuard server, as seen from the container |
| `SSH_PORT` | `22` | its SSH port |
| `SSH_USER` | `wgweb` | the account the installer created |
| `LISTEN_PORT` | `7501` | port inside the container (publish it with `WEB_PORT` in compose) |
| `DATA_DIR` | `/data` | app key, pinned server key, password hash, setup code |
| `TRUST_PROXY` | off | set `1` behind an HTTPS reverse proxy (X-Forwarded-For/-Proto) |
| `HELPER_MODE` | `ssh` | `mock` = fake data for development |

## Data volume

`DATA_DIR` holds `ssh/id_ed25519` (the app's key, made on first start),
`known_hosts` + `hostkey.json` (the confirmed server identity), `admin.json`
(scrypt hash), `failures.json` (unacknowledged warnings about changes that
failed or may be incomplete) and, until a password is set, `setup-code`.
Directories are 0700, files 0600. A damaged `admin.json` locks sign-in (run
the reset command); a damaged `hostkey.json` asks to confirm the server again.

## Commands

- `npm start`: run the server.
- `node src/cli.js reset-password`: forget the password, sign everyone out and
  print a new setup code.
- `npm test`: unit and HTTP tests. With `WGM_SSH_LAB` set (see
  `test/ssh-lab.sh`, for a throwaway machine only) it also tests the SSH path
  against a real sshd.

## Development

`HELPER_MODE=mock DATA_DIR=./tmp-data node src/main.js`, then in `web/`:
`npm run dev:real` (UI dev server proxying `/api` to port 7501), or
`npm run build` and open http://localhost:7501.
