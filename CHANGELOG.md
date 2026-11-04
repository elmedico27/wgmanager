# Changelog

All notable changes to WG Manager are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[semantic versioning](https://semver.org/).

The helper installed on your server has its own version number, shown on the
**Host** page. Each release below names the helper version it ships with. After
updating the app, rerun the install command from **Settings › App key** to update
the helper too.

## [Unreleased]

### Added

- Documentation site, built from `docs/` with VitePress and published to
  GitHub Pages.
- Public demo build (`npm run build:demo` in `web/`): the web UI on an
  in-browser mock with sample data, where each visitor's changes stay in their
  own browser tab.

### Changed

- Usage, configuration, troubleshooting and background information, the
  recovery guide and the helper specification moved from the README and
  `docs/` to the documentation site.
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

[Unreleased]: https://github.com/elmedico27/wgmanager/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/elmedico27/wgmanager/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/elmedico27/wgmanager/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/elmedico27/wgmanager/releases/tag/v0.1.0
