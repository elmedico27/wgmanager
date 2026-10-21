"""Tests for `wgmanager-host install` and `uninstall`. Standard library only.

A stateful fake system stands in for useradd/userdel, visudo, sshd, systemctl and
sudo, so the tests can check what ends up on disk, in what order, and what is
undone when a step fails: the moments that matter on a real server.
"""
import base64
import io
import json
import os
import struct
import types
import unittest

import test_host
from test_host import (GOOD_SSHD, GOOD_SUDO_L, LIST_CMD, LIST_JSON, PROBE, VERSION_CMD,
                       VERSION_JSON, World, ok, slurp, wh)

BASE_SSHD = "port 22\nusepam yes\nlistenaddress 0.0.0.0:22\n"
DROPIN_TMP_MARK = ".wgmanager-install."


def make_pubkey(comment="app", seed=7, key_type="ssh-ed25519"):
    blob = (struct.pack(">I", len(key_type)) + key_type.encode()
            + struct.pack(">I", 32) + bytes([seed]) * 32)
    return "%s %s %s" % (key_type, base64.b64encode(blob).decode(), comment)


class InstallWorld(World):
    """A host with PiVPN and a clean sshd, and nothing of wgmanager installed."""

    def __init__(self, test):
        super().__init__(test)
        self.pw = None
        self.password_field = "!"         # what getent shadow reports once the user exists
        self.groups = "wgweb"
        for path in (wh.HELPER_PATH, wh.SUDOERS_PATH, wh.SSHD_DROPIN_PATH, wh.AUTHORIZED_KEYS_PATH):
            os.unlink(self.real(path))
        os.rmdir(self.real(wh.CONFIG_DIR))
        self.write("etc/ssh/sshd_config", "Include /etc/ssh/sshd_config.d/*.conf\n")
        self.flags = set()
        self.extra_sshd = ""
        self.missing_tools = set()
        self.at_reload = []
        self.keydir = os.path.join(self.root, "keys-from-user")
        os.makedirs(self.keydir)
        self.ctx.which = lambda name: None if name in self.missing_tools else "/usr/sbin/" + name

    def exists(self, path):
        return os.path.lexists(self.real(path))

    def read(self, path):
        return slurp(self.real(path), "rb")

    def keyfile(self, text, name="app.pub"):
        path = os.path.join(self.keydir, name)
        with open(path, "w") as handle:
            handle.write(text + "\n")
        return path

    def leftovers(self):
        found = []
        for base, dirs, names in os.walk(self.root):
            found += [n for n in names + dirs if n.startswith(DROPIN_TMP_MARK)]
        return found

    def count(self, argv):
        return sum(1 for call in self.calls if call == tuple(argv))

    def run(self, argv, timeout=15):
        argv = tuple(argv)
        self.calls.append(argv)
        flags = self.flags
        dropin = self.exists(wh.SSHD_DROPIN_PATH)
        if argv == ("sshd", "-t"):
            if "sshd_t_broken" in flags or ("sshd_t_broken_by_dropin" in flags and dropin):
                return (1, "", "/etc/ssh/sshd_config.d/wgmanager.conf line 3: Bad configuration option\n")
            return ok()
        if argv == ("sshd", "-T"):
            return ok(BASE_SSHD + self.extra_sshd)
        if argv == ("sshd", "-T", "-C", PROBE):
            if dropin and "dropin_ignored" not in flags:
                return ok(GOOD_SSHD + self.extra_sshd)
            return ok(BASE_SSHD + "forcecommand none\n" + self.extra_sshd)
        if argv[:2] == ("systemctl", "is-active"):
            if "no_ssh_unit" in flags or argv[2] != "ssh":
                return (3, "inactive\n", "")
            return ok("active\n")
        if argv[:2] == ("systemctl", "reload"):
            self.at_reload.append({p: self.exists(p) for p in
                                   (wh.HELPER_PATH, wh.SUDOERS_PATH, wh.AUTHORIZED_KEYS_PATH,
                                    wh.SSHD_DROPIN_PATH)})
            if "reload_fails" in flags:
                return (1, "", "Job for ssh.service failed.\n")
            return ok()
        if argv[0] == "useradd":
            if self.pw is not None or "useradd_fails" in flags:
                return (9, "", "useradd: cannot create user\n")
            self.pw = types.SimpleNamespace(pw_uid=997, pw_shell="/bin/sh", pw_dir="/nonexistent")
            if "--password" in argv:
                self.password_field = argv[argv.index("--password") + 1]
            return ok()
        if argv[0] == "usermod" and argv[1:3] == ("--password", "*"):
            if "usermod_fails" in flags:
                return (6, "", "usermod: cannot lock /etc/shadow\n")
            self.password_field = "*"
            return ok()
        if argv[0] == "userdel":
            if "userdel_fails" in flags:
                return (8, "", "userdel: user wgweb is currently used by process 4242\n")
            self.pw = None
            return ok()
        if argv[:2] == ("visudo", "-cf"):
            if argv[2] == wh.SUDOERS_PATH:
                return ok("parsed OK\n") if self.exists(wh.SUDOERS_PATH) else (1, "", "no such file")
            if "visudo_rejects" in flags:
                return (1, "", ">>> %s: syntax error near line 7 <<<\n" % argv[2])
            return ok("parsed OK\n")
        if argv == ("visudo", "-c"):
            return ok()
        if argv == ("id", "-nG", "wgweb"):
            return ok(self.groups + "\n") if self.pw else (1, "", "id: 'wgweb': no such user")
        if argv == ("getent", "shadow", "wgweb"):
            return ok("wgweb:%s:19000:::::\n" % self.password_field) if self.pw else (2, "", "")
        if argv == ("sudo", "-n", "-l", "-U", "wgweb"):
            if self.pw and self.exists(wh.SUDOERS_PATH):
                return ok(GOOD_SUDO_L)
            return ok("User wgweb is not allowed to run sudo on host.\n")
        if argv in (VERSION_CMD, LIST_CMD):
            if not (self.pw and self.exists(wh.SUDOERS_PATH) and self.exists(wh.HELPER_PATH)):
                return (1, "", "sudo: a password is required\n")
            return ok(json.dumps(VERSION_JSON if argv == VERSION_CMD else LIST_JSON))
        return (127, "", "unexpected command: %s" % " ".join(argv))


class InstallTestCase(unittest.TestCase):
    def setUp(self):
        old = os.umask(0o022)
        self.addCleanup(os.umask, old)
        self.w = InstallWorld(self)
        self.ctx = self.w.ctx
        self.key = make_pubkey()
        self.keyfile = self.w.keyfile(self.key)

    def go(self, *argv, interactive=False, answer="y"):
        out = io.StringIO()
        code = wh.main(list(argv), ctx=self.ctx, out=out, interactive=interactive,
                       input_fn=lambda prompt: answer)
        return code, out.getvalue()

    def install(self, *extra, **kw):
        return self.go("install", "--pubkey-file", self.keyfile, "--yes", *extra, **kw)

    def assertNothingInstalled(self, account_untouched=False):
        for path in (wh.HELPER_PATH, wh.SUDOERS_PATH, wh.SSHD_DROPIN_PATH,
                     wh.AUTHORIZED_KEYS_PATH, wh.CONFIG_DIR):
            self.assertFalse(self.w.exists(path), path)
        if not account_untouched:
            self.assertIsNone(self.w.pw)
        self.assertEqual(self.w.leftovers(), [])

    def mode(self, path):
        return os.stat(self.w.real(path)).st_mode & 0o7777


class FreshInstallTests(InstallTestCase):
    def test_installs_everything_and_doctor_is_clean(self):
        code, out = self.install()
        self.assertEqual(code, 0, out)
        self.assertNotIn("FAIL", out)
        self.assertNotIn("WARN", out)
        self.assertIn("Installed.", out)
        self.assertIn("Everything checked out.", out)

    def test_files_have_the_right_content_and_modes(self):
        self.install()
        self.assertEqual(self.w.read(wh.HELPER_PATH), slurp(os.path.join(wh.HERE, "wgmanager-helper"), "rb"))
        self.assertEqual(self.w.read(wh.SUDOERS_PATH),
                         slurp(os.path.join(wh.HERE, "etc/sudoers.d/wgmanager"), "rb"))
        self.assertEqual(self.w.read(wh.SSHD_DROPIN_PATH),
                         slurp(os.path.join(wh.HERE, "etc/ssh/sshd_config.d/wgmanager.conf"), "rb"))
        self.assertEqual(self.mode(wh.HELPER_PATH), 0o755)
        self.assertEqual(self.mode(wh.SUDOERS_PATH), 0o440)
        self.assertEqual(self.mode(wh.SSHD_DROPIN_PATH), 0o644)
        self.assertEqual(self.mode(wh.AUTHORIZED_KEYS_PATH), 0o644)
        self.assertEqual(self.mode(wh.CONFIG_DIR), 0o755)
        self.assertEqual(self.w.leftovers(), [])

    def test_authorized_key_line_is_locked_down(self):
        self.install()
        text = self.w.read(wh.AUTHORIZED_KEYS_PATH).decode()
        lines = [ln for ln in text.splitlines() if not ln.startswith("#")]
        self.assertEqual(len(lines), 1)
        self.assertEqual(
            lines[0], 'command="%s",restrict,from="127.0.0.1,::1,%s" %s'
            % (wh.FORCED_COMMAND, wh.DEFAULT_CONTAINER_SUBNET, self.key))

    def test_account_is_created_as_a_locked_down_system_user(self):
        self.install()
        useradd = [c for c in self.w.calls if c[0] == "useradd"]
        self.assertEqual(len(useradd), 1)
        for needed in ("--system", "--no-create-home", "--shell", "/bin/sh", "--home-dir", "/nonexistent"):
            self.assertIn(needed, useradd[0])
        self.assertEqual(useradd[0][-1], "wgweb")
        self.assertNotIn("--create-home", useradd[0])

    def test_sshd_is_changed_last(self):
        self.install()
        self.assertEqual(len(self.w.at_reload), 1)
        self.assertTrue(all(self.w.at_reload[0].values()), self.w.at_reload[0])

    def test_shows_the_key_fingerprint_in_the_plan(self):
        _, out = self.install()
        info = wh.parse_pubkey(self.key)
        self.assertIn(info["fingerprint"], out)

    def test_custom_sources_replace_the_defaults(self):
        self.install("--allow-from", "10.1.2.0/24, 192.168.5.7")
        text = self.w.read(wh.AUTHORIZED_KEYS_PATH).decode()
        self.assertIn('from="10.1.2.0/24,192.168.5.7"', text)
        self.assertNotIn("127.0.0.1", text)

    def test_pubkey_as_text(self):
        code, out = self.go("install", "--pubkey", self.key, "--yes")
        self.assertEqual(code, 0, out)
        self.assertIn(self.key.split()[1], self.w.read(wh.AUTHORIZED_KEYS_PATH).decode())

    def test_install_without_a_key_installs_the_rest_and_says_so(self):
        code, out = self.go("install", "--yes")
        self.assertEqual(code, 0, out)
        self.assertFalse(self.w.exists(wh.AUTHORIZED_KEYS_PATH))
        self.assertTrue(self.w.exists(wh.SSHD_DROPIN_PATH))
        self.assertIn("No --pubkey-file given", out)
        self.assertIn("no authorized_keys file yet", out)        # doctor's warning


class IdempotenceTests(InstallTestCase):
    def test_second_run_changes_nothing(self):
        self.install()
        before = len(self.w.calls)
        code, out = self.install()
        self.assertEqual(code, 0, out)
        self.assertIn("Nothing to do", out)
        later = self.w.calls[before:]
        self.assertFalse([c for c in later if c[0] in ("useradd", "userdel")])
        self.assertFalse([c for c in later if c[:2] == ("systemctl", "reload")])
        self.assertEqual(len(self.w.at_reload), 1)

    def test_upgrade_replaces_only_the_helper_and_does_not_touch_sshd(self):
        self.install()
        self.w.write(wh.HELPER_PATH, "#!/bin/sh\n# old helper\n", 0o755)
        code, out = self.install()
        self.assertEqual(code, 0, out)
        self.assertIn("replace   helper program", out)
        self.assertEqual(self.w.read(wh.HELPER_PATH), slurp(os.path.join(wh.HERE, "wgmanager-helper"), "rb"))
        self.assertEqual(len(self.w.at_reload), 1)

    def test_same_key_with_new_sources_updates_without_replace_flag(self):
        self.install()
        code, out = self.install("--allow-from", "10.9.9.0/29")
        self.assertEqual(code, 0, out)
        self.assertIn('from="10.9.9.0/29"', self.w.read(wh.AUTHORIZED_KEYS_PATH).decode())

    def test_different_key_needs_the_replace_flag(self):
        self.install()
        other = self.w.keyfile(make_pubkey(seed=9), "other.pub")
        before = self.w.read(wh.AUTHORIZED_KEYS_PATH)
        code, out = self.go("install", "--pubkey-file", other, "--yes")
        self.assertEqual(code, 1)
        self.assertIn("--replace-key", out)
        self.assertEqual(self.w.read(wh.AUTHORIZED_KEYS_PATH), before)
        code, out = self.go("install", "--pubkey-file", other, "--yes", "--replace-key")
        self.assertEqual(code, 0, out)
        self.assertIn(make_pubkey(seed=9).split()[1], self.w.read(wh.AUTHORIZED_KEYS_PATH).decode())
        self.assertNotIn(self.key.split()[1], self.w.read(wh.AUTHORIZED_KEYS_PATH).decode())


class ConfirmationTests(InstallTestCase):
    def test_dry_run_changes_nothing(self):
        code, out = self.go("install", "--pubkey-file", self.keyfile, "--dry-run")
        self.assertEqual(code, 0, out)
        self.assertIn("Dry run", out)
        self.assertIn("create", out)
        self.assertNothingInstalled()
        self.assertFalse([c for c in self.w.calls if c[0] in ("useradd",) or c[:2] == ("systemctl", "reload")])

    def test_refuses_to_apply_without_yes_when_not_interactive(self):
        code, out = self.go("install", "--pubkey-file", self.keyfile)
        self.assertEqual(code, 1)
        self.assertIn("--yes", out)
        self.assertNothingInstalled()

    def test_interactive_yes_applies(self):
        code, out = self.go("install", "--pubkey-file", self.keyfile, interactive=True, answer="y")
        self.assertEqual(code, 0, out)
        self.assertTrue(self.w.exists(wh.SSHD_DROPIN_PATH))

    def test_interactive_no_changes_nothing(self):
        code, out = self.go("install", "--pubkey-file", self.keyfile, interactive=True, answer="n")
        self.assertEqual(code, 1)
        self.assertIn("Nothing was changed", out)
        self.assertNothingInstalled()


class InputValidationTests(InstallTestCase):
    def rejected(self, text, needle):
        with self.assertRaises(wh.InstallError) as caught:
            wh.parse_pubkey(text)
        self.assertIn(needle, str(caught.exception))

    def test_private_key_is_refused_with_a_clear_message(self):
        self.rejected("-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----", "PRIVATE key")

    def test_options_in_front_of_the_key_are_refused(self):
        self.rejected('command="/bin/sh" ' + self.key, "options such as command=")
        self.rejected('from="1.2.3.4",' + self.key, "key type")

    def test_mismatched_type_and_data(self):
        self.rejected(self.key.replace("ssh-ed25519", "ssh-rsa", 1), "does not match")

    def test_bad_base64(self):
        self.rejected("ssh-ed25519 !!!notbase64!!! x", "not valid")

    def test_two_keys_are_refused(self):
        self.rejected(self.key + "\n" + make_pubkey(seed=3), "exactly one")

    def test_empty_input(self):
        self.rejected("   \n# just a comment\n", "exactly one")

    def test_comment_is_sanitised(self):
        info = wh.parse_pubkey(make_pubkey(comment="my key; rm -rf /"))
        self.assertRegex(info["comment"], r"^[A-Za-z0-9_.@-]+$")
        self.assertEqual(wh.parse_pubkey(make_pubkey(comment="")["comment"] if False else
                                         make_pubkey(comment="").strip())["comment"], "wgmanager")

    def test_bad_key_changes_nothing(self):
        bad = self.w.keyfile("ssh-ed25519 !!!", "bad.pub")
        code, out = self.go("install", "--pubkey-file", bad, "--yes")
        self.assertEqual(code, 1)
        self.assertIn("Cannot install", out)
        self.assertNothingInstalled()

    def test_missing_key_file(self):
        code, out = self.go("install", "--pubkey-file", os.path.join(self.w.keydir, "nope.pub"), "--yes")
        self.assertEqual(code, 1)
        self.assertIn("cannot read", out)

    def test_both_key_options_refused(self):
        code, out = self.go("install", "--pubkey-file", self.keyfile, "--pubkey", self.key, "--yes")
        self.assertEqual(code, 1)
        self.assertIn("not both", out)

    def test_sources(self):
        self.assertEqual(wh.parse_sources("127.0.0.1, ::1,10.0.0.0/8"), ["127.0.0.1", "::1", "10.0.0.0/8"])
        for bad, needle in (("example.com", "not an IP"), ("*", "not an IP"), ("0.0.0.0/0", "every address"),
                            ("::/0", "every address"), ("", "no source"), ("10.0.0.1/33", "not an IP"),
                            ("172.29.88.5/29", "did you mean 172.29.88.0/29"),
                            ("fd00::1/64", "did you mean fd00::/64")):
            with self.assertRaises(wh.InstallError) as caught:
                wh.parse_sources(bad)
            self.assertIn(needle, str(caught.exception), bad)


class PreflightRefusalTests(InstallTestCase):
    def refused(self, needle, account_untouched=False):
        code, out = self.install()
        self.assertEqual(code, 1, out)
        self.assertIn("Cannot install", out)
        self.assertIn(needle, out)
        self.assertNothingInstalled(account_untouched)
        self.assertFalse([c for c in self.w.calls if c[0] == "useradd"])

    def test_not_root(self):
        self.ctx.euid = 1000
        self.refused("must run as root")

    def test_missing_tool(self):
        self.w.missing_tools.add("useradd")
        self.refused("required tool not found: useradd")

    def test_pivpn_problems_block_the_install(self):
        self.w.chmod("pv/pivpn-real", 0o775)
        self.refused("run 'doctor'")

    def test_no_include_line(self):
        self.w.write("etc/ssh/sshd_config", "Port 22\n")
        self.refused("Include /etc/ssh/sshd_config.d/*.conf")

    def test_include_of_something_else_does_not_count(self):
        self.w.write("etc/ssh/sshd_config", "Include /etc/ssh/other/*.conf\n")
        self.refused("Include")

    def test_sshd_config_already_broken(self):
        self.w.flags.add("sshd_t_broken")
        self.refused("already invalid")

    def test_allowusers_excluding_the_account(self):
        self.w.extra_sshd = "allowusers alice bob\n"
        self.refused("AllowUsers")

    def test_allowusers_including_the_account_is_fine(self):
        self.w.extra_sshd = "allowusers alice wgweb\n"
        code, out = self.install()
        self.assertEqual(code, 0, out)

    def test_denyusers_blocking_the_account(self):
        self.w.extra_sshd = "denyusers wgweb\n"
        self.refused("DenyUsers")

    def test_no_ssh_service(self):
        self.w.flags.add("no_ssh_unit")
        self.refused("ssh service")

    def test_writable_helper_directory(self):
        self.w.chmod("usr/local/sbin", 0o777)
        self.refused("writable by group or others")

    def test_existing_ordinary_user_named_wgweb(self):
        self.w.pw = types.SimpleNamespace(pw_uid=1001, pw_shell="/bin/bash", pw_dir="/home/wgweb")
        self.refused("already exists", account_untouched=True)
        self.assertEqual(self.w.pw.pw_uid, 1001)
        self.assertFalse([c for c in self.w.calls if c[0] == "userdel"])

    def test_existing_system_account_is_reused(self):
        self.w.pw = types.SimpleNamespace(pw_uid=997, pw_shell="/bin/sh", pw_dir="/nonexistent")
        code, out = self.install()
        self.assertEqual(code, 0, out)
        self.assertFalse([c for c in self.w.calls if c[0] == "useradd"])


class ProactiveFixTests(InstallTestCase):
    """Things that are wgmanager's own: install fixes them instead of leaving
    them for doctor. Anything that belongs to someone else is only reported."""

    def existing_account(self, password_field="!", groups="wgweb"):
        self.w.pw = types.SimpleNamespace(pw_uid=997, pw_shell="/bin/sh", pw_dir="/nonexistent")
        self.w.password_field = password_field
        self.w.groups = groups

    def test_new_account_gets_no_password_rather_than_a_locked_one(self):
        self.install()
        useradd = [c for c in self.w.calls if c[0] == "useradd"][0]
        self.assertEqual(useradd[useradd.index("--password") + 1], "*")
        self.assertEqual(self.w.password_field, "*")
        self.assertFalse([c for c in self.w.calls if c[0] == "usermod"])

    def test_existing_locked_account_is_set_to_no_password(self):
        for field in ("!", "", "$y$j9T$somehash"):
            with self.subTest(field=field):
                self.existing_account(field)
                code, out = self.install()
                self.assertEqual(code, 0, out)
                self.assertIn("password field of wgweb set to '*'", out)
                self.assertEqual(self.w.password_field, "*")

    def test_account_already_without_password_is_left_alone(self):
        self.existing_account("*")
        code, out = self.install()
        self.assertEqual(code, 0, out)
        self.assertFalse([c for c in self.w.calls if c[0] == "usermod"])

    def test_usermod_failure_rolls_back(self):
        self.existing_account("!")
        self.w.flags.add("usermod_fails")
        code, out = self.install()
        self.assertEqual(code, 1, out)
        self.assertIn("usermod failed", out)
        self.assertNothingInstalled(account_untouched=True)

    def test_account_in_a_privileged_group_is_refused_not_changed(self):
        self.existing_account(groups="wgweb sudo docker")
        code, out = self.install()
        self.assertEqual(code, 1, out)
        self.assertIn("privileged group(s) docker, sudo", out)
        self.assertIn("sudo gpasswd -d wgweb sudo", out)
        self.assertNothingInstalled(account_untouched=True)
        self.assertFalse([c for c in self.w.calls if c[0] in ("usermod", "gpasswd")])

    def test_loose_config_directory_is_tightened(self):
        os.makedirs(self.w.real(wh.CONFIG_DIR))
        self.w.chmod(wh.CONFIG_DIR.lstrip("/"), 0o777)
        code, out = self.install()
        self.assertEqual(code, 0, out)
        self.assertIn("tightening its owner/mode", out)
        self.assertEqual(self.mode(wh.CONFIG_DIR), 0o755)

    def test_tightened_config_directory_is_restored_on_rollback(self):
        os.makedirs(self.w.real(wh.CONFIG_DIR))
        self.w.chmod(wh.CONFIG_DIR.lstrip("/"), 0o775)
        self.w.flags.add("reload_fails")
        code, out = self.install()
        self.assertEqual(code, 1, out)
        self.assertEqual(self.mode(wh.CONFIG_DIR), 0o775)

    def test_config_path_that_is_not_a_directory_is_refused(self):
        self.w.write(wh.CONFIG_DIR, "not a directory\n")
        code, out = self.install()
        self.assertEqual(code, 1, out)
        self.assertIn("is not a directory", out)

    def test_dropin_disables_all_forwarding(self):
        self.install()
        self.assertIn(b"DisableForwarding yes", self.w.read(wh.SSHD_DROPIN_PATH))

    def test_sources_overlapping_the_vpn_subnet_get_a_note(self):
        code, out = self.install("--allow-from", "127.0.0.1,10.0.0.0/16")
        self.assertEqual(code, 0, out)
        self.assertIn("overlaps the VPN client subnet 10.0.0.0/24", out)

    def test_default_sources_do_not_overlap_the_vpn_subnet(self):
        code, out = self.install()
        self.assertNotIn("overlaps", out)


class RollbackTests(InstallTestCase):
    def failed_and_rolled_back(self, needle):
        code, out = self.install()
        self.assertEqual(code, 1, out)
        self.assertIn("Rolling back", out)
        self.assertIn("rolled back", out)
        self.assertIn(needle, out)
        self.assertNothingInstalled()
        return out

    def test_sudoers_rejected(self):
        self.w.flags.add("visudo_rejects")
        out = self.failed_and_rolled_back("visudo rejected")
        self.assertIn(("userdel", "wgweb"), [tuple(c) for c in self.w.calls])
        self.assertEqual(self.w.at_reload, [])

    def test_sshd_rejects_the_dropin(self):
        self.w.flags.add("sshd_t_broken_by_dropin")
        self.failed_and_rolled_back("sshd rejected")
        self.assertEqual(self.w.at_reload, [])

    def test_dropin_not_picked_up(self):
        self.w.flags.add("dropin_ignored")
        self.failed_and_rolled_back("did not pick up")
        self.assertEqual(self.w.at_reload, [])

    def test_reload_fails(self):
        self.w.flags.add("reload_fails")
        self.failed_and_rolled_back("could not reload sshd")
        self.assertEqual(len(self.w.at_reload), 1)            # tried once; nothing to reload back

    def test_useradd_fails(self):
        self.w.flags.add("useradd_fails")
        self.failed_and_rolled_back("useradd failed")

    def test_rollback_restores_previous_files(self):
        self.install()
        old_helper = b"#!/bin/sh\n# previous helper\n"
        old_sudoers = b"# previous sudoers\n"
        self.w.write(wh.HELPER_PATH, old_helper.decode(), 0o755)
        self.w.write(wh.SUDOERS_PATH, old_sudoers.decode(), 0o440)
        self.w.flags.add("visudo_rejects")
        code, out = self.install()
        self.assertEqual(code, 1, out)
        self.assertEqual(self.w.read(wh.HELPER_PATH), old_helper)
        self.assertEqual(self.w.read(wh.SUDOERS_PATH), old_sudoers)
        self.assertEqual(self.mode(wh.SUDOERS_PATH), 0o440)
        self.assertEqual(self.w.leftovers(), [])

    def test_a_failed_reload_after_an_upgrade_restores_the_old_dropin_and_reloads_again(self):
        self.install()
        self.w.write(wh.SSHD_DROPIN_PATH, "# older drop-in\n")
        self.w.flags.add("reload_fails")
        code, _ = self.install()
        self.assertEqual(code, 1)
        self.assertEqual(self.w.read(wh.SSHD_DROPIN_PATH), b"# older drop-in\n")

    def test_symlinked_target_is_refused(self):
        os.symlink("/etc/passwd", self.w.real(wh.SSHD_DROPIN_PATH))
        code, out = self.install()
        self.assertEqual(code, 1)
        self.assertIn("not a regular file", out)
        self.assertEqual(os.readlink(self.w.real(wh.SSHD_DROPIN_PATH)), "/etc/passwd")

    def test_missing_dropin_directory_is_created(self):
        os.unlink(self.w.real(wh.SSHD_DROPIN_PATH)) if self.w.exists(wh.SSHD_DROPIN_PATH) else None
        os.rmdir(self.w.real("/etc/ssh/sshd_config.d"))
        code, out = self.install()
        self.assertEqual(code, 0, out)


class UninstallTests(InstallTestCase):
    def test_round_trip_removes_everything(self):
        self.install()
        code, out = self.go("uninstall", "--yes")
        self.assertEqual(code, 0, out)
        self.assertIn("Uninstalled.", out)
        self.assertNothingInstalled()
        self.assertEqual(len(self.w.at_reload), 2)             # install + uninstall

    def test_reinstall_after_uninstall_works(self):
        self.install()
        self.go("uninstall", "--yes")
        code, out = self.install()
        self.assertEqual(code, 0, out)
        self.assertNotIn("FAIL", out)

    def test_uninstall_when_not_installed_is_a_clean_no_op(self):
        code, out = self.go("uninstall", "--yes")
        self.assertEqual(code, 0, out)
        self.assertIn("not installed", out)
        self.assertFalse([c for c in self.w.calls if c[0] == "userdel"])

    def test_sshd_is_reloaded_before_anything_else_is_removed(self):
        self.install()
        self.go("uninstall", "--yes")
        snapshot = self.w.at_reload[-1]
        self.assertFalse(snapshot[wh.SSHD_DROPIN_PATH])
        self.assertTrue(snapshot[wh.HELPER_PATH] and snapshot[wh.SUDOERS_PATH]
                        and snapshot[wh.AUTHORIZED_KEYS_PATH])

    def test_backups_are_kept_unless_purged(self):
        self.install()
        backups = os.path.join(self.w.pv, "backups")
        os.mkdir(backups, 0o700)
        name = "20260101T120000000Z-add-Bob_Phone.clients.txt"
        with open(os.path.join(backups, name), "w") as handle:
            handle.write("x")
        with open(os.path.join(backups, "keep-me.txt"), "w") as handle:
            handle.write("not ours")
        code, out = self.go("uninstall", "--yes")
        self.assertEqual(code, 0, out)
        self.assertIn("Backups in", out)
        self.assertTrue(os.path.exists(os.path.join(backups, name)))

    def test_purge_removes_only_files_that_look_like_backups(self):
        self.install()
        backups = os.path.join(self.w.pv, "backups")
        os.mkdir(backups, 0o700)
        ours = "20260101T120000000Z-add-Bob_Phone.clients.txt"
        for name in (ours, "keep-me.txt"):
            with open(os.path.join(backups, name), "w") as handle:
                handle.write("x")
        self.w.write(wh.CONFIG_DIR + "/config", "BACKUP_KEEP=5\n")
        code, out = self.go("uninstall", "--yes", "--purge")
        self.assertEqual(code, 0, out)
        self.assertFalse(os.path.exists(os.path.join(backups, ours)))
        self.assertTrue(os.path.exists(os.path.join(backups, "keep-me.txt")))     # not ours: kept
        self.assertFalse(self.w.exists(wh.CONFIG_DIR))

    def test_config_directory_with_a_settings_file_survives_without_purge(self):
        self.install()
        self.w.write(wh.CONFIG_DIR + "/config", "BACKUP_KEEP=5\n")
        self.go("uninstall", "--yes")
        self.assertTrue(self.w.exists(wh.CONFIG_DIR + "/config"))

    def test_ordinary_account_is_left_alone(self):
        self.install()
        self.w.pw = types.SimpleNamespace(pw_uid=1001, pw_shell="/bin/bash", pw_dir="/home/wgweb")
        code, out = self.go("uninstall", "--yes")
        self.assertEqual(code, 0, out)
        self.assertIn("left alone", out)
        self.assertFalse([c for c in self.w.calls if c[0] == "userdel"])

    def test_sshd_that_needs_the_dropin_is_put_back_and_nothing_else_removed(self):
        self.install()
        self.w.flags.add("sshd_t_broken")
        code, out = self.go("uninstall", "--yes")
        self.assertEqual(code, 1)
        self.assertIn("put back", out)
        for path in (wh.SSHD_DROPIN_PATH, wh.HELPER_PATH, wh.SUDOERS_PATH, wh.AUTHORIZED_KEYS_PATH):
            self.assertTrue(self.w.exists(path), path)
        self.assertIsNotNone(self.w.pw)

    def test_dropin_that_cannot_be_removed_stops_everything_else(self):
        self.install()
        os.unlink(self.w.real(wh.SSHD_DROPIN_PATH))
        os.makedirs(self.w.real(wh.SSHD_DROPIN_PATH))       # unlink() now fails with an OSError
        code, out = self.go("uninstall", "--yes")
        self.assertEqual(code, 1, out)
        self.assertIn("Stopping here", out)
        for path in (wh.HELPER_PATH, wh.SUDOERS_PATH, wh.AUTHORIZED_KEYS_PATH):
            self.assertTrue(self.w.exists(path), path)
        self.assertIsNotNone(self.w.pw)

    def test_account_still_in_use_is_reported_and_the_rest_is_removed(self):
        self.install()
        self.w.flags.add("userdel_fails")
        code, out = self.go("uninstall", "--yes")
        self.assertEqual(code, 1)
        self.assertIn("pkill -u wgweb", out)
        self.assertFalse(self.w.exists(wh.HELPER_PATH))
        self.assertFalse(self.w.exists(wh.SUDOERS_PATH))
        self.w.flags.discard("userdel_fails")
        code, out = self.go("uninstall", "--yes")
        self.assertEqual(code, 0, out)
        self.assertIsNone(self.w.pw)

    def test_dry_run_and_confirmation(self):
        self.install()
        code, out = self.go("uninstall", "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("Dry run", out)
        self.assertTrue(self.w.exists(wh.HELPER_PATH))
        code, out = self.go("uninstall")
        self.assertEqual(code, 1)
        self.assertTrue(self.w.exists(wh.HELPER_PATH))
        code, out = self.go("uninstall", interactive=True, answer="n")
        self.assertEqual(code, 1)
        self.assertTrue(self.w.exists(wh.HELPER_PATH))
        code, out = self.go("uninstall", interactive=True, answer="y")
        self.assertEqual(code, 0, out)
        self.assertFalse(self.w.exists(wh.HELPER_PATH))

    def test_not_root(self):
        self.ctx.euid = 1000
        code, out = self.go("uninstall", "--yes")
        self.assertEqual(code, 1)
        self.assertIn("must run as root", out)


if __name__ == "__main__":
    unittest.main()
