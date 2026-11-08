---
title: Helper protocol
outline: deep
---

# Helper protocol

This page describes the helper (version 0.1.5): the small program on your server
that WG Manager runs over SSH. The web app reaches the server only through the
requests and responses below. `wgmanager-host doctor` runs the same preflight
checks as the helper (section 10).

The helper is the only part of WG Manager that runs as root. It treats every
other component (web app, container, SSH key) as untrusted, and is kept small
enough to read in one sitting. Version history is in the
[changelog](https://github.com/elmedico27/wgmanager/blob/master/CHANGELOG.md).

## 1. Design summary

- **One file.** `wgmanager-helper`, Python 3 standard library only, no build step.
- **Backend: PiVPN.** The helper does not edit WireGuard config itself.
  It calls the `pivpn` CLI to add, remove, enable and disable clients, and reads
  PiVPN's own files to report state.
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

The installer creates the account like this:

```
useradd --system --user-group --home-dir /nonexistent --no-create-home \
        --shell /bin/sh --password '*' --comment 'wgmanager service account' wgweb
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

This is stricter than PiVPN, which also allows `.` and `@` and
inserts names into `grep` and `sed` patterns where `.` is a wildcard.

An existing PiVPN client is still listed, with `manageable: false`, when its name
fails these rules (for example one with a `.`) or its address is outside the VPN
subnet (section 7). No action can address it, `get-config` included: an unsafe
name fails the request grammar, and an out-of-subnet client is refused once
found. Both return `invalid_request`. Manage such clients with `pivpn` directly.
WG Manager greys them out, shows the reason and offers no buttons.

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
| 5 | `backend_failed` | the backend failed or post-verification did not match; **state may be partial** (see section 8.1) |
| 6 | `host_misconfigured` | preflight failed (permissions, missing PiVPN, bad config) |
| 7 | `busy` | could not take the lock within 10 s |
| 10 | `internal` | unexpected error; details to the journal only |

stderr carries nothing the app should parse. The helper logs to the system
journal (identifier `wgmanager-helper`): `action=add client=Bob_Phone result=ok`
or `result=error:backend_failed`. Every `add`, `remove`, `enable`, `disable` and
`get-config` is logged, success or failure, so the journal shows which client
configs (and so which private keys) were read. **Config text, keys and PiVPN
output are never logged**, only the action, client name and result.

## 6. Actions

`protocol` is an integer the app requires to match exactly. It increments on any
incompatible change to this section. `helper_version` is informational.

### version

Runs without preflight, so the app can report a protocol mismatch even when the
host is otherwise misconfigured. `pivpn_scripts` is diagnostic only; it is never
enforced. Each script is read like any other file (a symlink is resolved once,
then the target must be a regular file of at most 1 MiB); anything else, or a
missing script, is `null`.

```json
{"helper_version": "0.1.5", "protocol": 1, "backend": "pivpn", "interface": "wg0",
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
  client is not live. When `enabled` and `live` disagree, WG Manager shows a
  yellow status dot.
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
  (the client's upload); `transfer_tx` is the client's download. WG Manager
  labels them from the client's point of view.
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
call PiVPN at all. Two inconsistent cases are handled like this:

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

There is no action that writes arbitrary configuration, and none
that runs an arbitrary command.

## 7. Reading state

All files are opened by constructed absolute path from validated names only.
Reads use `O_NOFOLLOW` and `O_NONBLOCK` (so a FIFO is refused instead of
blocking), require a regular file, and cap size (clients.txt 1 MiB, a client
config 8 KiB).

- **`<WG_DIR>/configs/clients.txt`**: one client per line,
  `name public_key created_epoch address_decimal`. Fields are validated
  (public key is 44-character base64, epoch and address are digits). A malformed
  line is skipped and reported in `warnings`; it does not fail `list`. A stray
  non-UTF-8 byte or a Windows line ending spoils only its own line. `address` is
  the decimal field converted to dotted form.
- **VPN subnet check:** the subnet is read from PiVPN's `setupVars.conf`
  (`pivpnNET` and `subnetClass`, quotes allowed). A client whose address is
  outside it is **listed but marked `manageable: false`**, with a warning. If the
  subnet cannot be read, the check is skipped and a warning says so.
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
- **Client config:** `<WG_DIR>/configs/NAME.conf`, the copy PiVPN keeps. It gets
  the same open-file check as the files in section 10 (root-owned, not group- or
  world-writable); one that fails is reported as `client_config_file`.

## 8. Mutations

Common procedure for `add`, `remove`, `enable`, `disable`:

1. Parse and validate the request (sections 4 and 4.1). Run preflight (section 10).
2. Check where the change will write (else exit 6). `LOCK_FILE` and `BACKUP_DIR` are
   resolved through symlinks once, and the directory each really lives in must exist,
   be root-owned and not be group- or world-writable (`/run` and `/var/backups` by
   default). The lock file itself must be a root-owned regular file that group and
   others cannot write, and the backup directory a root-owned directory with mode
   0700 (created if missing). Reads (`list`, `get-config`, `version`) skip this step,
   so a host that fails it can still be viewed.
   Then take an exclusive `flock` on `/run/wgmanager.lock` (retry up to 10 s, else exit 7).
   The lock only serializes wgmanager's own calls; it cannot stop someone
   running `pivpn` by hand at the same moment.
3. Read state and check preconditions (table below).
4. **Back up** `wg0.conf` and `clients.txt` to
   `/var/backups/wgmanager/<UTC timestamp to the ms>-<action>-<name>.{<iface>.conf,clients.txt}`
   as byte-for-byte copies (root-only, mode 0600; keep the newest `BACKUP_KEEP`, default 20). If the backup
   cannot be written the change is aborted before anything is touched. The backup
   holds the server private key, exactly like the file it copies.
5. Run the backend with a fixed argument list, working directory `/`, empty
   stdin, a minimal environment (`PATH=/usr/sbin:/usr/bin:/sbin:/bin`,
   `LC_ALL=C`), `umask 077`, and a 30 s timeout. Its stdout and stderr go to
   `/dev/null` (they are never read or logged). The backend runs in its own
   process group, and the whole group is killed on timeout and again once `pivpn`
   exits, so nothing it started can keep changing files after the helper answers
   and releases the lock.
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
name. `add` does not choose an address: PiVPN assigns the next free one.

| Action | Preconditions | Postconditions (all must hold, else exit 5) |
|---|---|---|
| add | name valid; not in clients.txt (case-insensitive); no `configs/NAME.conf` | in clients.txt; `configs/NAME.conf` exists; enabled marker present; peer live on the interface |
| remove | name valid and manageable; in clients.txt | gone from clients.txt; no marker block; `configs/NAME.conf` gone; peer not live |
| enable | as above; if already enabled, return `changed:false` and stop | enabled marker present; peer live |
| disable | as above; if already disabled, return `changed:false` and stop | disabled marker present; peer not live |

**Timing.** The worst case for one mutation is about 45 s (10 s lock wait, 30 s
backend, 3 s verification, plus reads). WG Manager waits up to 60 s and never
retries a change on its own. After a timeout the outcome is unknown until a fresh
`list`.

**No automatic rollback.** If postconditions fail, the helper exits 5 and leaves
the state as it is. The pre-change backup is the way back; see
[Recovering from a failed change](../guide/recovery).

### 8.1 Failure reporting

A failed or partial mutation never looks like a generic error. Exit 5 carries
structured detail so WG Manager can show a clear, persistent warning:

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
- If state cannot be re-read at all after the backend ran, every check that
  action makes is listed (none of them could be confirmed). Enable and disable
  never list `client_config_file`, because they don't check it.
- `partial` is `true` when any postcondition could not be confirmed, i.e. the
  host may now differ from what the app showed before the request.
- `backup` names the pre-change backup (basename only, no path), so the UI can
  tell the admin which file to restore.
- `backend_exit_code` is informational. A 0 with a failed check is the common
  case (PiVPN reports success when its reload fails).

On exit 5, WG Manager shows a warning on every page that stays until you
acknowledge it. It names the client and action, lists the failed checks in plain
language, says the change may be incomplete, and links to the recovery steps. The
client stays flagged until a fresh `list` shows `enabled` and `live` agreeing
again.

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
| `LOCK_FILE` | `/run/wgmanager.lock` | absolute path; its directory must be root-owned and not group- or world-writable (section 8) |
| `BACKUP_DIR` | `/var/backups/wgmanager` | absolute path; may be a symlink; its real parent directory must be root-owned and not group- or world-writable (section 8) |
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
  user-owned on some systems) is not trusted or checked: swapping the link can
  only point at something that must itself pass these checks;
- `<WG_DIR>` and `<WG_DIR>/configs` exist, are directories, root-owned, and not
  group- or world-writable. Whoever can write to a directory can rename, replace
  or hard-link the files in it, which `O_NOFOLLOW` and the per-file checks
  alone cannot stop;
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

Note: PiVPN creates its files mode 644 and `configs/` 755. What keeps the private
keys in them from other local users is `/etc/wireguard` itself, which
wireguard-tools creates mode 0700. If that directory has been opened up, the keys
are readable by any local user: a host problem independent of wgmanager (the
checks above refuse it only when it is *writable*). Run as root, the helper sets
`umask 077` before calling PiVPN so anything it creates is private. It does not
change PiVPN's existing files.

## 11. Implementation rules

- Fixed argument lists only; no shell; no string-built commands; no `shell=True`.
- No secret ever appears in argv, in a log line, or in an error message. Secrets
  appear only in the stdout of `add` and `get-config`.
- Every subprocess has a timeout. Every file read has a size cap.
- Paths come from validated names only; no user-supplied path component exists.
- Python: `python3 -I` semantics (isolated mode), explicit
  `#!/usr/bin/python3 -I` shebang, no imports from the working directory.
- No third-party imports.
- Unexpected exceptions map to exit 10 with a fixed message.

## 12. Admin CLI

Run directly as root, the same file works as an admin and test tool:

```
wgmanager-helper [--config PATH] <action> [name]
```

`--ssh` mode accepts no other arguments and no `--config`, and the sudo rule
names exactly `--ssh`, so the unprivileged account cannot reach the other mode.

How the helper is tested is described under
[Contributing](../development/#host-tests).

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

## 14. Not supported

Importing clients created outside PiVPN, multiple interfaces, IPv6-specific
handling beyond what PiVPN does itself, editing any config, a native
(non-PiVPN) backend, and non-systemd hosts.
