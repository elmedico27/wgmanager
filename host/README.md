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

`install` runs as root and copies the helper from the directory it sits in, so
treat that directory like any other root-run code: keep it writable only by root
(or by you, for a checkout of this repository).

## Install

The usual way: the web app's first-run screen shows one command that copies this
directory out of the running container into `/usr/local/lib/wgmanager` (as root,
so the copy is root-owned) and runs `install` with the app's **public** key
filled in:

    sudo docker cp wgmanager:/opt/wgmanager/host/. /usr/local/lib/wgmanager && \
      sudo python3 /usr/local/lib/wgmanager/wgmanager-host install --pubkey "ssh-ed25519 AAAA... wgmanager@container"

The copy stays there for `doctor`, upgrades (run the same command again) and
`uninstall`. If you would rather read the code first, use a checkout of this
repository instead (never the private key):

    sudo python3 host/wgmanager-host install --pubkey-file app_key.pub

It prints a plan (what will be created, replaced or left alone), asks before
changing anything, applies the steps with sshd last, and undoes its own changes
if any step fails. `--dry-run` shows the plan only; `--yes` skips the question.
Running it again is safe and only changes what differs, so the same command also
upgrades the helper. Its last line is the server's SSH fingerprint
(`Server fingerprint for the web UI: SHA256:... (ED25519)`): the web app shows the
fingerprint it sees and asks you to confirm they match before it trusts the
server. The app only accepts the server's ED25519 host key, which Debian creates
by default.

By default the key may connect from this machine (`127.0.0.1`, `::1`) and from the
container network `172.29.88.0/29`, the small subnet the project's compose file
pins for the app. It was picked only to be unlikely to collide with existing
networks. If it clashes with one of yours, change it in the compose file and give
the same value here with `--allow-from 10.1.2.0/24,...`. Networks must be written
without host bits (`10.1.2.0/24`, not `10.1.2.5/24`); install refuses them because
sshd would reject the key from every address. Install also points out an entry
that overlaps the VPN client subnet: a Docker network must never overlap it.
Installing without `--pubkey-file` sets up everything except the key.

Install fixes what belongs to wgmanager rather than leaving it for `doctor`: it
tightens an existing `/etc/wgmanager` that is writable by others, and gives the
`wgweb` account the password field `*` (no usable password, but not "locked",
which sshd refuses for key logins when `UsePAM` is off). It never changes anything
that belongs to someone else. PiVPN's files and scripts that are writable by
non-root users, or a `wgweb` account that someone put in a privileged group such
as `sudo` or `docker`, stop the install with the exact command to fix them.

On systems where sshd is socket-activated (Ubuntu 22.10 and later), the ssh
service only runs after the first connection. Install needs it running, so
connect over SSH once first. There, the port and listen addresses come from
`ssh.socket`, not `sshd_config`.

## Check

    sudo python3 /usr/local/lib/wgmanager/wgmanager-host doctor

(or `host/wgmanager-host` from a checkout).

Read-only. Checks the PiVPN files and permissions, the installed helper, the
`wgweb` account, the sudo rule, the effective sshd settings for that account, the
server's ED25519 host key (and its fingerprint) and the authorized key, then makes
one real call through the same path the app uses.
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
| `/etc/ssh/sshd_config.d/wgmanager.conf` | for user `wgweb` only: key login, no tty, no forwarding of any kind, forced command |
| `/etc/wgmanager/authorized_keys` | the app's key, limited to the helper command and the allowed source addresses |
| `/etc/wgmanager/config` | optional settings (see `etc/wgmanager/config.example`); never created for you |
| `/var/backups/wgmanager` | created by the helper on the first change |

It never edits an existing file of yours. It adds its own files only, and refuses
to continue if `/etc/ssh/sshd_config` does not include `sshd_config.d`, if sshd's
`AllowUsers`/`AllowGroups` would lock `wgweb` out, or if PiVPN's files or scripts
are writable by non-root users.

## Tested with

Debian 13, PiVPN's WireGuard scripts at v4.6.2 (v4.7.0 ships the same
`removeCONF`/`enableCONF`/`disableCONF`/`makeCONF.sh`), wireguard-tools
v1.0.20210914, OpenSSH 10.0p2, sudo 1.9.16p2 and Python 3.13. Current PiVPN
(v4.11.1) differs only in `makeCONF.sh`; the helper's use of it was checked
against that script's source but has not been run. `wgmanager-helper version`
reports hashes of the scripts on your host for comparison.

## Tests

    python3 -m unittest discover -s host/tests -v

See `host/tests/README.md`.
