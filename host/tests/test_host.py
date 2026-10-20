"""Tests for host/wgmanager-host (`doctor`). Standard library `unittest` only.

Run from the repository root:
    python3 -m unittest discover -s host/tests -v

Nothing here needs root, sshd, sudo or PiVPN: the tool is pointed at a throwaway
directory tree, and every external command (sshd, sudo, visudo, id, getent) is
answered from a table, so each failure a real server can show is reproducible.
"""
import importlib.machinery
import importlib.util
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HOST_DIR = os.path.dirname(HERE)

_loader = importlib.machinery.SourceFileLoader("wgmanager_host", os.path.join(HOST_DIR, "wgmanager-host"))
_spec = importlib.util.spec_from_loader("wgmanager_host", _loader)
wh = importlib.util.module_from_spec(_spec)
_loader.exec_module(wh)

PROBE = wh.SSHD_PROBE
GOOD_SSHD = "\n".join([
    "port 22", "listenaddress 0.0.0.0:22", "usepam yes",
    "forcecommand " + wh.FORCED_COMMAND,
    "authorizedkeysfile " + wh.AUTHORIZED_KEYS_PATH,
    "pubkeyauthentication yes", "passwordauthentication no",
    "kbdinteractiveauthentication no", "authenticationmethods publickey",
    "permittty no", "x11forwarding no", "allowagentforwarding no",
    "allowtcpforwarding no", "permittunnel false",
]) + "\n"
GOOD_SUDO_L = ("Matching Defaults entries for wgweb on host:\n    env_keep+=SSH_ORIGINAL_COMMAND\n\n"
               "User wgweb may run the following commands on host:\n"
               "    (root) NOPASSWD: /usr/local/sbin/wgmanager-helper --ssh\n")
GOOD_KEY = ('command="%s",restrict,from="127.0.0.1,::1,172.30.0.0/29" '
            'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKEKEY wgmanager\n'
            % wh.FORCED_COMMAND)
VERSION_JSON = {"ok": True, "protocol": 1, "data": {
    "helper_version": "0.1.1", "protocol": 1, "backend": "pivpn", "interface": "wg0",
    "pivpn_scripts": {}}}
LIST_JSON = {"ok": True, "protocol": 1, "data": {
    "interface": {"name": "wg0", "up": True},
    "clients": [{"name": "A", "enabled": True, "live": True, "manageable": True},
                {"name": "B", "enabled": False, "live": False, "manageable": True}],
    "warnings": []}}
VERSION_CMD = ("sudo", "-n", "-u", "wgweb", "env", "SSH_ORIGINAL_COMMAND=version",
               "sudo", "-n", wh.HELPER_PATH, "--ssh")
LIST_CMD = VERSION_CMD[:5] + ("SSH_ORIGINAL_COMMAND=list",) + VERSION_CMD[6:]
VERSION_CMD = VERSION_CMD[:5] + ("SSH_ORIGINAL_COMMAND=version",) + VERSION_CMD[6:]


def slurp(path, mode="r"):
    with open(path, mode) as handle:
        return handle.read()


def ok(out="", err=""):
    return (0, out, err)


class World:
    """A healthy fake host and a command table that tests can break piece by piece."""

    def __init__(self, test):
        self.root = tempfile.mkdtemp(prefix="wgm-host-test-")
        test.addCleanup(shutil.rmtree, self.root, True)
        self.pw = types.SimpleNamespace(pw_uid=997, pw_shell="/bin/sh", pw_dir="/nonexistent")
        self.cmds = {
            ("sshd", "-t"): ok(),
            ("sshd", "-T", "-C", PROBE): ok(GOOD_SSHD),
            ("id", "-nG", "wgweb"): ok("wgweb\n"),
            ("getent", "shadow", "wgweb"): ok("wgweb:!:19000:::::\n"),
            ("visudo", "-cf", wh.SUDOERS_PATH): ok("parsed OK\n"),
            ("visudo", "-c"): ok("all parsed OK\n"),
            ("sudo", "-n", "-l", "-U", "wgweb"): ok(GOOD_SUDO_L),
            VERSION_CMD: ok(json.dumps(VERSION_JSON)),
            LIST_CMD: ok(json.dumps(LIST_JSON)),
        }
        self.calls = []

        self.mkdir("etc")
        self.write("etc/os-release", 'PRETTY_NAME="Debian GNU/Linux 13"\nID=debian\n')
        self.mkdir("usr/local/sbin")
        self.write(wh.HELPER_PATH, slurp(os.path.join(HOST_DIR, "wgmanager-helper")), 0o755)
        self.write(wh.SUDOERS_PATH, slurp(os.path.join(HOST_DIR, "etc/sudoers.d/wgmanager")), 0o440)
        self.write(wh.SSHD_DROPIN_PATH,
                   slurp(os.path.join(HOST_DIR, "etc/ssh/sshd_config.d/wgmanager.conf")))
        self.mkdir(wh.CONFIG_DIR)
        self.write(wh.AUTHORIZED_KEYS_PATH, GOOD_KEY)

        # PiVPN side: a symlink in a "bin" directory pointing at a real executable.
        for sub in ("pivpn-real", "bin", "wg", "wg/configs", "scripts"):
            os.makedirs(os.path.join(self.root, "pv", sub))
        self.pv = os.path.join(self.root, "pv")
        for name in ("pivpn-real/pivpn", "pivpn-real/wg"):
            self.raw_write(os.path.join(self.pv, name), "#!/bin/sh\n", 0o755)
        os.symlink(os.path.join(self.pv, "pivpn-real/pivpn"), os.path.join(self.pv, "bin/pivpn"))
        os.symlink(os.path.join(self.pv, "pivpn-real/wg"), os.path.join(self.pv, "bin/wg"))
        self.raw_write(os.path.join(self.pv, "wg/wg0.conf"), "[Interface]\n")
        self.raw_write(os.path.join(self.pv, "wg/configs/clients.txt"), "")
        self.raw_write(os.path.join(self.pv, "setupVars.conf"), "")
        self.ctx = wh.Host(root=self.root, expected_uid=os.getuid(), runner=self.run,
                           getpwnam=self.getpwnam, euid=0, settings_loader=self.load_settings)

    # -- building the tree
    def real(self, path):
        return os.path.join(self.root, path.lstrip("/"))

    def mkdir(self, path):
        os.makedirs(self.real(path), exist_ok=True)

    def raw_write(self, full, text, mode=0o644):
        with open(full, "w") as handle:
            handle.write(text)
        os.chmod(full, mode)

    def write(self, path, text, mode=0o644):
        full = self.real(path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        self.raw_write(full, text, mode)

    def chmod(self, path, mode):
        os.chmod(self.real(path), mode)

    # -- doubles
    def run(self, argv, timeout=15):
        self.calls.append(tuple(argv))
        return self.cmds.get(tuple(argv), (127, "", "unexpected command: %s" % " ".join(argv)))

    def getpwnam(self, name):
        if self.pw is None:
            raise KeyError(name)
        return self.pw

    def load_settings(self, helper):
        values = dict(helper.SETTING_DEFAULTS)
        values.update(
            WG_DIR=os.path.join(self.pv, "wg"), PIVPN_BIN=os.path.join(self.pv, "bin/pivpn"),
            PIVPN_SCRIPTS_DIR=os.path.join(self.pv, "scripts"),
            PIVPN_SETUPVARS=os.path.join(self.pv, "setupVars.conf"),
            WG_BIN=os.path.join(self.pv, "bin/wg"),
            BACKUP_DIR=os.path.join(self.pv, "backups"), LOCK_FILE=os.path.join(self.pv, "lock"))
        return helper.Settings(values, False)


class DoctorTestCase(unittest.TestCase):
    def setUp(self):
        old = os.umask(0o022)
        self.addCleanup(os.umask, old)
        self.world = World(self)
        self.ctx = self.world.ctx

    def doctor(self):
        return wh.doctor(self.ctx)

    def texts(self, rep, level):
        return [text for _, lvl, text, _ in rep.items if lvl == level]

    def fixes(self, rep, level):
        return [fix for _, lvl, _, fixes in rep.items if lvl == level for fix in fixes]

    def assertFailMentions(self, rep, *needles):
        joined = "\n".join(self.texts(rep, "fail") + self.fixes(rep, "fail"))
        for needle in needles:
            self.assertIn(needle, joined, "no failure mentions %r; failures were:\n%s" % (needle, joined))

    def assertClean(self, rep):
        self.assertEqual(self.texts(rep, "fail"), [])
        self.assertEqual(self.texts(rep, "warn"), [])


class HealthyHostTests(DoctorTestCase):
    def test_healthy_host_has_no_failures_or_warnings(self):
        rep = self.doctor()
        self.assertClean(rep)
        self.assertGreaterEqual(rep.count("ok"), 10)

    def test_exit_code_and_output(self):
        out = io.StringIO()
        self.assertEqual(wh.main(["doctor"], ctx=self.ctx, out=out), 0)
        self.assertIn("Everything checked out.", out.getvalue())

    def test_failures_exit_nonzero_and_print_fixes(self):
        self.world.chmod("pv/pivpn-real", 0o775)
        out = io.StringIO()
        self.assertEqual(wh.main(["doctor"], ctx=self.ctx, out=out), 1)
        self.assertIn("fix: sudo chmod go-w", out.getvalue())
        self.assertIn("need fixing", out.getvalue())

    def test_doctor_changes_nothing(self):
        def snapshot():
            seen = {}
            for base, _, names in os.walk(self.world.root):
                for name in names:
                    full = os.path.join(base, name)
                    if os.path.islink(full):
                        seen[full] = os.readlink(full)
                    else:
                        st = os.stat(full)
                        seen[full] = (st.st_mtime_ns, st.st_mode, slurp(full, "rb"))
            return seen
        before = snapshot()
        self.doctor()
        self.assertEqual(before, snapshot())
        self.assertTrue(sys.dont_write_bytecode)

    def test_never_runs_a_changing_command(self):
        self.doctor()
        allowed = {"sshd", "id", "getent", "visudo", "sudo"}
        for call in self.world.calls:
            self.assertIn(call[0], allowed)
            if call[0] == "sudo":
                # Only "list what wgweb may do" or the same hop the web app uses.
                self.assertTrue(call[:4] == ("sudo", "-n", "-l", "-U") or call[:4] == ("sudo", "-n", "-u", "wgweb"),
                                call)
            if call[0] == "visudo":
                self.assertIn(call[1], ("-c", "-cf"))

    def test_not_root_stops_before_checking_anything(self):
        self.ctx.euid = 1000
        rep = self.doctor()
        self.assertEqual(len(rep.items), 1)
        self.assertFailMentions(rep, "must run as root", "sudo python3")
        self.assertEqual(self.world.calls, [])


class PivpnTests(DoctorTestCase):
    def test_group_writable_pivpn_directory_names_path_and_fix(self):
        self.world.chmod("pv/pivpn-real", 0o775)
        rep = self.doctor()
        self.assertFailMentions(rep, "pivpn is writable by group or others",
                                os.path.join(self.world.pv, "pivpn-real"), "chmod go-w")

    def test_symlink_in_an_untrusted_directory_is_fine(self):
        # The case from the first real server: /usr/local/bin owned by a normal
        # user. Only the resolved target and its directory matter.
        self.world.chmod("pv/bin", 0o777)
        self.assertEqual(self.texts(self.doctor(), "fail"), [])

    def test_missing_clients_file(self):
        os.unlink(os.path.join(self.world.pv, "wg/configs/clients.txt"))
        rep = self.doctor()
        self.assertFailMentions(rep, "clients.txt is missing", "PiVPN")

    def test_writable_data_file(self):
        os.chmod(os.path.join(self.world.pv, "wg/wg0.conf"), 0o666)
        rep = self.doctor()
        self.assertFailMentions(rep, "server config is writable", "wg0.conf")

    def test_data_file_that_is_a_symlink(self):
        path = os.path.join(self.world.pv, "setupVars.conf")
        os.rename(path, path + ".real")
        os.symlink(path + ".real", path)
        self.assertFailMentions(self.doctor(), "PiVPN setupVars is not a regular file")

    def test_wrong_owner_is_reported_with_chown_fix(self):
        self.ctx.expected_uid = os.getuid() + 12345      # nothing here is "root" now
        helper_loader = self.ctx.settings_loader

        def enforcing(helper):
            settings = helper_loader(helper)
            settings.enforce_owner = True
            return settings
        self.ctx.settings_loader = enforcing
        rep = self.doctor()
        self.assertFailMentions(rep, "is not owned by root", "sudo chown root:root")

    def test_invalid_settings_file(self):
        def broken(helper):
            raise helper.HelperError("host_misconfigured")
        self.ctx.settings_loader = broken
        self.assertFailMentions(self.doctor(), "not a valid settings file", "config.example")

    def test_backup_directory_must_be_private(self):
        os.mkdir(os.path.join(self.world.pv, "backups"), 0o755)
        os.chmod(os.path.join(self.world.pv, "backups"), 0o755)
        rep = self.doctor()
        self.assertIn("backup directory", "\n".join(self.texts(rep, "warn")))
        os.chmod(os.path.join(self.world.pv, "backups"), 0o700)
        self.assertClean(self.doctor())


class HelperFileTests(DoctorTestCase):
    def test_missing_helper(self):
        os.unlink(self.world.real(wh.HELPER_PATH))
        self.assertFailMentions(self.doctor(), "helper is missing", "install")

    def test_old_helper_is_a_warning_not_a_failure(self):
        self.world.write(wh.HELPER_PATH, "#!/bin/sh\n# old\n", 0o755)
        rep = self.doctor()
        self.assertEqual(self.texts(rep, "fail"), [])
        self.assertIn("differs from this checkout", "\n".join(self.texts(rep, "warn")))

    def test_writable_helper_directory(self):
        self.world.chmod("usr/local/sbin", 0o777)
        self.assertFailMentions(self.doctor(), "helper directory is writable", "chmod go-w")

    def test_non_executable_helper(self):
        self.world.chmod(wh.HELPER_PATH, 0o644)
        self.assertFailMentions(self.doctor(), "not executable")


class AccountTests(DoctorTestCase):
    def test_missing_account(self):
        self.world.pw = None
        self.assertFailMentions(self.doctor(), "user wgweb does not exist")

    def test_regular_user_uid_warns(self):
        self.world.pw.pw_uid = 1001
        self.assertIn("regular user", "\n".join(self.texts(self.doctor(), "warn")))

    def test_nologin_shell_fails(self):
        self.world.pw.pw_shell = "/usr/sbin/nologin"
        self.assertFailMentions(self.doctor(), "cannot run the forced command", "usermod --shell")

    def test_privileged_group_fails(self):
        self.world.cmds[("id", "-nG", "wgweb")] = ok("wgweb sudo docker\n")
        rep = self.doctor()
        self.assertFailMentions(rep, "privileged group", "sudo", "docker", "gpasswd -d wgweb docker")

    def test_locked_account_is_fine_with_pam(self):
        self.assertClean(self.doctor())

    def test_locked_account_fails_without_pam(self):
        self.world.cmds[("sshd", "-T", "-C", PROBE)] = ok(GOOD_SSHD.replace("usepam yes", "usepam no"))
        self.assertFailMentions(self.doctor(), "locked and sshd has UsePAM off", "usermod -p '*'")

    def test_star_password_is_fine_without_pam(self):
        self.world.cmds[("sshd", "-T", "-C", PROBE)] = ok(GOOD_SSHD.replace("usepam yes", "usepam no"))
        self.world.cmds[("getent", "shadow", "wgweb")] = ok("wgweb:*:19000:::::\n")
        self.assertClean(self.doctor())

    def test_empty_password_fails(self):
        self.world.cmds[("getent", "shadow", "wgweb")] = ok("wgweb::19000:::::\n")
        self.assertFailMentions(self.doctor(), "EMPTY password")

    def test_password_hash_warns(self):
        self.world.cmds[("getent", "shadow", "wgweb")] = ok("wgweb:$y$j9T$abc:19000:::::\n")
        rep = self.doctor()
        self.assertEqual(self.texts(rep, "fail"), [])
        self.assertIn("has a password set", "\n".join(self.texts(rep, "warn")))


class SudoTests(DoctorTestCase):
    def test_group_writable_sudoers_file(self):
        self.world.chmod(wh.SUDOERS_PATH, 0o660)
        self.assertFailMentions(self.doctor(), "sudoers file is writable")

    def test_world_readable_sudoers_mode_is_flagged(self):
        self.world.chmod(wh.SUDOERS_PATH, 0o644)
        self.assertFailMentions(self.doctor(), "should be 0440", "chmod 0440")

    def test_sudoers_that_does_not_parse(self):
        self.world.cmds[("visudo", "-cf", wh.SUDOERS_PATH)] = (1, "", "syntax error near line 7")
        self.assertFailMentions(self.doctor(), "does not parse", "syntax error")

    def test_extra_sudo_rights_fail(self):
        extra = GOOD_SUDO_L + "    (ALL) NOPASSWD: /bin/bash\n"
        self.world.cmds[("sudo", "-n", "-l", "-U", "wgweb")] = ok(extra)
        self.assertFailMentions(self.doctor(), "can run more than the helper", "/bin/bash")

    def test_missing_rule_fails(self):
        self.world.cmds[("sudo", "-n", "-l", "-U", "wgweb")] = ok(
            "User wgweb is not allowed to run sudo on host.\n")
        self.assertFailMentions(self.doctor(), "not allowed to run any sudo command")

    def test_someone_elses_broken_sudoers_file_is_a_warning_with_the_fix(self):
        # The real-world case: /etc/sudoers.d/alice had the wrong mode.
        self.world.cmds[("visudo", "-c")] = (1, "/etc/sudoers.d/alice: bad permissions, should be mode 0440\n", "")
        rep = self.doctor()
        self.assertEqual(self.texts(rep, "fail"), [])
        self.assertIn("/etc/sudoers.d/alice", "\n".join(self.texts(rep, "warn")))
        self.assertIn("sudo chmod 0440 /etc/sudoers.d/alice", self.fixes(rep, "warn"))


class SshdTests(DoctorTestCase):
    def sshd(self, text):
        self.world.cmds[("sshd", "-T", "-C", PROBE)] = ok(text)

    def test_dropin_not_loaded(self):
        self.sshd(GOOD_SSHD.replace("forcecommand " + wh.FORCED_COMMAND, "forcecommand none"))
        self.assertFailMentions(self.doctor(), "not applying the wgmanager drop-in", "Include")

    def test_overridden_setting(self):
        self.sshd(GOOD_SSHD.replace("passwordauthentication no", "passwordauthentication yes"))
        self.assertFailMentions(self.doctor(), "passwordauthentication = yes", "FIRST value")

    def test_old_sshd_challengeresponse_alias(self):
        self.sshd(GOOD_SSHD.replace("kbdinteractiveauthentication no", "challengeresponseauthentication no"))
        self.assertClean(self.doctor())

    def test_wrong_forced_command(self):
        self.sshd(GOOD_SSHD.replace(wh.FORCED_COMMAND, "sudo -n /bin/bash"))
        self.assertFailMentions(self.doctor(), "forcecommand")

    def test_allowusers_without_account_fails(self):
        self.sshd(GOOD_SSHD + "allowusers alice bob\n")
        self.assertFailMentions(self.doctor(), "AllowUsers does not include wgweb", "alice bob")

    def test_allowusers_with_account_passes(self):
        self.sshd(GOOD_SSHD + "allowusers alice wgweb\n")
        self.assertClean(self.doctor())

    def test_allowusers_wildcard_passes(self):
        self.sshd(GOOD_SSHD + "allowusers wg*\n")
        self.assertClean(self.doctor())

    def test_allowgroups_without_group_fails(self):
        self.sshd(GOOD_SSHD + "allowgroups sshusers\n")
        self.assertFailMentions(self.doctor(), "AllowGroups does not include")

    def test_allowgroups_with_group_passes(self):
        self.sshd(GOOD_SSHD + "allowgroups wgweb\n")
        self.assertClean(self.doctor())

    def test_denyusers_blocks(self):
        self.sshd(GOOD_SSHD + "denyusers wgweb\n")
        self.assertFailMentions(self.doctor(), "denyusers blocks wgweb")

    def test_denygroups_blocks(self):
        self.sshd(GOOD_SSHD + "denygroups wgweb\n")
        self.assertFailMentions(self.doctor(), "denygroups blocks wgweb")

    def test_invalid_sshd_config(self):
        self.world.cmds[("sshd", "-t")] = (1, "", "/etc/ssh/sshd_config line 9: Bad configuration option: Foo\n")
        self.assertFailMentions(self.doctor(), "sshd configuration is invalid", "Bad configuration option")

    def test_sshd_t_unavailable(self):
        self.world.cmds[("sshd", "-T", "-C", PROBE)] = (127, "", "sshd: command not found")
        self.assertFailMentions(self.doctor(), "could not ask sshd")

    def test_reports_port_for_the_app(self):
        rep = self.doctor()
        self.assertIn("port 22", "\n".join(self.texts(rep, "info")))

    def test_dropin_differing_from_checkout_warns(self):
        self.world.write(wh.SSHD_DROPIN_PATH, "Match User wgweb\n    X11Forwarding no\n")
        rep = self.doctor()
        self.assertIn("sshd drop-in differs", "\n".join(self.texts(rep, "warn")))


class AuthorizedKeysTests(DoctorTestCase):
    def keys(self, text, mode=0o644):
        self.world.write(wh.AUTHORIZED_KEYS_PATH, text, mode)

    def test_missing_file(self):
        os.unlink(self.world.real(wh.AUTHORIZED_KEYS_PATH))
        self.assertFailMentions(self.doctor(), "authorized_keys is missing")

    def test_no_keys_yet_is_a_warning(self):
        self.keys("# nothing yet\n")
        rep = self.doctor()
        self.assertEqual(self.texts(rep, "fail"), [])
        self.assertIn("no keys are installed", "\n".join(self.texts(rep, "warn")))

    def test_key_without_options_fails(self):
        self.keys("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFAKE wgmanager\n")
        self.assertFailMentions(self.doctor(), "no options in front of the key")

    def test_key_with_other_command_fails(self):
        self.keys(GOOD_KEY.replace(wh.FORCED_COMMAND, "/bin/bash"))
        self.assertFailMentions(self.doctor(), "does not force the helper command")

    def test_missing_from_warns(self):
        self.keys(GOOD_KEY.replace(',from="127.0.0.1,::1,172.30.0.0/29"', ""))
        rep = self.doctor()
        self.assertEqual(self.texts(rep, "fail"), [])
        self.assertIn("no from= restriction", "\n".join(self.texts(rep, "warn")))

    def test_any_source_warns(self):
        self.keys(GOOD_KEY.replace("127.0.0.1,::1,172.30.0.0/29", "0.0.0.0/0"))
        self.assertIn("allows any source", "\n".join(self.texts(self.doctor(), "warn")))

    def test_missing_restrict_warns(self):
        self.keys(GOOD_KEY.replace(",restrict", ""))
        self.assertIn("lacks the 'restrict' option", "\n".join(self.texts(self.doctor(), "warn")))

    def test_group_writable_file_fails(self):
        self.keys(GOOD_KEY, 0o664)
        self.assertFailMentions(self.doctor(), "authorized_keys is writable by group or others")

    def test_symlinked_file_fails(self):
        path = self.world.real(wh.AUTHORIZED_KEYS_PATH)
        os.rename(path, path + ".real")
        os.symlink(path + ".real", path)
        self.assertFailMentions(self.doctor(), "authorized_keys is not a regular file")

    def test_writable_config_directory_fails(self):
        self.world.chmod(wh.CONFIG_DIR, 0o777)
        self.assertFailMentions(self.doctor(), "config directory is writable")

    def test_non_ed25519_key_warns(self):
        self.keys(GOOD_KEY.replace("ssh-ed25519", "ssh-rsa"))
        self.assertIn("ssh-rsa", "\n".join(self.texts(self.doctor(), "warn")))

    def test_comma_inside_quoted_option_is_not_a_split(self):
        opts = wh.split_options('command="a,b",restrict,from="1.1.1.1,2.2.2.2"')
        self.assertEqual(opts["command"], "a,b")
        self.assertEqual(opts["from"], "1.1.1.1,2.2.2.2")
        self.assertIs(opts["restrict"], True)


class EndToEndTests(DoctorTestCase):
    def test_helper_error_gets_a_hint(self):
        self.world.cmds[VERSION_CMD] = (6, json.dumps(
            {"ok": False, "protocol": 1, "error": {"code": "host_misconfigured", "message": "x"}}), "")
        self.assertFailMentions(self.doctor(), "host_misconfigured", "journalctl")

    def test_sudo_refusing_is_reported(self):
        self.world.cmds[VERSION_CMD] = (1, "", "sudo: a password is required\n")
        self.assertFailMentions(self.doctor(), "calling the helper through sudo failed", "password is required")

    def test_unmanageable_clients_warn(self):
        data = json.loads(json.dumps(LIST_JSON))
        data["data"]["clients"].append({"name": "old.name", "enabled": True, "live": False, "manageable": False})
        self.world.cmds[LIST_CMD] = ok(json.dumps(data))
        rep = self.doctor()
        self.assertEqual(self.texts(rep, "fail"), [])
        self.assertIn("old.name", "\n".join(self.texts(rep, "warn")))

    def test_interface_down_warns(self):
        data = json.loads(json.dumps(LIST_JSON))
        data["data"]["interface"]["up"] = False
        self.world.cmds[LIST_CMD] = ok(json.dumps(data))
        self.assertIn("not up", "\n".join(self.texts(self.doctor(), "warn")))

    def test_list_failure(self):
        self.world.cmds[LIST_CMD] = (6, json.dumps(
            {"ok": False, "protocol": 1, "error": {"code": "busy", "message": "x"}}), "")
        self.assertFailMentions(self.doctor(), "listing clients failed", "busy")

    def test_client_counts_are_reported(self):
        self.assertIn("2 client(s): 1 enabled, 1 live", "\n".join(self.texts(self.doctor(), "ok")))


class HelperUnitTests(unittest.TestCase):
    def test_ssh_pattern_matching(self):
        m = wh.ssh_pattern_matches
        self.assertTrue(m(["alice", "wgweb"], "wgweb"))
        self.assertTrue(m(["wg*"], "wgweb"))
        self.assertFalse(m(["alice"], "wgweb"))
        self.assertFalse(m(["*", "!wgweb"], "wgweb"))
        self.assertTrue(m(["wgweb@10.*"], "wgweb"))

    def test_parse_sshd_t(self):
        parsed = wh.parse_sshd_t("Port 22\nAllowUsers a b\nport 2222\n")
        self.assertEqual(parsed["port"], ["22", "2222"])
        self.assertEqual(parsed["allowusers"], ["a b"])


if __name__ == "__main__":
    unittest.main()
