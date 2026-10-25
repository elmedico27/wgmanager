# wgmanager host helper: specification

**Status:** helper 0.1.4 implemented in `host/wgmanager-helper` with unit tests
(`host/tests/`), all passing against stub `pivpn`/`wg`. 0.1.1 was verified on a
real host (section 14 records what was checked); 0.1.2 to 0.1.4 add the fixes
listed in sections 17 and 18. `host/wgmanager-host doctor` reuses
the helper's preflight checks (section 10) and is covered by its own tests.
**Scope:** the host-side, root-privileged component only. The web app, UI and
container are specified separately and must treat this document as the contract.

The helper is the only part of wgmanager that runs as root. Every other
component (web app, container, SSH key) is untrusted relative to it. It is
written first, kept small enough to read in one sitting, and any change to it
gets its own review.

## 1. Design summary

- **One file.** `wgmanager-helper`, Python 3 standard library only, no build step.
- **Backend (v1): PiVPN.** The helper does not edit WireGuard config itself.
  It calls the `pivpn` CLI to add, remove, enable and disable clients, and reads
  PiVPN's own files to report state. PiVPN is in maintenance mode upstream
  (the project announced a shutdown in April 2024 but kept shipping releases into
  late 2025). The request/response contract in sections 4 to 6 is deliberately
  independent of PiVPN so a native WireGuard backend could replace it later
  without changing the app.
- **Never trust the backend's exit code.** PiVPN exits 0 for "client does not
  exist" and when its service reload fails. Every mutation is verified by
  re-reading state afterwards (section 8).
- **Validate everything, twice.** The app validates names; the helper validates
  again as if the caller were hostile.

## 2. Files and ownership

Repository paths are under `host/`. Installed paths and permissions:

| Installed path | Owner / mode | Purpose |
|---|---|---|
| `/usr/local/sbin/wgmanager-helper` | root:root 0755 | the helper |
| `/etc/wgmanager/config` | root:root 0644 | optional settings (section 9) |
| `/etc/wgmanager/authorized_keys` | root:root 0644 | the app's SSH key and its restrictions |
| `/etc/sudoers.d/wgmanager` | root:root 0440 | the single sudo rule |
| `/etc/ssh/sshd_config.d/wgmanager.conf` | root:root 0644 | `Match User wgweb` block |
| `/var/backups/wgmanager/` | root:root 0700 | pre-change copies of PiVPN state |
| `/run/wgmanager.lock` | root | `flock` target (created on demand) |

The unprivileged account must not be able to modify any of these. The
`authorized_keys` file lives outside the account's home and is root-owned so a
compromised account cannot rewrite its own restrictions.

Account creation (copy-paste form is in the install docs, later):

```
useradd --system --user-group --home-dir /nonexistent --no-create-home \
        --shell /bin/sh --password '*' wgweb
```

The password field `*` means no password can ever match, without marking the
account "locked" (`!`), which sshd refuses for key logins when `UsePAM` is off.

The shell must stay a real shell (`/bin/sh`, not `nologin`): sshd runs forced
commands through the account's shell, so `nologin` would break them. The forced
command plus `restrict` is what constrains the key, not the shell.

## 3. How a request reaches the helper

```
app (container)                         VPN host
ssh -i key wgweb@host "add Bob_Phone"
        |
        v
sshd  Match User wgweb: key-only login, no TTY, no forwarding
      ForceCommand  = sudo -n /usr/local/sbin/wgmanager-helper --ssh
      authorized_keys command= (identical string; ForceCommand wins if both set)
      client's string "add Bob_Phone" -> SSH_ORIGINAL_COMMAND
        |
        v
sudo  one rule, exact arguments (no wildcards); environment reset except
      SSH_ORIGINAL_COMMAND
        |
        v
wgmanager-helper --ssh   (root)
      parse request -> validate -> act -> one JSON document on stdout
```

### 3.1 Files (contents)

`/etc/sudoers.d/wgmanager` (validate with `visudo -cf` before installing):

```
Defaults!/usr/local/sbin/wgmanager-helper env_keep += "SSH_ORIGINAL_COMMAND"
wgweb ALL=(root) NOPASSWD: /usr/local/sbin/wgmanager-helper --ssh
```

`/etc/ssh/sshd_config.d/wgmanager.conf` (validate with `sshd -t` before reload):

```
Match User wgweb
    AuthorizedKeysFile /etc/wgmanager/authorized_keys
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AuthenticationMethods publickey
    PermitTTY no
    X11Forwarding no
    AllowAgentForwarding no
    AllowTcpForwarding no
    PermitTunnel no
    DisableForwarding yes
    ForceCommand sudo -n /usr/local/sbin/wgmanager-helper --ssh
```

`DisableForwarding` also covers Unix-socket forwarding, which `AllowTcpForwarding`
does not. The key's `restrict` option already blocks it; this is a second layer.

`/etc/wgmanager/authorized_keys` (one line; `from=` is the container subnet,
pinned in the compose file):

```
command="sudo -n /usr/local/sbin/wgmanager-helper --ssh",restrict,from="<container subnet>" ssh-ed25519 AAAA... wgmanager
```

## 4. Request grammar

The request is the single string the client passes to `ssh`. There is no
quoting, no shell, and no stdin.

```
request = action [ SP name ]
action  = "version" | "list" | "add" | "remove" | "enable" | "disable" | "get-config"
```

- `version` and `list` take no name. The other actions require exactly one.
- The whole string is length-checked (max 64 bytes) and then matched with
  `re.fullmatch` against `[a-z][a-z-]{0,15}( [A-Za-z0-9_][A-Za-z0-9_-]{0,14})?`.
  Character classes exclude newline and every shell metacharacter, so a
  newline, `;`, `$`, backtick, `..`, `/`, a leading `-`, a double space or any
  non-ASCII byte fails the match before any logic runs.
- The helper then splits on a single space (never `shlex`) and looks up the
  action in a fixed table. Unknown action, wrong argument count or failed match:
  exit 2 with the same generic error. It never reveals what is allowed.

### 4.1 Client name rules

A valid name must satisfy all of:

1. matches `[A-Za-z0-9_][A-Za-z0-9_-]{0,14}` (1 to 15 characters; no leading `-`)
2. is not all digits (PiVPN treats a numeric argument as a list index, so
   `remove 1` would remove the first client)
3. is not `server` (reserved by PiVPN)
4. for `add` only: no existing client name equals it case-insensitively

This is deliberately stricter than PiVPN, which also allows `.` and `@` and
inserts names into `grep` and `sed` patterns where `.` is a wildcard.

An existing PiVPN client is still listed, with `manageable: false`, when its name
fails these rules (for example one with a `.`) or its address is outside the VPN
subnet (section 7). No action can address it, `get-config` included: an unsafe
name fails the request grammar, and an out-of-subnet client is refused once
found. Both return `invalid_request`. Manage such clients with `pivpn` directly.
The UI should disable their buttons and show the matching warning.

## 5. Responses and exit codes

Exactly one JSON document on stdout, UTF-8, one line. Error `message` values
are fixed strings; they never echo caller input.

```json
{"ok": true,  "protocol": 1, "data": { ... }}
{"ok": false, "protocol": 1, "error": {"code": "not_found", "message": "client not found"}}
```

| Exit | `error.code` | Meaning |
|---|---|---|
| 0 | none | success |
| 2 | `invalid_request` | bad syntax, unknown action, invalid name |
| 3 | `not_found` | client does not exist |
| 4 | `exists` | `add` for a name already in use |
| 5 | `backend_failed` | the backend failed or post-verification did not match; **state may be partial** (see section 8.1 for the structured detail the UI must show) |
| 6 | `host_misconfigured` | preflight failed (permissions, missing PiVPN, bad config) |
| 7 | `busy` | could not take the lock within 10 s |
| 10 | `internal` | unexpected error; details to the journal only |

stderr carries nothing the app should parse. The helper logs to the system
journal (identifier `wgmanager-helper`): `action=add client=Bob_Phone result=ok`
or `result=error:backend_failed`. **Config text, keys and PiVPN output are never
logged.**

## 6. Actions

`protocol` is an integer the app requires to match exactly. It increments on any
incompatible change to this section. `helper_version` is informational.

### version

Runs without preflight, so the app can report a protocol mismatch even when the
host is otherwise misconfigured. `pivpn_scripts` is diagnostic only (`null` for an
unreadable script); it is never enforced.

```json
{"helper_version": "0.1.4", "protocol": 1, "backend": "pivpn", "interface": "wg0",
 "pivpn_scripts": {"makeCONF.sh": "<sha256>", "removeCONF.sh": "<sha256>",
                   "enableCONF.sh": "<sha256>", "disableCONF.sh": "<sha256>"}}
```

### list

One call returns clients and live stats (one SSH round trip per UI refresh).

```json
{
  "interface": {"name": "wg0", "up": true, "public_key": "...", "listen_port": 51820},
  "clients": [{
    "name": "Alice_Tablet", "public_key": "...", "address": "10.0.0.9",
    "created_at": 1779754272,
    "enabled": true, "live": true, "manageable": true,
    "endpoint": "203.0.113.5:51820",
    "latest_handshake": 1779760000,
    "transfer_rx": 12345, "transfer_tx": 6789
  }],
  "warnings": []
}
```

- `enabled` comes from the markers in `wg0.conf`; `null` means no marker block
  was found for that client (inconsistent; a warning is added).
- `live` is whether the peer is present on the running interface. A disabled
  client is not live. `enabled` and `live` disagreeing is worth showing in the UI.
- When the client is **not live** (interface down, client disabled, or peer
  otherwise absent from the interface), `endpoint`, `latest_handshake` and both
  `transfer_*` are `null`.
- When it **is live** but has had no handshake since the interface last started,
  `endpoint` and `latest_handshake` are `null` (`wg` reports `(none)` and `0`),
  while `transfer_rx` and `transfer_tx` are numbers, normally `0`. All four come
  from `wg show <iface> dump` and reset when the interface restarts.
- `endpoint` is the client's address as last seen by the server (where its
  packets came from), not the server's own endpoint from the client config.
- **Direction:** `transfer_rx` is bytes the server received *from* the client
  (the client's upload); `transfer_tx` is the client's download. The UI must
  label these from the client's point of view.
- The interface private key and every preshared key are read from `wg show ... dump`
  and **discarded**. They are never copied into any output.

### add NAME

Creates the client. Returns the new client, in the same shape as in `list` (live
stats are usually `null` because the peer has not connected yet), and its full
config text, which **contains the client's private key**.

```json
{"client": { ...as in list... }, "config": "[Interface]\nPrivateKey = ...\n..."}
```

### remove NAME

```json
{"name": "Bob_Phone", "removed": true}
```

### enable NAME / disable NAME

Idempotent. If the client is already in the requested state the helper does not
call PiVPN at all. Two inconsistent cases are handled deliberately:

- *enabled but not live* (marker says enabled, peer absent from the interface):
  `enable` makes one `pivpn on` call, because `pivpn on` always reloads the service.
- *disabled but still live*, or *no marker block at all*: `disable`/`enable` change
  nothing and return `backend_failed` with `partial: false`, because `pivpn off` on an
  already-disabled client does nothing and the helper does not reload services itself.

```json
{"client": { ...as in list... }, "changed": true}
```

Disabling an actively connected client cuts that session; that is expected.

### get-config NAME

Returns the stored client config (**contains the private key**).

```json
{"name": "Alice_Tablet", "config": "[Interface]\n..."}
```

There is deliberately no action that writes arbitrary configuration, and none
that runs an arbitrary command.

## 7. Reading state

All files are opened by constructed absolute path from validated names only.
Reads use `O_NOFOLLOW`, require a regular file, and cap size (clients.txt 1 MiB,
a client config 8 KiB).

- **`<WG_DIR>/configs/clients.txt`**: one client per line,
  `name public_key created_epoch address_decimal`. Fields are validated
  (public key is 44-character base64, epoch and address are digits). A malformed
  line is skipped and reported in `warnings`; it does not fail `list`. A stray
  non-UTF-8 byte or a Windows line ending spoils only its own line. `address` is
  the decimal field converted to dotted form.
- **VPN subnet check:** the subnet is read from PiVPN's `setupVars.conf`
  (`pivpnNET` and `subnetClass`, quotes allowed; key names verified against
  PiVPN's own scripts and a real install). A client whose address is outside
  it is **listed but marked `manageable: false`**, with a warning. Hiding a real
  peer would be worse than greying it out. If the subnet cannot be read, the check
  is skipped and a warning says so.
- **`<WG_DIR>/wg0.conf`** (the file for the configured interface): scanned line
  by line with exact string comparison, never with a pattern built from a name.
  A client is *enabled* if the line `### begin NAME ###` exists and *disabled*
  if `#[disabled] ### begin NAME ###` exists. The helper reads this file only to
  learn enabled state; it never parses or modifies the `[Interface]` section.
- **Live state:** `wg show <iface> dump` (fixed argv, 5 s timeout). Handshake
  times and byte counters are 64-bit values of up to 20 digits. Line 1 is the
  interface (`private-key public-key listen-port fwmark`; only `public-key` and
  `listen-port` are used). Each further line is a peer
  (`public-key preshared-key endpoint allowed-ips latest-handshake transfer-rx transfer-tx persistent-keepalive`;
  only the public key, endpoint, handshake and transfer fields are used).
  Interface down is reported as `up: false`, not as an error.
- **Client config:** `<WG_DIR>/configs/NAME.conf`, the copy PiVPN keeps.

## 8. Mutations

Common procedure for `add`, `remove`, `enable`, `disable`:

1. Parse and validate the request (sections 4 and 4.1). Run preflight (section 10).
2. Take an exclusive `flock` on `/run/wgmanager.lock` (retry up to 10 s, else exit 7).
   The lock only serializes wgmanager's own calls; it cannot stop someone
   running `pivpn` by hand at the same moment.
3. Read state and check preconditions (table below).
4. **Back up** `wg0.conf` and `clients.txt` to
   `/var/backups/wgmanager/<UTC timestamp to the ms>-<action>-<name>.{<iface>.conf,clients.txt}`
   (root-only, mode 0600; keep the newest `BACKUP_KEEP`, default 20). If the backup
   cannot be written the change is aborted before anything is touched. The backup
   holds the server private key, exactly like the file it copies.
5. Run the backend with a fixed argument list, working directory `/`, empty
   stdin, a minimal environment (`PATH=/usr/sbin:/usr/bin:/sbin:/bin`,
   `LC_ALL=C`), `umask 077`, and a 30 s timeout. The backend runs in its own
   process group; on timeout the whole group is killed, so nothing `pivpn` started
   can keep changing files after the helper answers and releases the lock.
6. Re-read state and verify postconditions (table below). Live-interface checks
   retry for up to 3 s.
7. Log the result and return it.

Backend commands (all `execve`-style argument lists, never a shell string):

| Action | Command |
|---|---|
| add | `PIVPN_BIN add -n NAME` |
| remove | `PIVPN_BIN remove --yes NAME` |
| enable | `PIVPN_BIN on --yes NAME` |
| disable | `PIVPN_BIN off --yes NAME` |

Commands run the symlink-resolved path that preflight vetted, not the configured
name. `add` does not pass `-ip`: older PiVPN scripts (including the v4.6.x-era scripts) do not have it, and newer ones allocate automatically when
stdin is empty. One invocation form works on both.

| Action | Preconditions | Postconditions (all must hold, else exit 5) |
|---|---|---|
| add | name valid; not in clients.txt (case-insensitive); no `configs/NAME.conf` | in clients.txt; `configs/NAME.conf` exists; enabled marker present; peer live on the interface |
| remove | name valid and manageable; in clients.txt | gone from clients.txt; no marker block; `configs/NAME.conf` gone; peer not live |
| enable | as above; if already enabled, return `changed:false` and stop | enabled marker present; peer live |
| disable | as above; if already disabled, return `changed:false` and stop | disabled marker present; peer not live |

**Timing for the app.** The worst case for one mutation is about 45 s (10 s lock
wait, 30 s backend, 3 s verification, plus reads). The app's SSH timeout must be
longer (60 s), and the app must never retry a mutation on its own after a
timeout. The outcome is unknown until a fresh `list`.

**No automatic rollback in v1.** If postconditions fail, the helper exits 5 and
leaves the state as it is; the pre-change backup is the recovery path (manual
restore, documented). Automatic rollback by calling PiVPN again can compound a
failure and is deferred.

### 8.1 Failure reporting (required)

A failed or partial mutation must never look like a generic error. Exit 5 carries
structured detail so the UI can show a clear, persistent warning:

```json
{"ok": false, "protocol": 1,
 "error": {"code": "backend_failed", "message": "change may be incomplete",
           "partial": true,
           "failed_checks": ["live_peer"],
           "backend_exit_code": 0,
           "backup": "20261020T211500123Z-add-Bob_Phone"}}
```

- `failed_checks` uses a fixed vocabulary, never free text: `client_record`
  (clients.txt entry), `client_config_file`, `server_config_block` (marker block
  in the server config), `live_peer` (peer on the running interface),
  `backend_timeout`, `backend_not_run`.
- `partial` is `true` when any postcondition could not be confirmed, i.e. the
  host may now differ from what the app showed before the request.
- `backup` names the pre-change backup (basename only, no path), so the UI can
  tell the admin which file to restore.
- `backend_exit_code` is informational. A 0 with a failed check is the common
  case (PiVPN reports success when its reload fails).

**UI requirement (for the app spec):** on exit 5 the UI shows a persistent,
dismiss-on-acknowledge warning, not a toast and not `alert()`. It names the
client and action, lists the failed checks in plain language, states that the
change may be incomplete, and points to the recovery steps. The client's row is
flagged until a fresh `list` shows `enabled` and `live` agreeing again.

## 9. Settings

`/etc/wgmanager/config` is optional, root-owned, and read only by the helper.
Settings never come from the caller. Format: `KEY=value` lines, `#` comments,
unknown keys are an error. Paths must be absolute with no `..` component.

| Key | Default | Validation |
|---|---|---|
| `WG_INTERFACE` | `wg0` | `[A-Za-z0-9_-]{1,15}`; PiVPN itself hardcodes `wg0`, so any other value will fail verification |
| `WG_DIR` | `/etc/wireguard` | absolute path, must exist |
| `PIVPN_BIN` | `/usr/local/bin/pivpn` | absolute path |
| `WG_BIN` | `/usr/bin/wg` | absolute path |
| `PIVPN_SCRIPTS_DIR` | `/opt/pivpn/wireguard` | absolute path (only read, for `version` hashes) |
| `PIVPN_SETUPVARS` | `/etc/pivpn/wireguard/setupVars.conf` | absolute path |
| `LOCK_FILE` | `/run/wgmanager.lock` | absolute path |
| `BACKUP_DIR` | `/var/backups/wgmanager` | absolute path |
| `BACKUP_KEEP` | `20` | integer 1 to 200 |

The public endpoint and client DNS are not helper settings: PiVPN already bakes
them into each client config.

## 10. Preflight (every call)

Fail with exit 6 `host_misconfigured` (fixed message; detail to the journal) unless:

- the process is running as root;
- the config file, if present, is owned by root and not group- or world-writable;
- `PIVPN_BIN` and `WG_BIN` are resolved through symlinks **once**; the resolved
  target and its own directory must be root-owned and not group- or
  world-writable. The helper then executes the resolved path it just vetted. The
  directory that merely holds a symlink (for example `/usr/local/bin`, which is
  user-owned on some systems) is deliberately not trusted or checked: swapping the link can only point at something that must itself pass
  these checks;
- `<WG_DIR>/configs/clients.txt`, `<WG_DIR>/<iface>.conf` and PiVPN's
  `setupVars.conf` exist, are regular files, root-owned, not group- or
  world-writable. These files are checked again on the open file descriptor
  when they are read, so a file swapped in after the first check is still
  refused. The settings file is checked the same way;
- `PIVPN_SCRIPTS_DIR` exists, and it and every `*.sh` in it are root-owned and
  not group- or world-writable: `pivpn` runs those scripts as root. The same
  applies to the directory one level up and its `*.sh` files, because the
  scripts source shared ones from there (`/opt/pivpn/ipaddr_utils.sh`). Only
  what is present is judged.

Note: PiVPN creates its files mode 644 and `configs/` 755, so private keys are
readable by any local user. That is a host
problem independent of wgmanager. Run as root, the helper sets `umask 077` before
calling PiVPN so anything it creates is private; tightening existing files is an
optional, documented one-time step.

## 11. Rules the code must follow

- Fixed argument lists only; no shell; no string-built commands; no `shell=True`.
- No secret ever appears in argv, in a log line, or in an error message. Secrets
  appear only in the stdout of `add` and `get-config`.
- Every subprocess has a timeout. Every file read has a size cap.
- Paths come from validated names only; no user-supplied path component exists.
- Python: `python3 -I` semantics (isolated mode), explicit
  `#!/usr/bin/python3 -I` shebang, no imports from the working directory.
- No third-party imports.
- Unexpected exceptions map to exit 10 with a fixed message.

## 12. Admin CLI and testing

Run directly as root, the same file works as an admin and test tool:

```
wgmanager-helper [--config PATH] <action> [name]
```

`--ssh` mode accepts no other arguments and no `--config`, and the sudo rule
names exactly `--ssh`, so the unprivileged account cannot reach the other mode.

Tests use the standard library `unittest` (no dependencies). Run from the repository root:
`python3 -m unittest discover -s host/tests -v`.

1. **Parser and validator**, no root needed. Hostile inputs: spaces, newline,
   `;`, `$()`, backticks, leading `-`, `../`, `/`, empty, 16+ characters, all
   digits, `server`, unknown and mixed-case actions, extra and missing
   arguments, non-ASCII, a name that is another client's prefix, case-collision
   names.
2. **Backend behavior** against a temporary directory tree and a stub `PIVPN_BIN`
   (a script that mimics PiVPN's real output and quirks, including exit 0 on
   "does not exist" and a failed reload).
3. **State parsing** against real-format `clients.txt`, `wg0.conf` and `dump`
   fixtures, including disabled peers and malformed lines.
4. **Integration** (later, needs root): a throwaway WireGuard interface and the
   real PiVPN scripts in a disposable VM.

A mock helper that returns canned JSON in this exact format will be built
separately so the UI can be developed without a VPN host.

## 13. What the app's key can and cannot do

If the web app, its container or the SSH key is compromised, an attacker can:

- list clients and see which are connected, from where, and how much they transfer;
- **create a new VPN client**, which is a working credential into your network;
- enable, disable or delete existing clients;
- **read every client's config, including private keys** (`get-config`).

They cannot, through this key: get a shell, run any command other than the seven
actions, read or write any other file, edit the server's `[Interface]` section,
or reach `PostUp`/`PreUp`. Treat the web UI as sensitive: LAN-only, strong
admin password, never exposed to the internet.

Because retaining client configs is inherent to PiVPN, this exposure exists
today on the host regardless of wgmanager.

## 14. Verified on a real host

Checked with helper 0.1.1 (and 0.1.2/0.1.3 for `doctor`, `install` and the
setupVars layout) on Debian 13 with PiVPN's WireGuard scripts at v4.6.2
(identified by the `version` hashes; v4.7.0 ships the same four scripts),
wireguard-tools v1.0.20210914, OpenSSH 10.0p2, sudo 1.9.16p2, Python 3.13:

1. `Defaults!command env_keep` passes `SSH_ORIGINAL_COMMAND` through sudo.
2. sshd uses the configured `ForceCommand` when `command=` is also present, and
   sets `SSH_ORIGINAL_COMMAND`.
3. Key login works for the system account; password login is impossible, and
   `from=` is enforced.
4. The `wg show <iface> dump` column layout matches section 7.
5. A full add/disable/enable/remove cycle left existing VPN sessions up (their
   transfer counters never reset).
6. `pivpn add -n NAME` with empty stdin completes without prompting.
7. `wgmanager-host install`, `doctor`, `uninstall` and reinstall all ran clean.

Verified from source, not run:

- PiVPN's quirks reproduced by the test double (exit 0 for an unknown client and
  for a failed reload, `off` not reloading when already disabled, `add -n` name
  rules): `removeCONF`/`enableCONF`/`disableCONF`/`makeCONF.sh` at v4.6.2.
  `remove`/`on`/`off` are unchanged up to v4.11.1.
- Empty-stdin `pivpn add -n NAME` on current scripts (v4.11.1): the client-IP
  prompt reads EOF, the address is allocated automatically, and nothing aborts
  (no `set -e`).
- `sshd -T` prints `AllowUsers`/`DenyUsers`/`AllowGroups`/`DenyGroups` one line
  per entry, and sshd matches each entry on its own with `*`/`?` wildcards only
  (OpenSSH 10.0p2 `servconf.c`, `auth.c`, `match.c`).

Still to check:

- The source address sshd sees from the container matches the `from=` subnet
  (once the container exists).

## 15. Decisions taken during review

1. Backups before each change: yes.
2. PiVPN script hashes in `version`: yes, informational only.
3. Root-owned `authorized_keys` outside the home: yes.
4. No automatic rollback in v1, on the condition that failures are reported
   clearly (section 8.1). Revisit after real use.

## 16. Out of scope for v1

Importing clients created outside PiVPN, multiple interfaces, IPv6-specific
handling beyond what PiVPN does itself, editing any config, a native
(non-PiVPN) backend, and non-systemd hosts.

## 17. Changes in 0.1.2

- Byte counters and handshake times of up to 20 digits are accepted. Before, a
  peer with more than about 999 GB of traffic was dropped from the live list,
  which also made post-change verification blind for that peer.
- On backend timeout the whole process group is killed (section 8).
- Clients outside the VPN subnet are listed as unmanageable (sections 4.1 and 7).
- File checks are repeated on the opened file descriptor, and PiVPN's `*.sh`
  scripts are vetted (section 10).
- A non-UTF-8 byte or CRLF in `clients.txt` spoils one line, not the whole list.

## 18. Changes in 0.1.3 and 0.1.4

- The VPN subnet is read from `pivpnNET`, the key PiVPN actually writes (0.1.2
  looked for `pivNET`, which no PiVPN version has used, so the subnet check
  was always skipped with a warning).
- 0.1.4: script vetting also covers the parent of `PIVPN_SCRIPTS_DIR`, whose
  shared scripts the WireGuard scripts source as root.
- `wgmanager-host` (not the helper): `AllowUsers`/`DenyUsers`/`AllowGroups`/
  `DenyGroups` are read from every `sshd -T` line, not just the first, and
  matched entry by entry as sshd does. Before, `AllowUsers alice wgweb` made
  doctor report wgweb as locked out and install refuse to run.
