---
title: Security
---

# Security

What WG Manager does to protect your server, and what it logs.

## The container

- Runs as a non-root user with a read-only filesystem, no Linux capabilities and `no-new-privileges`.
- Only its data volume is writable.

## Sign-in

- The admin password is stored as a scrypt hash in the data volume.
- Passwords must be 12 to 128 characters. The maximum is counted in UTF-8 bytes and checked before any hashing. A password that is too long is refused, never shortened.
- Sign-in, setup and password changes are rate limited.
- Sessions live in memory, so a restart signs everyone out. They end after 6 hours idle or 7 days in total, and are protected against cross-site requests.

## Update check {#update-check}

- Off by default. With it off (and [notifications](#notifications) off), the container makes no connection other than SSH to your server.
- If you turn it on, then once at start and every 12 hours WG Manager asks GitHub (`api.github.com`) for the latest release of WG Manager. Besides SSH to your server and, if you turn them on, notifications, this is the only connection the container makes.
- The request carries no information about you or your server, only a `User-Agent` with the app's own version. GitHub sees the container's public IP address, as with any web request.
- Only a higher release number is used. Nothing is downloaded, installed or written to disk. If GitHub can't be reached, the notice simply doesn't appear.
- Only release images check. An `edge` image or one you built yourself doesn't contact GitHub at all.
- Set `UPDATE_CHECK=1` (or `true`) in `.env` to turn it on. See [Settings](./configuration#settings).

## Notifications {#notifications}

- Off by default. With `NTFY_ENABLE` off, WG Manager makes no connection to any ntfy server.
- If you turn it on, WG Manager sends short, generic messages to the ntfy server at `NTFY_URL`: that a change may be incomplete, that your VPN server can't be reached or its setup has a problem, or that a release number is available. They never contain client names, keys, addresses or config text.
- With an `https://` address the certificate is checked. With `http://` the messages and the token travel unencrypted, which suits a ntfy on a network you trust; WG Manager logs a warning at start when the address is `http://` and a token or password is set.
- To notice server problems while no browser is open, WG Manager checks your server about once a minute with the same two read-only requests the web UI makes (`version` and `list`; the helper does not log them). Nothing is checked if `NTFY_ENABLE` is off.
- Redirects are not followed, so a redirect can't send the token to another host.
- A failed send never affects changes to your server. It is logged once, without the address or the token.
- The token or password is stored in `.env` next to `compose.yaml`, like your other settings, and anyone who can read that file or inspect the container can read it. Use a ntfy user that can only publish to the one topic, so a leaked token can't read your messages.
- See [Send notifications to ntfy](./configuration#ntfy).

## Client configs

- Client configs and QR codes contain the client's private key.
- QR codes are made on request.
- Neither is cached by the browser or written to the app's log.

## Logging

- The helper logs every add, remove, enable, disable and config read to the server's system journal, so you can see which clients' configs were read:

  ```sh
  journalctl -t wgmanager-helper
  ```

- Only the action, client name and result are logged, never keys or config text.

## Failed changes

- There is no automatic rollback. If a change fails partway, WG Manager says so and leaves the backups for you to check. See [Recovering from a failed change](./recovery).

## Reporting a vulnerability

Don't open a public issue. Follow the [security policy](https://github.com/elmedico27/wgmanager/security/policy).
