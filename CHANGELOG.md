# Changelog

All notable changes to WG Manager are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[semantic versioning](https://semver.org/).

The helper installed on your server has its own version number, shown on the
**Host** page. Each release below names the helper version it ships with. After
updating the app, rerun the install command from **Settings › App key** to update
the helper too.

## [Unreleased]

Ships helper 0.1.5. Rerun the install command from **Settings › App key** to
update it.

### Added

- **Install as an app:** WG Manager now has a web app manifest and icons, so a
  browser can add it to a phone's home screen or a computer's apps and open it
  in its own window. Browsers only offer a full install over HTTPS (or
  `localhost`); over plain HTTP you may get a shortcut. There is no offline
  mode and no service worker.

### Changed

- **Admin password length:** a password must now be 12 to 128 characters. The
  minimum counts characters as people see them (an emoji is one), where it used
  to count UTF-16 units, so a new password of only a few emoji that would have
  passed before is now refused as too short. The maximum is 128 bytes (it was 1024 characters); plain English
  letters, digits and symbols are one byte each, accented letters, other scripts
  and emoji use 2 to 4. A password that is too long is refused with a message,
  never cut short. If your current password is longer than 128 bytes you can no
  longer sign in with it: run `docker exec wgmanager wgmanager reset-password` and
  choose a new one.

### Fixed

- **Helper:** a stray non-UTF-8 byte in `wg0.conf` (for example an accented
  letter in a comment saved as Latin-1) no longer blocks every add, remove,
  enable and disable with "host is misconfigured". Backups are now byte-for-byte
  copies.
- **Helper:** if a new client's config can't be read back after `add`, the
  error now names the pre-change backup and PiVPN's exit code instead of
  leaving them empty.
- **Helper:** a change that passed verification is reported from the state it
  verified. Before, running `pivpn` by hand at that moment could turn a
  successful change into a generic "internal error".
- **Helper:** a FIFO where a file is expected is refused instead of hanging the
  helper.
- **Helper:** if PiVPN's files can't be re-read after enabling or disabling a
  client, the warning no longer says the client's config file check failed;
  enable and disable don't check that file.
- **Helper:** PiVPN's output is sent to `/dev/null` instead of being held in
  memory and discarded. Anything PiVPN leaves running in the background is
  stopped when it exits, so nothing it started can change files after the
  helper has answered.
- **Helper:** `version` reads PiVPN's scripts safely when it hashes them: a
  FIFO, device or file over 1 MiB is reported as `null` instead of hanging the
  helper or being read without limit.

### Security

- **Helper:** `/etc/wireguard` and its `configs/` folder (or wherever `WG_DIR`
  points) must now be root-owned and not writable by group or others, like the
  files in them. Client configs read by `get-config` get the same owner and
  permission check as PiVPN's other files. PiVPN's own defaults already pass;
  `wgmanager-host doctor` shows the fix if yours don't.
- **Helper:** before a change, the lock file and backup folder must live in
  folders only root can write to, and the lock file must be a root-owned file
  others can't write. A symlinked backup folder (for example on another disk) is
  fine if its real location passes. The defaults (`/run`, `/var/backups`)
  already pass; if you moved either with `LOCK_FILE` or `BACKUP_DIR`,
  `wgmanager-host doctor` says what to fix. Viewing clients is never blocked by
  this.
- **Helper:** successful `get-config` requests are now logged to the journal
  (action, client name and result only), so you can see which private keys were
  read. Keys and config text are still never logged.

## [0.2.1] - 2026-11-06

Ships helper 0.1.4.

### Changed

- A new note can only be saved for a client in the current list. Notes already
  saved for clients removed outside WG Manager can still be edited or cleared.
- Notes no longer accept the Unicode line and paragraph separators, C1 control
  characters or bidirectional override characters (emoji are unaffected).
- The notes box can be resized vertically (it was showing a resize handle that
  did nothing).

### Fixed

- A notes refresh that was already in flight could briefly put an older note
  back on screen right after saving.
- An unsaved note is no longer lost when its client leaves the list while you
  are typing.
- The note counter counts the trimmed text, as the server does, so trailing
  spaces no longer make a 500-character note look too long.
- Back and Forward with an unsaved note open now keep the Forward history when
  you choose to keep editing.
- Deleting a client while the notes file is damaged now logs that its note
  could not be removed.
- A failed notes request now shows a message instead of failing silently.
- Screen readers announce a client's note icon as "Has a note", and the rest of
  the panel is switched off while the "Discard unsaved note?" question is open.
- The version numbers in `web/`, `server/` and `docs/` now match the release.

## [0.2.0] - 2026-11-06

Ships helper 0.1.4.

### Added

- A **Helper update available** notice at the top of every page when the helper
  on the server is older than the one the app comes with. It shows the update
  command and clears itself once the helper is current.
- **Client notes:** a Notes box in each client's panel (up to 500 characters),
  with a note icon on the client's card and list row. Notes are kept in the
  app's data volume (`notes.json`), not on the server, and are deleted with the
  client when you delete it in WG Manager.
- **Search** on the Clients page: a magnifying-glass button opens a search box
  that filters clients by name, address or note. The filter stays on (shown by
  a dot on the button) until you clear it, reload or sign out.
- Screenshots of the Clients, Host and Settings pages on the documentation
  site's Web interface page, in light and dark.

### Changed

- The live demo moved to https://wgmdemo.pages.dev and is now built directly
  from this repository's `web/` folder.
- Clients WG Manager can't manage (a name it doesn't accept, or an address
  outside the VPN's range) now open in the panel, read-only: a warning, their
  details and note, no QR code or config, and the buttons switched off.
- Card view's **Sort by** row is now behind an arrows button next to Search, in
  the same pull-out box, so the Clients page has less clutter on phones.

### Fixed

- Public keys in the client panel and on the Host page are shown in the same
  colour as the other details.

## [0.1.3] - 2026-11-04

Ships helper 0.1.4.

### Added

- Documentation site, built from `docs/` with VitePress and published to
  GitHub Pages.
- Public demo build (`npm run build:demo` in `web/`): the web UI on an
  in-browser mock with sample data, where each visitor's changes stay in their
  own browser tab.

### Changed

- The **Recovery steps** link on a failed-change warning opens the recovery
  guide on the documentation site.
- The README follows a shorter layout (overview, install, update, uninstall)
  and links to the documentation site for everything else.
- Usage, configuration, troubleshooting and background information, the
  recovery guide and the helper specification moved from the README and
  `docs/` to the documentation site.
- The image is built on Node 26.13.0, the first Node 26 LTS release, and the
  web UI is built with Vite 8.3.5.
- Helper specification: clarified that a client which is live but has never
  completed a handshake reports transfer counters of 0, and that all four live
  statistics are empty only when the client is not live.

## [0.1.2] - 2026-10-25

Ships helper 0.1.4.

### Added

- Images are also published to Docker Hub (`elmedico27/wgmanager`) with the
  same tags as GitHub Container Registry, which stays the default.
- **Settings** links to the image on Docker Hub.

### Security

- The runtime image no longer contains npm, npx, Corepack or Yarn. The app
  never used them, and their bundled packages were the source of all
  vulnerability-scanner findings. Alpine packages are upgraded when the image
  is built.

## [0.1.1] - 2026-10-25

Ships helper 0.1.4.

### Added

- Each page has its own address (`/clients`, `/host`, `/settings`), and so does
  each client's panel (`/clients/<name>`). The browser's Back and Forward
  buttons work.
- A "Page not found" page for unknown addresses, served with HTTP status 404.
- Favicon and home-screen icon.

### Changed

- README expanded with installation, usage, configuration, troubleshooting and
  uninstall guidance.

## [0.1.0] - 2026-10-24

First release. Ships helper 0.1.4.

### Added

- Web UI: clients as cards or a sortable list, add, enable, disable and delete,
  QR code and config download, **Host** and **Settings** pages, light and dark
  themes, and a warning on every page when a change fails or only partly
  happens.
- Backend: one admin password (scrypt), set with a one-time setup code;
  sessions with idle and absolute time limits; protection against cross-site
  requests; rate-limited sign-in; strict security headers.
- Connection to the server over SSH with the app's own key and a pinned server
  fingerprint. One connection is reused for up to 5 minutes.
- Server helper and the `wgmanager-host` tool (`doctor`, `install`,
  `uninstall`).
- Docker image for amd64 and arm64 on GitHub Container Registry, with a
  hardened `compose.yaml` (read-only, non-root, no capabilities).
- README, recovery guide and GPL-3.0 license.

## Helper history before 0.1.0

### Helper 0.1.4

- Script vetting also covers the parent of `PIVPN_SCRIPTS_DIR`, whose shared
  scripts the WireGuard scripts source as root.
- `wgmanager-host` (not the helper): `AllowUsers`, `DenyUsers`, `AllowGroups`
  and `DenyGroups` are read from every `sshd -T` line, not just the first, and
  matched entry by entry as sshd does. Before, `AllowUsers alice wgweb` made
  `doctor` report `wgweb` as locked out and `install` refuse to run.

### Helper 0.1.3

- The VPN subnet is read from `pivpnNET`, the key PiVPN actually writes. 0.1.2
  looked for `pivNET`, which no PiVPN version has used, so the subnet check was
  always skipped with a warning.

### Helper 0.1.2

- Byte counters and handshake times of up to 20 digits are accepted. Before, a
  peer with more than about 999 GB of traffic was dropped from the live list,
  which also made post-change verification blind for that peer.
- On a backend timeout the whole process group is killed.
- Clients outside the VPN subnet are listed as unmanageable.
- File checks are repeated on the opened file descriptor, and PiVPN's `*.sh`
  scripts are vetted.
- A non-UTF-8 byte or CRLF in `clients.txt` spoils one line, not the whole
  list.

### Helper 0.1.1

First version, verified on a real host (with 0.1.2 and 0.1.3 for `doctor`,
`install` and the setupVars layout): Debian 13, PiVPN's WireGuard scripts
v4.6.2 (v4.7.0 ships the same four), wireguard-tools v1.0.20210914,
OpenSSH 10.0p2, sudo 1.9.16p2, Python 3.13.

- `Defaults!command env_keep` passes `SSH_ORIGINAL_COMMAND` through sudo.
- sshd uses the configured `ForceCommand` when `command=` is also present, and
  sets `SSH_ORIGINAL_COMMAND`.
- Key login works for the system account; password login is impossible, and
  `from=` is enforced, including for connections from the app's container.
- The `wg show <iface> dump` column layout matches the specification.
- A full add, disable, enable and remove cycle left existing VPN sessions up
  (their transfer counters never reset).
- `pivpn add -n NAME` with empty stdin completes without prompting.
- `wgmanager-host install`, `doctor`, `uninstall` and reinstall all ran clean.

Verified from source, not run:

- PiVPN's quirks reproduced by the test double (exit 0 for an unknown client
  and for a failed reload, `off` not reloading when already disabled, `add -n`
  name rules), from `removeCONF`, `enableCONF`, `disableCONF` and `makeCONF.sh`
  at v4.6.2. `remove`, `on` and `off` are unchanged up to v4.11.1.
- Empty-stdin `pivpn add -n NAME` on current scripts (v4.11.1): the client-IP
  prompt reads end-of-file, the address is allocated automatically, and nothing
  aborts.
- `sshd -T` prints `AllowUsers`, `DenyUsers`, `AllowGroups` and `DenyGroups`
  one line per entry, and sshd matches each entry on its own with `*` and `?`
  wildcards only (OpenSSH 10.0p2).

[Unreleased]: https://github.com/elmedico27/wgmanager/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/elmedico27/wgmanager/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/elmedico27/wgmanager/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/elmedico27/wgmanager/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/elmedico27/wgmanager/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/elmedico27/wgmanager/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/elmedico27/wgmanager/releases/tag/v0.1.0
