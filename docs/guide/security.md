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
