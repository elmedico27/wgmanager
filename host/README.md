# host/: developer notes

The host side of WG Manager. Installing, updating, uninstalling and what it changes on the server are covered in the [main README](../README.md). This file is for working on the code.

## Files

- `wgmanager-helper`: the root-owned helper installed to `/usr/local/sbin`. One Python file, standard library only. Its request/response contract, exit codes and backup behavior are in [docs/HELPER-SPEC.md](../docs/HELPER-SPEC.md).
- `wgmanager-host`: `doctor`, `install` and `uninstall` (`--help` on each). It finds the helper and the `etc/` templates next to its own file, and asks for confirmation only on a real terminal.
- `etc/`: templates for the sudo rule, the sshd drop-in and the optional `/etc/wgmanager/config` (`config.example`).
- `tests/`: see [tests/README.md](tests/README.md).

The image ships this directory at `/opt/wgmanager/host`, and the install command copies it to `/usr/local/lib/wgmanager`. `install` runs as root and copies the helper from wherever `wgmanager-host` sits, so keep that directory writable only by root (or by you, for a checkout).

## Running from a checkout

Instead of the copy from the container, which is useful for reading the code first or testing changes:

    sudo python3 host/wgmanager-host install --pubkey-file app_key.pub
    sudo python3 host/wgmanager-host doctor
    sudo python3 host/wgmanager-host uninstall

Only ever pass the app's public key.

## Tests

    python3 -m unittest discover -s host/tests -v

No root, WireGuard, PiVPN, sshd or sudo needed. Every external command is faked. Run under different umasks (002, 022, 077) when touching file modes.
