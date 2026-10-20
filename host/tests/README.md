# Host tests

Standard library only; no root, WireGuard, PiVPN, sshd or sudo needed.

    python3 -m unittest discover -s host/tests -v

- `test_helper.py` tests `wgmanager-helper`. `fakes/pivpn` and `fakes/wg` are test
  doubles. `fakes/pivpn` reproduces real PiVPN quirks on purpose (exit 0 on "does
  not exist", reload failures that still exit 0) so the helper's after-the-fact
  verification is exercised. The fake `wg` dump contains secret sentinel strings;
  tests assert they never appear in output or logs.
- `test_host.py` tests `wgmanager-host doctor` against a throwaway directory tree.
  Every external command (`sshd`, `sudo`, `visudo`, `id`, `getent`) is answered
  from a table, so each way a real server can be misconfigured is reproducible.
  It also asserts that `doctor` changes nothing.
- `test_install.py` tests `install` and `uninstall` against a stateful fake system
  (accounts, files, sshd, sudo). It checks what ends up on disk, that sshd is changed
  last, that a failure at any step restores the previous state, and that running
  twice changes nothing.
