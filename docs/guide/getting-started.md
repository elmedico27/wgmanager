---
title: Getting started
outline: deep
---

# Getting started

How to install, update and uninstall WG Manager.

## Before you begin

::: warning Don't use the VPN you're managing
Don't install, update or restart WG Manager while you are connected to the server through its own VPN. If something goes wrong, you lose the connection you are using. Connect from your local network, or use the server's own keyboard and screen.
:::

### What you need

- A 64-bit server (amd64 or arm64) running Debian or a Debian-based system, such as Raspberry Pi OS (64-bit). Tested on Debian 13; see [Tested with](./how-it-works#tested-with).
- [PiVPN](https://pivpn.io) already set up with **WireGuard** (not OpenVPN). WG Manager runs on **the same machine** as PiVPN.
- Docker with Compose v2. Check with `docker compose version`.
- `python3`, `sudo` and an OpenSSH server (the service that lets you log in over SSH). Most Debian servers have all three.
- An ED25519 SSH host key, which Debian creates by default. `doctor` warns if it is missing; see [Troubleshooting](./troubleshooting#doctor).

::: details Ubuntu 22.10 and later
`sshd` starts on demand and only runs after the first connection, so connect over SSH once before installing. The port and listen addresses come from `ssh.socket`, not `sshd_config`.
:::

### Where to run each command

Run every command in a terminal **on the PiVPN server** (for example, over SSH), unless a step says otherwise. Steps in a web browser can be done from any device on your network.

If a `docker` command fails with "permission denied", run it again with `sudo`.

### Look up two things

- **Your server's address:** the address or name you use to log in over SSH, for example `192.168.1.10` or `myserver.local`. This guide writes it as `<server-address>`.
- **Your SSH port:** `22` unless you changed it. To check, run `sudo sshd -T | grep -i '^port '`. It prints a line such as `port 22`.

## Install

### Step 1. Download the setup files

Create a folder and download two files into it:

- `compose.yaml` tells Docker how to run the app.
- `.env` holds your settings.

```sh
mkdir -p ~/wgmanager && cd ~/wgmanager
curl -fsSLO https://raw.githubusercontent.com/elmedico27/wgmanager/master/compose.yaml
curl -fsSLo .env https://raw.githubusercontent.com/elmedico27/wgmanager/master/.env.example
```

::: tip Using a container manager?
If you manage Docker with Arcane or a similar tool, create the folder where it looks for projects.
:::

::: details Without `curl`
Create both files yourself and paste in the contents of [compose.yaml](https://github.com/elmedico27/wgmanager/blob/master/compose.yaml) and [.env.example](https://github.com/elmedico27/wgmanager/blob/master/.env.example). Save the second one as exactly **`.env`**, or Docker Compose ignores it. File names that start with a dot are hidden by default; `ls -a` shows them.
:::

### Step 2. Check your settings

Open `.env` in a text editor (for example, `nano .env`). If your SSH port is not `22`, set `SSH_PORT` to your port. Leave everything else as it is.

Every setting is optional and explained in the [Configuration reference](./configuration).

### Step 3. Start WG Manager and find the setup code

In the same folder, run:

```sh
docker compose up -d
docker logs wgmanager
```

The log contains a one-time **setup code** in a box like this (yours will differ):

```
============================================================
 wgmanager has no admin password yet.
 Setup code: 7H2K-QX9M-4TDB
 Open the web UI and enter this code to choose the password.
============================================================
```

To see it again, run `docker logs wgmanager` again. A container manager's log view (Arcane, Portainer and others) shows it too.

### Step 4. Choose your admin password

1. In a browser, open `http://<server-address>:7501`. If you changed `WEB_PORT`, use that port instead.
2. Enter the **Setup code**. Capital letters and dashes don't matter.
3. Enter a **New password** of 12 to 128 characters, then repeat it under **Confirm password**.
4. Click **Save password and continue**.

From now on you sign in with this password only. There is no username.

### Step 5. Install the helper on the server {#install-helper}

1. On the **Connect WG Manager to your server** screen, find **Install the helper on the server**. It holds a command with this app's SSH key already filled in. Click **Copy**.
2. Paste the command into a terminal on the server and run it. It looks like this:

   ```sh
   sudo docker cp wgmanager:/opt/wgmanager/host/. /usr/local/lib/wgmanager && \
     sudo python3 /usr/local/lib/wgmanager/wgmanager-host install --pubkey "ssh-ed25519 AAAA... wgmanager@container"
   ```

   ::: warning Copy the command from the screen
   The `ssh-ed25519 AAAA...` above is a placeholder. The command on the screen contains your app's real key. Keep the `sudo` in front of `docker cp`: the files must end up owned by root.
   :::

3. The installer prints a plan of every change and asks `Proceed? [y/N]`. Nothing has changed yet. Type `y` and press Enter. Anything else cancels.

When it finishes, the installer runs its checks and ends with a line like this. You need it in the next step:

```
Server fingerprint for the web UI: SHA256:7Zk3mQ1vYy0b8t5nJd2RwXl9pUcA4eHs6GfTiVoNqMw (ED25519)
```

Add these to the end of the command when needed:

| Option | Use it to |
| --- | --- |
| `--dry-run` | See the plan without installing. |
| `--yes` | Skip the `Proceed?` question. |
| `--replace-key` | Replace a different WG Manager key already installed on the server, for example after reinstalling the app from scratch. |

[What the installer changes on the server](./how-it-works#installer-changes) lists every file it touches.

### Step 6. Confirm that this is your server

1. In the browser, click **Test connection**. WG Manager shows **Confirm this is your server**, with the fingerprint the server presented.
2. Compare it with the installer's last line.
3. If they are the same, click **It matches**.
4. If they differ, click **It doesn't match** and stop. See [The fingerprints don't match](./troubleshooting#fingerprints-dont-match).

::: tip No longer have the installer output?
Run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server and compare against its output.
:::

Your clients now appear. The install is finished.

## Update

Update the app first, then the helper. Both steps are safe to repeat. Read the [warning](#before-you-begin) about the VPN connection first.

1. **Update the app.** If you set `WGM_VERSION` in `.env` to a fixed version, change it to the new one. Then, in the folder that contains `compose.yaml`, run:

   ```sh
   docker compose pull && docker compose up -d
   ```

   You don't need a new setup code. Your password, SSH key and confirmed server identity are kept.

2. **Update the helper, if needed.** Sign in. A **Helper update available** notice at the top of every page means the helper on your server is older than the one the new app version comes with. No notice means it is current.
   1. Click **Show update command**, copy the command and run it on the server.
   2. Click **Check again**. The notice disappears once the helper is current.

   The same command is under **Settings › App key**. It changes only what differs, so running it again is harmless.

## Uninstall

Your WireGuard server, PiVPN and all clients are left exactly as they are.

1. **Remove the helper from the server:**

   ```sh
   sudo python3 /usr/local/lib/wgmanager/wgmanager-host uninstall
   sudo rm -rf /usr/local/lib/wgmanager
   ```

   The first command removes what the installer added, including the `wgweb` account, but keeps the config backups in `/var/backups/wgmanager`. Add `--purge` to also delete the backups and the optional settings file (`/etc/wgmanager/config`). The second command deletes the copy of the installer tool.

2. **Remove the app.** In the folder that contains `compose.yaml`, run:

   ```sh
   docker compose down -v
   ```

   The `-v` also deletes the app's data: the admin password, the SSH key and the confirmed server identity. Leave it out to keep that data for a later reinstall.

You can then delete the folder you made in Step 1.
