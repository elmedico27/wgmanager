---
title: Security
---

# Security

- The container runs as a non-root user with a read-only filesystem, no Linux capabilities and `no-new-privileges`. Only its data volume is writable.
- The admin password is stored as a scrypt hash in the data volume. Sign-in, setup and password changes are rate limited. Sessions live in memory (a restart signs everyone out), end after 6 hours idle or 7 days in total, and are protected against cross-site requests.
- Client configs and QR codes contain the client's private key. QR codes are made on request. Neither is cached by the browser or written to the app's log.
- There is no automatic rollback. If a change fails partway, WG Manager says so and leaves the backups for you to check. See [Recovering from a failed change](./recovery).
