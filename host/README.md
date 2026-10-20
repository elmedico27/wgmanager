# Host side of wgmanager

The web app never touches WireGuard itself. It asks a small root-owned program on
the host, the **helper**, to do seven fixed things (list clients, add, remove,
enable, disable, get a client's config, report its version). The app reaches the
helper over SSH with a key that can do nothing else. This directory holds the
helper, the files that wire it up, and `wgmanager-host`, a tool that installs and
checks all of it. The helper's full contract is in `docs/HELPER-SPEC.md`.

Requirements: a Debian-family host (what PiVPN itself supports) with PiVPN's
WireGuard install, `python3`, `sudo` and OpenSSH server. Python's standard library
is all that is used; nothing is downloaded.

## Install

You need the app's **public** key (never the private one). Then, from a checkout
of this repository on the host:

    sudo python3 host/wgmanager-host install --pubkey-file app_key.pub

It prints a plan (what will be created, replaced or left alone), asks before
changing anything, applies the steps with sshd last, and undoes its own changes
if any step fails. `--dry-run` shows the plan only; `--yes` skips the question.
Running it again is safe and only changes what differs, so the same command also
upgrades the helper.

By default the key may connect from this machine (`127.0.0.1`, `::1`) and from the
container network `172.29.88.0/29`, the small subnet the project's compose file
pins for the app. Use `--allow-from 10.1.2.0/24,...` to give your own list.
Installing without `--pubkey-file` sets up everything except the key.

## Check

    sudo python3 host/wgmanager-host doctor

Read-only. Checks the PiVPN files and permissions, the installed helper, the
`wgweb` account, the sudo rule, the effective sshd settings for that account and
the authorized key, then makes one real call through the same path the app uses.
Each problem is shown with the exact path and the command that fixes it. Run it
first if anything misbehaves.

## Uninstall

    sudo python3 host/wgmanager-host uninstall

Removes the sshd drop-in (reloading sshd first), the key file, the sudo rule, the
helper and the `wgweb` account. The helper's backups of your WireGuard config in
`/var/backups/wgmanager` are kept unless you pass `--purge`.

## What it changes on the host

| Path | Purpose |
|---|---|
| `/usr/local/sbin/wgmanager-helper` | the root-owned helper |
| `wgweb` system user | no home, no password, no groups of note |
| `/etc/sudoers.d/wgmanager` | lets `wgweb` run the helper with `--ssh`, nothing else |
| `/etc/ssh/sshd_config.d/wgmanager.conf` | for user `wgweb` only: key login, no tty, no forwarding, forced command |
| `/etc/wgmanager/authorized_keys` | the app's key, limited to the helper command and the allowed source addresses |
| `/etc/wgmanager/config` | optional settings (see `etc/wgmanager/config.example`); never created for you |
| `/var/backups/wgmanager` | created by the helper on the first change |

It never edits an existing file of yours. It adds its own files only, and refuses
to continue if `/etc/ssh/sshd_config` does not include `sshd_config.d`, if sshd's
`AllowUsers`/`AllowGroups` would lock `wgweb` out, or if the PiVPN files are
writable by non-root users.

## Tests

    python3 -m unittest discover -s host/tests -v

See `host/tests/README.md`.
