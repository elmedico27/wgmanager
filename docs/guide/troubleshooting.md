---
title: Troubleshooting
---

# Troubleshooting

Start with [the doctor](#doctor): it finds most server-side problems and prints the command that fixes each one.

## Run the doctor {#doctor}

`doctor` is a read-only check of everything the helper needs. It changes nothing.

```sh
sudo python3 /usr/local/lib/wgmanager/wgmanager-host doctor
```

## "Nothing answered on SSH" {#nothing-answered}

WG Manager couldn't reach your server's SSH service. Check, in order:

1. The server is on and `sshd` is running.
2. `SSH_HOST` and `SSH_PORT` in `.env` are right. After a change, run `docker compose up -d` in the app's folder.
3. `sshd` accepts connections on the app network's gateway address, `172.29.88.1`. The default setting (listen on all addresses) does. If you set `ListenAddress` yourself, add that address.
4. A firewall on the server allows SSH from `172.29.88.0/29`, the app's network.

Then click **Test connection** again.

## "The server answered but does not accept this app's key yet" {#key-not-accepted}

The helper isn't installed yet, or was installed with a different key. Run the install command from the screen (see [Step 5](./getting-started#install-helper)), then test again.

## The fingerprints don't match {#fingerprints-dont-match}

Don't continue. The server answering at `SSH_HOST` and `SSH_PORT` isn't presenting the fingerprint you expect.

1. Check that `SSH_HOST` and `SSH_PORT` in `.env` point at your WireGuard server, and fix them if not. Then run `docker compose up -d` and click **Check again**.
2. If they are right and the fingerprints still differ, something else may be answering in your server's place. Find out what before going on.

The same applies if WG Manager later says **The server's identity changed** (on the **Host** page). It sends nothing to the server until you decide. If you know why (you reinstalled the server or replaced its SSH keys), go to **Settings › Server identity › Confirm a new server identity…** and confirm the new fingerprint. If you don't know why, investigate first.

## The app's network clashes with another network {#network-clash}

The app runs on its own small Docker network, `172.29.88.0/29` (addresses `172.29.88.0` to `172.29.88.7`), a range that is rarely used. If it overlaps with a network you already have, `docker compose up -d` fails with an error saying the address pool overlaps (Docker's wording is "Pool overlaps with other one on this address space"). It also must not overlap the range your VPN clients use.
<!-- unverified: Docker's error wording above has not been seen on a real host. The `docker network inspect` command below was run on a real server (2026-10-25) and prints one `name: range` line per network. -->

To check and fix it:

1. **List your Docker networks and their ranges:**

   ```sh
   docker network ls -q | xargs docker network inspect --format '{{.Name}}: {{range .IPAM.Config}}{{.Subnet}} {{end}}'
   ```

   Each line is a network's name and its range, for example `bridge: 172.17.0.0/16`. Networks named `host` and `none` have no range; ignore them.

2. **Find your VPN's range.** Your clients' addresses on the **Clients** page show it (for example, `10.6.0.x`). PiVPN also stores it in `/etc/pivpn/wireguard/setupVars.conf` as `pivpnNET`.
3. **If any range overlaps `172.29.88.0/29`, choose another** unused private range of the same size, such as `192.168.250.0/29`. Write it as the network address (ending in `.0`), not the first usable address. Its gateway is the first usable address, `192.168.250.1`.
4. **Edit `compose.yaml`:** change `subnet` and `gateway` under `networks:` to your new values.
5. **Edit `.env`:** set `SSH_HOST` to the new gateway address.
6. **Recreate the app:** `docker compose up -d`.
7. **Update the server's allowed addresses.** Run the install command from **Settings › App key** again, with `--allow-from` added to the end:

   ```sh
   --allow-from 127.0.0.1,::1,192.168.250.0/29
   ```

   This list *replaces* the default, so keep `127.0.0.1,::1` in it. Reinstalling the same key with a different `--allow-from` doesn't need `--replace-key`.
8. Make sure the firewall rule and `sshd`'s `ListenAddress` (see ["Nothing answered on SSH"](#nothing-answered)) use the new gateway and range.

## The WireGuard interface is down {#interface-down}

WG Manager shows a banner saying no client can connect, and switches off **Add client** and **Enable**. The banner shows the exact command to start the interface on the server. With the usual interface name, `wg0`, it is:

```sh
sudo systemctl start wg-quick@wg0
```

## A change failed {#change-failed}

Before every change, the helper backs up the server's config. If a change fails or only partly happens, WG Manager shows a warning on every page until you acknowledge it. It does not undo changes automatically. [Recovering from a failed change](./recovery) explains how to check what happened and restore from the backup.

## I forgot the admin password {#forgot-password}

Run this on the server:

```sh
docker exec wgmanager wgmanager reset-password
```

It removes the password, signs everyone out, and prints a new **setup code** right in your terminal. Open the web page, enter the code and choose a new password.
