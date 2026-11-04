---
title: Getting started
outline: deep
---

# Getting started

## Before you begin

### What you need

- A 64-bit server (amd64 or arm64) running Debian or a Debian-based system, such as Raspberry Pi OS (64-bit). WG Manager is tested on Debian 13; see [Tested with](./how-it-works#tested-with).
- [PiVPN](https://pivpn.io) already set up with **WireGuard** (not OpenVPN).
- Docker with Compose v2. Check with `docker compose version`.
- `python3`, `sudo` and an OpenSSH server (the service that lets you log in over SSH). Most Debian servers already have all three.

WG Manager must run on **the same machine as PiVPN**, not on a separate computer.

**About SSH.** WG Manager accepts only the server's ED25519 host key, which Debian creates by default; `doctor` warns if it is missing. On Ubuntu 22.10 and later, `sshd` is started on demand and only runs after the first connection, so connect over SSH once before installing. There, the port and listen addresses come from `ssh.socket`, not `sshd_config`.

### Where to run each command

Run every command in this guide in a terminal **on the PiVPN server** (for example, over SSH), unless a step says otherwise. Steps that happen in a web browser can be done from any device on your network.

Depending on how Docker is set up on your server, `docker` commands may need `sudo` in front of them. If one fails with "permission denied", run it again with `sudo`.

### Look up two things

You will need these during the install:

- **Your server's address:** the address or name you use to log in to it over SSH, for example `192.168.1.10` or `myserver.local`. In this guide it is written `<server-address>`.
- **Your SSH port:** `22` unless you changed it. To check, run `sudo sshd -T | grep -i '^port '`. It prints a line such as `port 22`.

> [!WARNING]
> Don't install, update or restart WG Manager while you are connected to the server through the VPN it manages. If something goes wrong, you lose the connection you are using. Connect from your local network, or use the server's own keyboard and screen, instead.


## Install

### Step 1. Download the two setup files

Create a folder for WG Manager and put two files in it:

- `compose.yaml` tells Docker how to run the app.
- `.env` holds your settings.

Any folder works. If you use a container manager such as Arcane, create the folder where it looks for projects.

```sh
mkdir -p ~/wgmanager && cd ~/wgmanager
curl -fsSLO https://raw.githubusercontent.com/elmedico27/wgmanager/master/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/elmedico27/wgmanager/master/.env.example
mv .env.example .env
```

If you'd rather not use `curl`, create both files yourself and paste in the contents of [compose.yaml](https://github.com/elmedico27/wgmanager/blob/master/compose.yaml) and [.env.example](https://github.com/elmedico27/wgmanager/blob/master/.env.example).

The settings file must be named exactly **`.env`**, not `.env.example`, or Docker Compose ignores it. File names that start with a dot are hidden by default; `ls -a` shows them.

### Step 2. Check your settings

Open `.env` in any text editor (for example `nano .env`). Every setting is optional. The one you are most likely to change:

- If your SSH port is not `22`, set `SSH_PORT` to your port.

Leave the rest as it is unless you have a reason to change it. Every setting is explained in the [Configuration reference](./configuration).

### Step 3. Start WG Manager and find the setup code

In the same folder, run:

```sh
docker compose up -d
docker logs wgmanager
```

The first command downloads and starts the app, which can take a minute. The second shows its log, which contains a one-time **setup code** in a box like this (your code will differ):

```
============================================================
 wgmanager has no admin password yet.
 Setup code: 7H2K-QX9M-4TDB
 Open the web UI and enter this code to choose the password.
============================================================
```

If you miss it, run `docker logs wgmanager` again. A container manager's log view (Arcane, Portainer and others) shows it too.

### Step 4. Choose your admin password

In a browser, open `http://<server-address>:7501`. If you changed `WEB_PORT`, use that port instead of `7501`.

1. Enter the **Setup code**. Capital letters and dashes don't matter.
2. Enter a **New password** of at least 12 characters, then repeat it under **Confirm password**.
3. Click **Save password and continue**.

From now on you sign in with this password only. There is no username.

### Step 5. Install the helper on the server {#install-helper}

The next screen is titled **Connect WG Manager to your server**. Under **Install the helper on the server** is a command with this app's SSH key already filled in. Click **Copy**, then paste and run it in a terminal on the server. It looks like this:

```sh
sudo docker cp wgmanager:/opt/wgmanager/host/. /usr/local/lib/wgmanager && \
  sudo python3 /usr/local/lib/wgmanager/wgmanager-host install --pubkey "ssh-ed25519 AAAA... wgmanager@container"
```

> [!IMPORTANT]
> The `ssh-ed25519 AAAA...` above is only a placeholder. Copy the command from the screen so that it contains your app's real key.

The command does two things:

1. It copies the helper's files out of the container into `/usr/local/lib/wgmanager`. Keep the `sudo`: the files must end up owned by root.
2. It runs the installer. The installer first prints a plan of every change and asks `Proceed? [y/N]`. Nothing has changed yet. Type `y` and press Enter to go ahead; anything else cancels.

Good to know:

- To see the plan without installing, add `--dry-run` to the end of the command. To skip the question, add `--yes`.
- If the server already has a different WG Manager key installed (for example, after you reinstalled the app from scratch), add `--replace-key` to the end of the command.
- [What the installer changes on the server](./how-it-works#installer-changes) lists every file it touches.

When it finishes, the installer runs its checks and ends with a line like this, which you need in the next step:

```
Server fingerprint for the web UI: SHA256:7Zk3mQ1vYy0b8t5nJd2RwXl9pUcA4eHs6GfTiVoNqMw (ED25519)
```

### Step 6. Confirm that this is your server

Back in the browser, click **Test connection**. WG Manager contacts the server and shows **Confirm this is your server**, with the fingerprint the server presented.

1. Compare it with the fingerprint on the installer's last line. If you no longer have that output, run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server and compare against its output.
2. If they are the same, click **It matches**.
3. If they differ, click **It doesn't match** and stop. See [The fingerprints don't match](./troubleshooting#fingerprints-dont-match).

WG Manager remembers this fingerprint. From then on it refuses to talk to anything that presents a different one, so nothing can pose as your server.

Your clients now appear. The install is finished.


## Update

Update the app first, then the helper. Both steps are safe to repeat. Read the [warning](#before-you-begin) about the VPN connection first.

1. **Update the app.** The helper files come from the app, so this goes first. In the folder that contains `compose.yaml`, run:

   ```sh
   docker compose pull && docker compose up -d
   ```

   Your password, SSH key and confirmed server identity are kept, so you don't need a new setup code. If you set `WGM_VERSION` in `.env` to a fixed version, change it to the new one first.

2. **Update the helper.** Sign in, open **Settings › App key**, copy the install command and run it on the server, exactly as in [Step 5](#install-helper). It changes only what differs. The app and the helper are released together, so do this after every app update.


## Uninstall

Your WireGuard server, PiVPN and all clients are left exactly as they are.

1. **Remove the helper from the server:**

   ```sh
   sudo python3 /usr/local/lib/wgmanager/wgmanager-host uninstall
   sudo rm -rf /usr/local/lib/wgmanager
   ```

   The first command removes what the installer added, including the `wgweb` account, but keeps the config backups in `/var/backups/wgmanager`. Add `--purge` to delete the backups and the optional settings file (`/etc/wgmanager/config`) too. The second command deletes the copy of the installer tool.

2. **Remove the app.** In the folder that contains `compose.yaml`:

   ```sh
   docker compose down -v
   ```

   The `-v` also deletes the app's data: the admin password, the SSH key and the confirmed server identity. Leave it out to keep that data for a later reinstall.

You can then delete the folder you made in Step 1.

