---
title: How it works
---

# How it works

```
browser ──HTTP──▶ WG Manager (Docker) ──SSH──▶ sshd ──▶ wgmanager-helper (root) ──▶ pivpn / wg
                                         as user wgweb, forced command
```

- **The web app** (Node, in Docker) serves the page. It stores your admin password hash, its own SSH key, the server's confirmed fingerprint and your client notes in its data volume. It never touches WireGuard itself.
- **The helper** (`/usr/local/sbin/wgmanager-helper`, one Python file using only the standard library) can do seven fixed things: list clients, add, remove, enable, disable, get a client's config, and report its version. For changes it runs PiVPN's own scripts. It backs up `wg0.conf` and `clients.txt` before each change, then checks that the change really happened, because PiVPN sometimes reports success when it failed. Its full contract is in [Helper protocol](../reference/helper-protocol).
- **The SSH key** belongs to the app. The container creates it on first start, and the private half never leaves the data volume; the installer only ever sees the public half. On the server, the key can connect only from the app's network, only as `wgweb`, and can only run the helper: no shell, no terminal, no forwarding.
- **The server's identity is pinned.** You confirm the server's SSH fingerprint once ([Step 6](./getting-started#step-6-confirm-that-this-is-your-server)). After that, WG Manager refuses to talk to a server that presents a different key, and says why.
- **One SSH connection is reused** for up to 5 minutes, so an open browser tab doesn't fill the server's log with logins.

## What the installer changes on the server {#installer-changes}

| Path | Purpose |
|---|---|
| `/usr/local/sbin/wgmanager-helper` | The helper, owned by root. |
| `wgweb` system account | Runs the helper over SSH. No home folder and no password login. |
| `/etc/sudoers.d/wgmanager` | Lets `wgweb` run the helper and nothing else. |
| `/etc/ssh/sshd_config.d/wgmanager.conf` | For `wgweb` only: key login, no terminal, no forwarding, and a forced command. |
| `/etc/wgmanager/authorized_keys` | The app's public key, limited to running the helper and to the allowed source addresses. |
| `/var/backups/wgmanager` | Config backups, created at the first change. The newest 20 are kept. |
| `/etc/wgmanager/config` | Optional helper settings. Never created for you; see [config.example](https://github.com/elmedico27/wgmanager/blob/master/host/etc/wgmanager/config.example). |
| `/usr/local/lib/wgmanager` | The installer tool copied out of the container. Kept for `doctor`, updates and `uninstall`. |

The installer adds its own files only and never edits yours. When something that isn't its own is in the way, it stops and tells you the exact fix instead of changing it. Examples: PiVPN files that non-root users can write to, an existing `wgweb` account in a privileged group, an `sshd_config` that doesn't include `sshd_config.d`, or `AllowUsers`/`AllowGroups` rules that would lock `wgweb` out. It changes `sshd` last and undoes its own steps if one fails.

## What the app stores {#app-data}

The app keeps everything in its data volume (`/data` inside the container):

| File | Contents |
|---|---|
| `ssh/id_ed25519` | The app's SSH key, made on first start. |
| `known_hosts`, `hostkey.json` | The confirmed server identity. |
| `admin.json` | The admin password's scrypt hash. |
| `failures.json` | Warnings about failed or incomplete changes that haven't been acknowledged yet. |
| `notes.json` | Client notes, by each client's public key. A note stays when its client is removed outside WG Manager (for example with `pivpn -r`). |
| `setup-code` | The one-time setup code, only until a password is set. |

Folders are mode 0700 and files 0600. If `admin.json` is damaged, sign-in is locked; [reset the password](./troubleshooting#forgot-password) to recover. If `hostkey.json` is damaged, WG Manager asks you to confirm the server again. If `notes.json` is damaged, notes can't be saved until you fix or delete the file; WG Manager never overwrites it.

## Tested with {#tested-with}

Debian 13 (trixie), PiVPN's WireGuard scripts v4.6.2 (v4.7.0 ships the same ones), wireguard-tools v1.0.20210914, OpenSSH 10.0p2, sudo 1.9.16p2, Python 3.13 and Docker Compose v2. The current PiVPN (v4.11.1) differs only in `makeCONF.sh`. The helper's use of it was checked against that script's source but hasn't been run.
