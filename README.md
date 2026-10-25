# WG Manager

A web UI for a [PiVPN](https://pivpn.io) WireGuard server. Add, enable, disable and delete clients, show their QR codes and config files, and see who is connected, from a browser.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img alt="WG Manager's client list (sample data)" src="docs/screenshot-light.png">
</picture>

The web app runs in Docker. It changes WireGuard only through a small helper on the host, reached over SSH with a key that can do nothing else. PiVPN stays in charge of your server, and `pivpn` keeps working alongside.

## Requirements

- A 64-bit (amd64 or arm64) Debian-family server, such as Debian or Raspberry Pi OS (64-bit)
- PiVPN with **WireGuard** (not OpenVPN), already set up
- Docker with Compose v2 (`docker compose`)
- `python3`, `sudo` and an OpenSSH server on the same machine (standard on Debian servers)

## Install

1. **Create a folder and the two files.** Use any folder, for example `~/wgmanager`, or your container manager's projects folder. Download them:

   ```sh
   mkdir -p ~/wgmanager && cd ~/wgmanager
   curl -fsSLO https://raw.githubusercontent.com/elmedico27/wgmanager/master/compose.yaml
   curl -fsSLO https://raw.githubusercontent.com/elmedico27/wgmanager/master/.env.example
   mv .env.example .env
   ```

   Or create `compose.yaml` and `.env` yourself and paste in the contents of [compose.yaml](compose.yaml) and [.env.example](.env.example). The settings file must be named **`.env`**, not `.env.example`, or Docker Compose ignores it.

2. **Check `.env`.** If your SSH server does not listen on port 22, set `SSH_PORT`. Everything else can stay as it is. See [Settings](#settings).

3. **Start it:**

   ```sh
   docker compose up -d
   docker logs wgmanager
   ```

   The log shows a one-time **setup code**.

4. **Open `http://<server>:7501`**, enter the setup code and choose the admin password.

5. **Install the helper.** The next screen shows one command with the app's key filled in. Run it on the server. It shows its plan and asks before changing anything:

   ```sh
   sudo docker cp wgmanager:/opt/wgmanager/host/. /usr/local/lib/wgmanager && \
     sudo python3 /usr/local/lib/wgmanager/wgmanager-host install --pubkey "ssh-ed25519 AAAA... wgmanager@container"
   ```

6. **Confirm the server.** The installer's last line is the server's fingerprint. Check that it matches the one in the browser, then click **It matches**. Your clients appear.

> [!WARNING]
> Never install, update or restart WG Manager while you are connected through the VPN it manages. If something goes wrong, you lose the connection you are using.

## Update

App:

```sh
docker compose pull && docker compose up -d
```

Helper: open **Settings › App key**, copy the install command and run it on the server again. It only changes what differs.

## Uninstall

Helper (on the server; add `--purge` to also delete the WireGuard config backups in `/var/backups/wgmanager`):

```sh
sudo python3 /usr/local/lib/wgmanager/wgmanager-host uninstall
sudo rm -rf /usr/local/lib/wgmanager
```

App (in its folder; `-v` deletes its data: admin password, SSH key and confirmed server identity):

```sh
docker compose down -v
```

Your WireGuard server, PiVPN and all clients are left as they are.

## Doctor

A read-only check of everything the helper needs. It lists each problem with the command that fixes it. Run it first when something misbehaves:

```sh
sudo python3 /usr/local/lib/wgmanager/wgmanager-host doctor
```

## Forgot the password

```sh
docker exec wgmanager wgmanager reset-password
```

It signs everyone out and prints a new setup code. Open the web UI and enter it to choose a new password.

## When a change fails

The helper backs up the server config before every change. If a change fails or only partly happens, WG Manager shows a warning that stays until you acknowledge it. [docs/RECOVERY.md](docs/RECOVERY.md) explains how to check and restore.

---

## How it works

```
browser ──HTTP──▶ WG Manager (Docker) ──SSH──▶ sshd ──▶ wgmanager-helper (root) ──▶ pivpn / wg
                                         as user wgweb, forced command
```

- **The web app** (Node, in Docker) serves the UI and keeps your admin password hash, its own SSH key and the server's confirmed fingerprint in its data volume. It never touches WireGuard itself.
- **The helper** (`/usr/local/sbin/wgmanager-helper`, one Python file, standard library only) can do seven fixed things: list clients, add, remove, enable, disable, get a client's config and report its version. It runs PiVPN's own scripts for changes, backs up `wg0.conf` and `clients.txt` before each one, and then checks that the change really happened, because PiVPN sometimes reports success when it failed. Its full contract is in [docs/HELPER-SPEC.md](docs/HELPER-SPEC.md).
- **The SSH key** belongs to the app. The container creates it on first start, and the private half never leaves the data volume. The installer only ever sees the public key. On the server the key may connect only from the container's network, only as `wgweb`, and can only run the helper: no shell, no terminal, no forwarding.
- **The server's identity** is pinned. On first contact you confirm the server's SSH fingerprint. After that, WG Manager refuses to talk to a server that presents a different key, and shows why. If you rebuild the server or replace its SSH keys, use **Settings › Server identity › Confirm a new server identity**.
- **One SSH connection** is reused for up to 5 minutes, so an open browser tab doesn't fill the server's log with logins.

### What the installer changes on the server

| Path | Purpose |
|---|---|
| `/usr/local/sbin/wgmanager-helper` | the root-owned helper |
| `wgweb` system user | no home, no usable password, no groups of note |
| `/etc/sudoers.d/wgmanager` | lets `wgweb` run the helper, nothing else |
| `/etc/ssh/sshd_config.d/wgmanager.conf` | for `wgweb` only: key login, no terminal, no forwarding, forced command |
| `/etc/wgmanager/authorized_keys` | the app's public key, limited to the helper and the allowed source addresses |
| `/var/backups/wgmanager` | config backups, created on the first change (newest 20 kept) |
| `/etc/wgmanager/config` | optional helper settings, never created for you (see [config.example](host/etc/wgmanager/config.example)) |
| `/usr/local/lib/wgmanager` | the host tool copied out of the container, kept for `doctor`, updates and `uninstall` |

The installer adds its own files only and never edits yours. It stops with the exact fix, instead of changing anything, when something that isn't its own is in the way: PiVPN files writable by non-root users, an existing `wgweb` account in a privileged group, `sshd_config` not including `sshd_config.d`, or `AllowUsers`/`AllowGroups` that would lock `wgweb` out. It changes sshd last and undoes its own steps if one fails. `--dry-run` shows the plan without changing anything, and `--yes` skips the question.

The app only accepts the server's ED25519 SSH host key, which Debian creates by default. `doctor` warns if it's missing.

On Ubuntu 22.10 and later, sshd is socket-activated and only runs after the first connection. Connect over SSH once before installing. There, the port and listen addresses come from `ssh.socket`, not `sshd_config`.

### Settings

Set in `.env`. Restart with `docker compose up -d` after a change. Settings shows the SSH values in use but can't change them.

| Variable | Default | Meaning |
|---|---|---|
| `WEB_PORT` | `7501` | Port the web UI is published on |
| `WEB_BIND` | `0.0.0.0` | Address the web UI is published on. Set your server's LAN address to publish only there |
| `SSH_HOST` | `172.29.88.1` | The server as seen from the container: the gateway of the app's own network, which is the host |
| `SSH_PORT` | `22` | Your sshd port |
| `SSH_USER` | `wgweb` | The account the installer creates |
| `TRUST_PROXY` | `0` | `1` only behind an HTTPS reverse proxy (enables Secure cookies and trusts its `X-Forwarded-*` headers) |
| `WGM_VERSION` | `latest` | Image tag: `latest` (newest release), `edge` (newest commit) or a version such as `0.1.0` |

**The app's network.** `compose.yaml` pins a small Docker network, `172.29.88.0/29`, and the installer lets the app's key in only from there (and from the server itself). If it clashes with one of your networks, change the subnet and gateway in `compose.yaml` and `SSH_HOST` in `.env`, then rerun the install command with `--allow-from 127.0.0.1,::1,<subnet>` (the list replaces the default). It must not overlap the VPN's client subnet.

**sshd** must accept connections on the gateway address (`172.29.88.1`). The default `ListenAddress` (all addresses) does. A firewall on the server must allow SSH from `172.29.88.0/29`.

**Behind a reverse proxy**, set `TRUST_PROXY=1` and consider `WEB_BIND=127.0.0.1` so the UI is only reachable through the proxy. Plain HTTP on your LAN works too.

**The setup code** is printed to the container's log on first start and after `reset-password`. Any container manager's log view (Arcane, Portainer, ...) shows it as well.

### Using it

- **Status dot:** green = on the interface, red = disabled, yellow = needs a look. The client's panel says why.
- **Connected now** means a handshake in the last 3 minutes. WireGuard has no real "connected" state, and a client that is idle sends nothing.
- **Last seen from** is the device's public address at its last handshake, not the server's address.
- **Download and upload** are from the device's point of view and count from when the interface last started.
- **Client names:** letters, digits, `_` and `-`, up to 15 characters, not all digits, not `server`, unique ignoring case. Use one client per device, for example `Alice_Phone`. Existing clients outside these rules, or with an address outside the VPN subnet, are shown but can only be managed with `pivpn`.
- **Sorting** works by clicking a column header in the list, or **Sort by** above the cards. Each browser remembers its choice.
- When the WireGuard interface is down, adding and enabling clients are turned off because the change couldn't go live. Start it with `sudo systemctl start wg-quick@wg0`.
- Changing the admin password signs out every other browser.
- **Host** shows SHA-256 hashes of the PiVPN scripts the helper runs. If you updated PiVPN, compare them with the [tested versions](#tested-with).

### Security notes

- The container runs as a non-root user with a read-only filesystem, no Linux capabilities and `no-new-privileges`. Only its data volume is writable.
- The admin password is stored as a scrypt hash in the data volume. Sign-in, setup and password changes are rate limited. Sessions live in memory (a restart signs everyone out), end after 6 hours idle or 7 days, and are protected against cross-site requests.
- Client configs and QR codes contain the client's private key. QR codes are made on request, and neither is cached by the browser or written to the app's log.
- No automatic rollback: if a change fails partway, WG Manager says so loudly and leaves the backups in place for you to check. See [docs/RECOVERY.md](docs/RECOVERY.md).

### Tested with

Debian 13 (trixie), PiVPN's WireGuard scripts v4.6.2 (v4.7.0 ships the same ones), wireguard-tools v1.0.20210914, OpenSSH 10.0p2, sudo 1.9.16p2, Python 3.13, Docker Compose v2. Current PiVPN (v4.11.1) differs only in `makeCONF.sh`. The helper's use of it was checked against that script's source but hasn't been run.

### Development

- `web/`: Svelte UI. `npm run dev` runs it against a built-in mock of the helper.
- `server/`: Node backend (built-in modules plus one QR library).
- `host/`: the helper and `wgmanager-host`. See [host/README.md](host/README.md).
- To build the image from a checkout: `docker compose -f compose.yaml -f compose.build.yaml up -d --build`.
- Tests: `python3 -m unittest discover -s host/tests` and, in `server/`, `npm test`. The SSH tests need a throwaway sshd: see `server/test/ssh-lab.sh` and `.github/workflows/build.yml`.

## Credits

WG Manager started as a fork of [pivpn-web](https://github.com/WeeJeWel/pivpn-web) by Emile Nijssen, whose author now recommends [wg-easy](https://github.com/wg-easy/wg-easy). It has since been rewritten: the UI, backend, helper and installer are new.

## License

[GPL-3.0](LICENSE)
