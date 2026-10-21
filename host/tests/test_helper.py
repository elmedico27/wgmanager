"""Tests for host/wgmanager-helper (standard library `unittest` only).

Run from the repository root:
    python3 -m unittest discover -s host/tests -v

No root, no WireGuard and no PiVPN needed: the helper is pointed at a temporary
directory tree and the stubs in tests/fakes/ stand in for `pivpn` and `wg`.
"""
import importlib.machinery
import importlib.util
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import fcntl

HERE = os.path.dirname(os.path.abspath(__file__))
HELPER_PATH = os.path.join(os.path.dirname(HERE), "wgmanager-helper")

_loader = importlib.machinery.SourceFileLoader("wgmanager_helper", HELPER_PATH)
_spec = importlib.util.spec_from_loader("wgmanager_helper", _loader)
h = importlib.util.module_from_spec(_spec)
_loader.exec_module(h)

SECRETS = ("FAKEPRIVSECRET", "FAKEPSKSECRET")


class Env:
    """A throwaway host: WG_DIR, stub binaries, switches, backup dir."""

    def __init__(self, test):
        self.root = tempfile.mkdtemp(prefix="wgm-test-")
        test.addCleanup(shutil.rmtree, self.root, True)
        for sub in ("bin", "wg/configs", "ctl", "scripts"):
            os.makedirs(os.path.join(self.root, sub))
        for name in ("pivpn", "wg"):
            src = os.path.join(HERE, "fakes", name)
            dst = os.path.join(self.root, "bin", name)
            with open(src) as handle:
                body = handle.read().split("\n", 1)[1]
            with open(dst, "w") as handle:
                handle.write("#!%s\n%s" % (sys.executable, body))
            os.chmod(dst, 0o755)
        self.write("wg/wg0.conf", "[Interface]\nPrivateKey = SERVERPRIVATEKEY\n"
                   "Address = 10.0.0.1/24\nListenPort = 51820\n")
        self.write("wg/configs/clients.txt", "")
        self.write("wg/live.txt", "")
        self.write("setupVars.conf", "pivNET=10.0.0.0\nsubnetClass=24\n")
        for name in DIAG_SCRIPTS:
            self.write("scripts/" + name, "#!/bin/bash\n# " + name + "\n")

    def p(self, rel):
        return os.path.join(self.root, rel)

    def write(self, rel, text):
        with open(self.p(rel), "w") as handle:
            handle.write(text)

    def read(self, rel):
        with open(self.p(rel)) as handle:
            return handle.read()

    def switch(self, name, on=True):
        path = self.p("ctl/" + name)
        if on:
            open(path, "w").close()
        elif os.path.exists(path):
            os.unlink(path)

    def settings(self, **overrides):
        values = dict(h.SETTING_DEFAULTS)
        values.update({
            "WG_DIR": self.p("wg"),
            "PIVPN_BIN": self.p("bin/pivpn"),
            "PIVPN_SCRIPTS_DIR": self.p("scripts"),
            "PIVPN_SETUPVARS": self.p("setupVars.conf"),
            "WG_BIN": self.p("bin/wg"),
            "BACKUP_DIR": self.p("backups"),
            "LOCK_FILE": self.p("lock"),
        })
        values.update(overrides)
        return h.Settings(values, enforce_owner=False)

    def call(self, request, **overrides):
        return h.handle(lambda: self.settings(**overrides), request)

    def seed(self, name, enabled=True):
        """Create a client using the stub, as PiVPN would have."""
        subprocess.run([self.p("bin/pivpn"), "add", "-n", name], check=True)
        if not enabled:
            subprocess.run([self.p("bin/pivpn"), "off", "--yes", name], check=True)
        self.clear_calls()

    def calls(self):
        path = self.p("calls.log")
        if not os.path.exists(path):
            return []
        return [ln for ln in self.read("calls.log").split("\n") if ln]

    def clear_calls(self):
        if os.path.exists(self.p("calls.log")):
            os.unlink(self.p("calls.log"))

    def backups(self):
        path = self.p("backups")
        return sorted(os.listdir(path)) if os.path.isdir(path) else []


DIAG_SCRIPTS = h.DIAGNOSTIC_SCRIPTS


class HelperTestCase(unittest.TestCase):
    def setUp(self):
        # The helper refuses group/world-writable files, so fixtures must not
        # inherit the runner's umask (Debian logins commonly use 002).
        previous = os.umask(0o022)
        self.addCleanup(os.umask, previous)
        self.env = Env(self)
        # Never write test traffic to the host's real journal; capture it so we
        # can also assert that no secret ever reaches a log line.
        self.logged = []
        original_log = h.log
        h.log = lambda level, message: self.logged.append(message)
        self.addCleanup(setattr, h, "log", original_log)
        self.addCleanup(self.assert_no_secrets_logged)
        # Keep failure-path tests fast.
        for attr, value in (("VERIFY_TIMEOUT", 0.2), ("VERIFY_INTERVAL", 0.05),
                            ("LOCK_TIMEOUT", 0.3), ("BACKEND_TIMEOUT", 1.0)):
            old = getattr(h, attr)
            setattr(h, attr, value)
            self.addCleanup(setattr, h, attr, old)

    def assert_no_secrets_logged(self):
        for line in self.logged:
            for secret in SECRETS + ("SERVERPRIVATEKEY", "FAKEPRIVATEKEY", "PrivateKey"):
                self.assertNotIn(secret, line)

    def ok(self, request, **overrides):
        code, response = self.env.call(request, **overrides)
        self.assertEqual(code, 0, response)
        self.assertTrue(response["ok"])
        return response["data"]

    def err(self, request, code_name, exit_code, **overrides):
        code, response = self.env.call(request, **overrides)
        self.assertEqual(code, exit_code, response)
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], code_name, response)
        return response["error"]


# --- grammar -----------------------------------------------------------------

HOSTILE = [
    "", " ", "list ", " list", "list  ", "list\n", "\nlist", "add", "add ", "add  x",
    "add a b", "list x", "version x", "ADD x", "List", "add -x", "add --yes", "add -",
    "add a;b", "add a&b", "add a|b", "add $(id)", "add `id`", "add ${HOME}", "add a\nb",
    "add a\rb", "add\nlist", "add a\x00b", "add ../x", "add ..", "add a/b", "add a\\b",
    "add a.b", "add a@b", "add a b", "add a'b", 'add a"b', "add 123", "add 0", "add server",
    "add " + "a" * 16, "add " + "a" * 100, "x" * 100, "add é", "add ١٢",
    "rm -rf /", "list; id", "list && id", "shutdown", "get-config", "remove 1",
    "enable 007", "remove  x", "removeX", "remove-all x", "get-config x y",
    "list\t", "add\tx", "add x\n", "add x\x00",
]


class GrammarTests(unittest.TestCase):
    def test_valid_requests(self):
        for request, expected in (
                ("version", ("version", None)), ("list", ("list", None)),
                ("add Bob_Phone", ("add", "Bob_Phone")),
                ("get-config Alice_Tablet", ("get-config", "Alice_Tablet")),
                ("remove a", ("remove", "a")), ("enable _x", ("enable", "_x")),
                ("disable a-b_C9", ("disable", "a-b_C9")),
                ("add " + "a" * 15, ("add", "a" * 15)), ("add a1", ("add", "a1"))):
            self.assertEqual(h.parse_request(request), expected, request)

    def test_hostile_requests_rejected(self):
        for request in HOSTILE:
            with self.assertRaises(h.HelperError, msg=repr(request)) as ctx:
                h.parse_request(request)
            self.assertEqual(ctx.exception.code, "invalid_request", repr(request))

    def test_non_strings_rejected(self):
        for value in (None, b"list", 5, ["list"]):
            with self.assertRaises(h.HelperError):
                h.parse_request(value)

    def test_safe_name_rules(self):
        for good in ("a", "Alice_Tablet", "BobSmith", "Alice_Phone_sp", "x-y", "_a", "a1", "1a"):
            self.assertTrue(h.is_safe_name(good), good)
        for bad in ("", "123", "server", "-a", "a.b", "a@b", "a b", "a" * 16, "é"):
            self.assertFalse(h.is_safe_name(bad), bad)

    def test_existing_client_names_all_conform(self):
        for name in ("Alice_Phone", "Alice_Phone_sp", "BobSmith", "Carol_Phone",
                     "Carol_Laptop", "Dave_Tablet", "TravelRouter", "Alice_Tablet"):
            self.assertTrue(h.is_safe_name(name), name)


class HostileNeverReachesBackend(HelperTestCase):
    def test_no_backend_call_and_no_echo(self):
        self.env.seed("Keep")
        for request in HOSTILE:
            code, response = self.env.call(request)
            self.assertEqual(code, 2, repr(request))
            self.assertEqual(response["error"]["code"], "invalid_request")
            blob = json.dumps(response)
            if len(request.strip()) > 3:
                self.assertNotIn(request.strip(), blob)
        self.assertEqual(self.env.calls(), [])
        self.assertEqual(self.env.backups(), [])


# --- read-only actions -------------------------------------------------------

class VersionTests(HelperTestCase):
    def test_version(self):
        data = self.ok("version")
        self.assertEqual(data["protocol"], h.PROTOCOL)
        self.assertEqual(data["backend"], "pivpn")
        self.assertEqual(data["interface"], "wg0")
        self.assertEqual(sorted(data["pivpn_scripts"]), sorted(DIAG_SCRIPTS))
        for digest in data["pivpn_scripts"].values():
            self.assertRegex(digest, r"^[0-9a-f]{64}$")

    def test_missing_scripts_report_null(self):
        os.unlink(self.env.p("scripts/makeCONF.sh"))
        self.assertIsNone(self.ok("version")["pivpn_scripts"]["makeCONF.sh"])


class ListTests(HelperTestCase):
    def test_list_states_and_no_secrets(self):
        self.env.seed("Alpha")
        self.env.seed("Bravo", enabled=False)
        data = self.ok("list")
        self.assertEqual(data["interface"]["name"], "wg0")
        self.assertTrue(data["interface"]["up"])
        self.assertEqual(data["interface"]["listen_port"], 51820)
        self.assertEqual(data["interface"]["public_key"], self.server_key())
        by_name = {c["name"]: c for c in data["clients"]}
        a, b = by_name["Alpha"], by_name["Bravo"]
        self.assertEqual((a["enabled"], a["live"], a["manageable"]), (True, True, True))
        self.assertEqual((b["enabled"], b["live"]), (False, False))
        self.assertEqual(a["address"], "10.0.0.2")
        self.assertEqual(b["address"], "10.0.0.3")
        self.assertEqual(a["endpoint"], "203.0.113.5:51820")
        self.assertEqual((a["latest_handshake"], a["transfer_rx"], a["transfer_tx"]),
                         (1700000000, 111, 222))
        self.assertIsNone(b["endpoint"])
        self.assertIsNone(b["transfer_rx"])
        blob = json.dumps(data)
        for secret in SECRETS + ("SERVERPRIVATEKEY", "FAKEPRIVATEKEY"):
            self.assertNotIn(secret, blob)

    def server_key(self):
        import base64, hashlib
        return base64.b64encode(hashlib.sha256(b"server").digest()).decode()

    def test_never_connected(self):
        self.env.seed("Alpha")
        self.env.switch("never_connected")
        c = self.ok("list")["clients"][0]
        self.assertTrue(c["live"])
        self.assertIsNone(c["endpoint"])
        self.assertIsNone(c["latest_handshake"])

    def test_large_transfer_counters(self):
        # A peer with more than 12 digits of traffic used to vanish from the
        # live list, which also blinded the post-change checks.
        self.env.seed("Alpha")
        self.env.switch("big_counters")
        c = self.ok("list")["clients"][0]
        self.assertTrue(c["live"])
        self.assertEqual(c["transfer_rx"], 1500000000000)
        self.assertEqual(c["transfer_tx"], 18446744073709551615)

    def test_disable_is_verified_for_a_heavy_peer(self):
        self.env.seed("Alpha")
        self.env.switch("big_counters")
        self.env.switch("fail_reload")          # peer stays on the interface
        e = self.err("disable Alpha", "backend_failed", 5)
        self.assertIn("live_peer", e["failed_checks"])

    def test_interface_down(self):
        self.env.seed("Alpha")
        self.env.switch("iface_down")
        data = self.ok("list")
        self.assertFalse(data["interface"]["up"])
        self.assertIsNone(data["interface"]["public_key"])
        self.assertFalse(data["clients"][0]["live"])
        self.assertTrue(data["clients"][0]["enabled"])

    def test_malformed_unsafe_and_duplicate_entries(self):
        self.env.seed("Alpha")
        with open(self.env.p("wg/configs/clients.txt"), "a") as handle:
            handle.write("garbage line\n")
            handle.write("a.b %s 1700000000 167772360\n" % ("A" * 43 + "="))
            handle.write("Alpha %s 1700000000 167772361\n" % ("B" * 43 + "="))
            handle.write("Bad %s notanumber 167772362\n" % ("C" * 43 + "="))
        data = self.ok("list")
        names = [c["name"] for c in data["clients"]]
        self.assertEqual(names, ["Alpha", "a.b"])
        dotted = data["clients"][1]
        self.assertFalse(dotted["manageable"])
        self.assertIsNone(dotted["enabled"])
        warnings = " | ".join(data["warnings"])
        self.assertIn("malformed entry skipped", warnings)
        self.assertIn("duplicate name skipped", warnings)
        self.assertIn("a.b: no marker block", warnings)

    def test_client_outside_vpn_subnet_is_listed_but_not_manageable(self):
        self.env.seed("Alpha")
        with open(self.env.p("wg/configs/clients.txt"), "a") as handle:
            # 192.0.2.10 (documentation range), outside the fixture's 10.0.0.0/24
            handle.write("Stray %s 1700000000 3221225994\n" % ("D" * 43 + "="))
        data = self.ok("list")
        stray = [c for c in data["clients"] if c["name"] == "Stray"][0]
        self.assertEqual(stray["address"], "192.0.2.10")
        self.assertFalse(stray["manageable"])
        self.assertTrue(data["clients"][0]["manageable"])
        self.assertIn("Stray: address 192.0.2.10 is outside the VPN subnet 10.0.0.0/24",
                      " | ".join(data["warnings"]))
        for request in ("remove Stray", "disable Stray", "get-config Stray"):
            self.err(request, "invalid_request", 2)
        self.assertEqual(self.env.calls(), [])

    def test_unknown_vpn_subnet_skips_the_check_and_says_so(self):
        self.env.write("setupVars.conf", "IPv4dev=eth0\n")
        self.env.seed("Alpha")
        data = self.ok("list")
        self.assertTrue(data["clients"][0]["manageable"])
        self.assertIn("could not read the VPN subnet", " | ".join(data["warnings"]))

    def test_quoted_setupvars_values(self):
        self.env.write("setupVars.conf", 'pivNET="10.0.0.0"\nsubnetClass=\'24\'\n')
        self.env.seed("Alpha")
        self.assertEqual(self.ok("list")["warnings"], [])

    def test_crlf_and_bad_bytes_spoil_only_their_own_line(self):
        self.env.seed("Alpha")
        path = self.env.p("wg/configs/clients.txt")
        with open(path, "rb") as handle:
            good = handle.read().replace(b"\n", b"\r\n")
        with open(path, "wb") as handle:
            handle.write(good + b"Bad\xff %s 1700000000 167772361\r\n" % (b"E" * 43 + b"="))
        data = self.ok("list")
        self.assertEqual([c["name"] for c in data["clients"]], ["Alpha"])
        self.assertIn("line 2: malformed entry skipped", " | ".join(data["warnings"]))

    def test_unmanageable_client_cannot_be_addressed(self):
        with open(self.env.p("wg/configs/clients.txt"), "a") as handle:
            handle.write("a.b %s 1700000000 167772360\n" % ("A" * 43 + "="))
        self.err("remove a.b", "invalid_request", 2)
        self.assertEqual(self.env.calls(), [])


class GetConfigTests(HelperTestCase):
    def test_get_config(self):
        self.env.seed("Alpha")
        data = self.ok("get-config Alpha")
        self.assertEqual(data["name"], "Alpha")
        self.assertIn("PrivateKey = FAKEPRIVATEKEY-Alpha", data["config"])

    def test_unknown_client(self):
        self.err("get-config Nobody", "not_found", 3)

    def test_config_file_missing(self):
        self.env.seed("Alpha")
        os.unlink(self.env.p("wg/configs/Alpha.conf"))
        e = self.err("get-config Alpha", "backend_failed", 5)
        self.assertFalse(e["partial"])
        self.assertEqual(e["failed_checks"], ["client_config_file"])

    def test_symlinked_config_refused(self):
        self.env.seed("Alpha")
        os.unlink(self.env.p("wg/configs/Alpha.conf"))
        os.symlink("/etc/passwd", self.env.p("wg/configs/Alpha.conf"))
        self.err("get-config Alpha", "backend_failed", 5)

    def test_oversized_config_refused(self):
        self.env.seed("Alpha")
        self.env.write("wg/configs/Alpha.conf", "x" * (h.MAX_CLIENT_CONF + 1))
        self.err("get-config Alpha", "backend_failed", 5)


# --- mutations ---------------------------------------------------------------

class AddTests(HelperTestCase):
    def test_add_success(self):
        data = self.ok("add Bob_Phone")
        self.assertEqual(self.env.calls(), ["add -n Bob_Phone"])
        client = data["client"]
        self.assertEqual((client["name"], client["enabled"], client["live"]),
                         ("Bob_Phone", True, True))
        self.assertIn("PrivateKey = FAKEPRIVATEKEY-Bob_Phone", data["config"])
        self.assertEqual(len(self.env.backups()), 2)

    def test_add_passes_no_ip_flag(self):
        self.ok("add Bob")
        self.assertNotIn("-ip", " ".join(self.env.calls()))

    def test_duplicate_exact_and_case_insensitive(self):
        self.env.seed("Bob")
        self.err("add Bob", "exists", 4)
        self.err("add bob", "exists", 4)
        self.err("add BOB", "exists", 4)
        self.assertEqual(self.env.calls(), [])
        self.assertEqual(self.env.backups(), [])

    def test_orphan_config_file_blocks_add(self):
        self.env.write("wg/configs/Ghost.conf", "stale")
        self.err("add Ghost", "exists", 4)
        self.assertEqual(self.env.calls(), [])

    def test_addresses_do_not_collide(self):
        a = self.ok("add One")["client"]["address"]
        b = self.ok("add Two")["client"]["address"]
        self.assertNotEqual(a, b)

    def test_reload_failure_reports_partial(self):
        self.env.switch("fail_reload")
        e = self.err("add Bob", "backend_failed", 5)
        self.assertTrue(e["partial"])
        self.assertEqual(e["failed_checks"], ["live_peer"])
        self.assertEqual(e["backend_exit_code"], 0)          # PiVPN said success
        self.assertRegex(e["backup"], r"^[0-9]{8}T[0-9]{9}Z-add-Bob$")
        self.assertTrue(any(f.startswith(e["backup"]) for f in self.env.backups()))
        self.assertEqual(sorted(e), ["backend_exit_code", "backup", "code",
                                     "failed_checks", "message", "partial"])

    def test_nonzero_exit_with_verified_state_is_success(self):
        self.env.switch("exit_nonzero")
        self.ok("add Bob")

    def test_timeout_reports_partial(self):
        self.env.switch("hang")
        e = self.err("add Bob", "backend_failed", 5)
        self.assertTrue(e["partial"])
        self.assertEqual(e["failed_checks"][0], "backend_timeout")

    def test_timeout_kills_everything_the_backend_started(self):
        import time
        self.env.switch("hang_child")
        e = self.err("add Bob", "backend_failed", 5)
        self.assertEqual(e["failed_checks"][0], "backend_timeout")
        time.sleep(1.2)          # past the moment the orphan would have written
        self.assertFalse(os.path.exists(self.env.p("late_write")),
                         "a process started by the backend survived the timeout")

    def test_backend_not_runnable(self):
        os.unlink(self.env.p("bin/pivpn"))
        # Missing binary is caught by preflight before anything changes.
        self.err("add Bob", "host_misconfigured", 6)
        self.assertEqual(self.env.backups(), [])


class RemoveTests(HelperTestCase):
    def test_remove_success(self):
        self.env.seed("Alpha")
        self.env.seed("Bravo")
        self.assertEqual(self.ok("remove Alpha"), {"name": "Alpha", "removed": True})
        self.assertEqual(self.env.calls(), ["remove --yes Alpha"])
        names = [c["name"] for c in self.ok("list")["clients"]]
        self.assertEqual(names, ["Bravo"])
        self.assertFalse(os.path.exists(self.env.p("wg/configs/Alpha.conf")))

    def test_remove_unknown_does_not_call_backend(self):
        self.err("remove Nobody", "not_found", 3)
        self.assertEqual(self.env.calls(), [])
        self.assertEqual(self.env.backups(), [])

    def test_remove_prefix_name_is_not_a_match(self):
        self.env.seed("Alice_Phone_sp")
        self.err("remove Alice_Phone", "not_found", 3)
        self.assertEqual(self.env.calls(), [])

    def test_remove_reload_failure(self):
        self.env.seed("Alpha")
        self.env.switch("fail_reload")
        e = self.err("remove Alpha", "backend_failed", 5)
        self.assertTrue(e["partial"])
        self.assertEqual(e["failed_checks"], ["live_peer"])


class ToggleTests(HelperTestCase):
    def test_disable_then_enable(self):
        self.env.seed("Alpha")
        d = self.ok("disable Alpha")
        self.assertTrue(d["changed"])
        self.assertEqual((d["client"]["enabled"], d["client"]["live"]), (False, False))
        e = self.ok("enable Alpha")
        self.assertTrue(e["changed"])
        self.assertEqual((e["client"]["enabled"], e["client"]["live"]), (True, True))
        self.assertEqual(self.env.calls(), ["off --yes Alpha", "on --yes Alpha"])

    def test_idempotent_without_backend_call(self):
        self.env.seed("Alpha")
        self.env.seed("Bravo", enabled=False)
        self.assertFalse(self.ok("enable Alpha")["changed"])
        self.assertFalse(self.ok("disable Bravo")["changed"])
        self.assertEqual(self.env.calls(), [])
        self.assertEqual(self.env.backups(), [])

    def test_enabled_but_not_live_gets_one_reload(self):
        self.env.seed("Alpha")
        self.env.write("wg/live.txt", "")                    # drift: marker says enabled
        data = self.ok("enable Alpha")
        self.assertTrue(data["changed"])
        self.assertTrue(data["client"]["live"])
        self.assertEqual(self.env.calls(), ["on --yes Alpha"])

    def test_disabled_but_live_is_reported_not_forced(self):
        self.env.seed("Alpha", enabled=False)
        pub = self.ok("list")["clients"][0]["public_key"]
        self.env.write("wg/live.txt", pub + "\n")            # drift: still on interface
        e = self.err("disable Alpha", "backend_failed", 5)
        self.assertFalse(e["partial"])                       # we changed nothing
        self.assertEqual(e["failed_checks"], ["live_peer"])
        self.assertEqual(self.env.calls(), [])

    def test_missing_marker_block(self):
        self.env.seed("Alpha")
        self.env.write("wg/wg0.conf", "[Interface]\nPrivateKey = X\n")
        e = self.err("disable Alpha", "backend_failed", 5)
        self.assertFalse(e["partial"])
        self.assertEqual(e["failed_checks"], ["server_config_block"])
        self.assertEqual(self.env.calls(), [])

    def test_unknown_client(self):
        self.err("enable Nobody", "not_found", 3)
        self.err("disable Nobody", "not_found", 3)
        self.assertEqual(self.env.calls(), [])

    def test_disable_reload_failure_reports_partial(self):
        self.env.seed("Alpha")
        self.env.switch("fail_reload")
        e = self.err("disable Alpha", "backend_failed", 5)
        self.assertTrue(e["partial"])
        self.assertEqual(e["failed_checks"], ["live_peer"])


class BackupTests(HelperTestCase):
    def test_backup_contents_and_modes(self):
        self.env.seed("Alpha")
        before_conf = self.env.read("wg/wg0.conf")
        before_clients = self.env.read("wg/configs/clients.txt")
        self.ok("disable Alpha")
        files = self.env.backups()
        self.assertEqual(len(files), 2)
        conf = next(f for f in files if f.endswith(".wg0.conf"))
        clients = next(f for f in files if f.endswith(".clients.txt"))
        self.assertEqual(self.env.read("backups/" + conf), before_conf)
        self.assertEqual(self.env.read("backups/" + clients), before_clients)
        for f in files:
            self.assertEqual(stat.S_IMODE(os.stat(self.env.p("backups/" + f)).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(self.env.p("backups")).st_mode), 0o700)

    def test_pruning_keeps_newest(self):
        self.env.seed("Alpha")
        for _ in range(3):
            self.ok("disable Alpha", BACKUP_KEEP="2")
            self.ok("enable Alpha", BACKUP_KEEP="2")
        files = self.env.backups()
        self.assertEqual(len(files), 4)                      # 2 sets x 2 files
        self.assertEqual(len({f.split(".")[0] for f in files}), 2)

    def test_unwritable_backup_dir_aborts_before_change(self):
        self.env.seed("Alpha")
        self.env.write("not-a-dir", "")
        self.err("disable Alpha", "host_misconfigured", 6,
                 BACKUP_DIR=self.env.p("not-a-dir/sub"))
        self.assertEqual(self.env.calls(), [])


class LockTests(HelperTestCase):
    def test_busy_when_lock_held(self):
        fd = os.open(self.env.p("lock"), os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX)
        self.err("add Bob", "busy", 7)
        self.assertEqual(self.env.calls(), [])
        self.assertEqual(self.env.backups(), [])

    def test_reads_do_not_take_the_lock(self):
        fd = os.open(self.env.p("lock"), os.O_CREAT | os.O_RDWR, 0o600)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX)
        self.ok("list")


# --- settings and preflight --------------------------------------------------

class SettingsTests(HelperTestCase):
    def cfg(self, text, mode=0o644):
        path = self.env.p("config")
        with open(path, "w") as handle:
            handle.write(text)
        os.chmod(path, mode)
        return path

    def test_missing_file_uses_defaults(self):
        s = h.load_settings(self.env.p("nope"), False)
        self.assertEqual((s.interface, s.backup_keep), ("wg0", 20))

    def test_valid_file(self):
        s = h.load_settings(self.cfg("# c\nWG_INTERFACE = wg1\nBACKUP_KEEP=5\n"), False)
        self.assertEqual((s.interface, s.backup_keep), ("wg1", 5))

    def test_rejections(self):
        for text in ("BOGUS=1\n", "WG_INTERFACE\n", "WG_INTERFACE=a b\n",
                     "WG_INTERFACE=../x\n", "WG_DIR=relative/path\n", "WG_DIR=/etc/../x\n",
                     "BACKUP_KEEP=0\n", "BACKUP_KEEP=999\n", "BACKUP_KEEP=x\n",
                     "PIVPN_BIN=pivpn\n"):
            with self.assertRaises(h.HelperError, msg=text) as ctx:
                h.load_settings(self.cfg(text), False)
            self.assertEqual(ctx.exception.code, "host_misconfigured")

    def test_group_or_world_writable_config_refused(self):
        for mode in (0o666, 0o664, 0o646):
            with self.assertRaises(h.HelperError):
                h.load_settings(self.cfg("WG_INTERFACE=wg0\n", mode), False)

    def test_symlinked_config_refused(self):
        real = self.cfg("WG_INTERFACE=wg0\n")
        link = self.env.p("link")
        os.symlink(real, link)
        with self.assertRaises(h.HelperError):
            h.load_settings(link, False)


class PreflightTests(HelperTestCase):
    def test_unsafe_clients_txt_mode(self):
        os.chmod(self.env.p("wg/configs/clients.txt"), 0o666)
        self.err("list", "host_misconfigured", 6)

    def test_unsafe_server_conf_mode(self):
        os.chmod(self.env.p("wg/wg0.conf"), 0o662)
        self.err("list", "host_misconfigured", 6)

    def test_missing_setupvars(self):
        os.unlink(self.env.p("setupVars.conf"))
        self.err("list", "host_misconfigured", 6)

    def test_writable_pivpn_script_refused(self):
        os.chmod(self.env.p("scripts/makeCONF.sh"), 0o666)
        self.err("add Bob", "host_misconfigured", 6)
        self.assertEqual(self.env.calls(), [])

    def test_writable_scripts_directory_refused(self):
        os.chmod(self.env.p("scripts"), 0o777)
        self.err("list", "host_misconfigured", 6)

    def test_only_shell_scripts_are_judged(self):
        self.env.write("scripts/notes.txt", "x")
        os.chmod(self.env.p("scripts/notes.txt"), 0o666)
        self.ok("list")

    def test_missing_scripts_directory_refused(self):
        shutil.rmtree(self.env.p("scripts"))
        self.err("list", "host_misconfigured", 6)

    def test_opened_file_is_checked_not_just_the_path(self):
        # read_text judges the file it actually opened, so a file swapped in after
        # preflight's lstat is still refused.
        path = self.env.p("wg/wg0.conf")
        os.chmod(path, 0o666)
        settings = self.env.settings()
        with self.assertRaises(ValueError):
            h.read_text(path, 1024, settings)
        self.assertIn("[Interface]", h.read_text(path, 1024))     # unchecked read still works

    def test_writable_pivpn_refused(self):
        os.chmod(self.env.p("bin/pivpn"), 0o775)
        self.err("add Bob", "host_misconfigured", 6)
        self.assertEqual(self.env.calls(), [])

    def test_writable_pivpn_directory_refused(self):
        os.chmod(self.env.p("bin"), 0o775)
        self.err("add Bob", "host_misconfigured", 6)
        self.assertEqual(self.env.calls(), [])

    def test_symlink_in_untrusted_directory_is_fine(self):
        # Real hosts: /usr/local/bin/pivpn -> /usr/local/src/pivpn/... with
        # /usr/local/bin owned by a normal user. The link's directory is never
        # trusted; the vetted *target* is what gets executed.
        linkdir = self.env.p("linkdir")
        os.makedirs(linkdir)
        os.chmod(linkdir, 0o777)
        os.symlink(self.env.p("bin/pivpn"), os.path.join(linkdir, "pivpn"))
        self.ok("add Bob", PIVPN_BIN=os.path.join(linkdir, "pivpn"))
        self.assertEqual(self.env.calls(), ["add -n Bob"])

    def test_symlink_to_unsafe_target_refused(self):
        evil = self.env.p("evil")
        os.makedirs(evil)
        os.chmod(evil, 0o777)
        with open(os.path.join(evil, "pivpn"), "w") as handle:
            handle.write("#!/bin/sh\ntrue\n")
        os.chmod(os.path.join(evil, "pivpn"), 0o755)
        linkdir = self.env.p("linkdir")
        os.makedirs(linkdir)
        os.symlink(os.path.join(evil, "pivpn"), os.path.join(linkdir, "pivpn"))
        self.err("add Bob", "host_misconfigured", 6, PIVPN_BIN=os.path.join(linkdir, "pivpn"))
        self.assertEqual(self.env.calls(), [])

    def test_version_works_without_preflight(self):
        os.unlink(self.env.p("wg/wg0.conf"))
        self.ok("version")


# --- entry point -------------------------------------------------------------

class MainTests(HelperTestCase):
    def run_main(self, argv, environ=None):
        out = io.StringIO()
        code = h.main(argv, environ if environ is not None else {}, out)
        return code, out.getvalue()

    def test_ssh_mode_rejects_hostile_and_does_not_echo(self):
        code, text = self.run_main(["--ssh"], {"SSH_ORIGINAL_COMMAND": "list; id #canary"})
        self.assertEqual(code, 2)
        self.assertNotIn("canary", text)
        self.assertEqual(text.count("\n"), 1)                 # one line of JSON
        self.assertEqual(json.loads(text)["error"]["code"], "invalid_request")

    def test_ssh_mode_missing_or_empty_variable(self):
        self.assertEqual(self.run_main(["--ssh"], {})[0], 2)
        self.assertEqual(self.run_main(["--ssh"], {"SSH_ORIGINAL_COMMAND": ""})[0], 2)

    def test_ssh_mode_takes_no_other_arguments(self):
        for argv in (["--ssh", "list"], ["--ssh", "--config", "/tmp/x"], ["--ssh", "--pretty"]):
            code, text = self.run_main(argv, {"SSH_ORIGINAL_COMMAND": "list"})
            self.assertNotEqual(code, 0, argv)

    def test_ssh_mode_does_not_honour_caller_config(self):
        # A request cannot smuggle settings: the only inputs are the grammar string.
        code, text = self.run_main(["--ssh"], {"SSH_ORIGINAL_COMMAND": "version",
                                               "WG_DIR": "/tmp/evil"})
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(text)["data"]["interface"], "wg0")

    def test_admin_mode(self):
        cfg = self.env.p("config")
        with open(cfg, "w") as handle:
            handle.write("WG_DIR=%s\nPIVPN_BIN=%s\nWG_BIN=%s\nPIVPN_SETUPVARS=%s\n"
                         "BACKUP_DIR=%s\nLOCK_FILE=%s\nPIVPN_SCRIPTS_DIR=%s\n" % (
                             self.env.p("wg"), self.env.p("bin/pivpn"), self.env.p("bin/wg"),
                             self.env.p("setupVars.conf"), self.env.p("backups"),
                             self.env.p("lock"), self.env.p("scripts")))
        code, text = self.run_main(["--config", cfg, "--no-owner-checks", "--pretty", "list"])
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(text)["ok"])

    def test_unknown_flag(self):
        stderr, sys.stderr = sys.stderr, io.StringIO()
        try:
            self.assertEqual(self.run_main(["--bogus", "list"])[0], 2)
        finally:
            sys.stderr = stderr

    def test_unexpected_exception_maps_to_internal(self):
        def boom(*_a, **_k):
            raise RuntimeError("secret detail must not leak")
        original = h.execute
        h.execute = boom
        self.addCleanup(setattr, h, "execute", original)
        code, response = self.env.call("list")
        self.assertEqual(code, 10)
        self.assertEqual(response["error"]["code"], "internal")
        self.assertNotIn("secret detail", json.dumps(response))


if __name__ == "__main__":
    unittest.main()
