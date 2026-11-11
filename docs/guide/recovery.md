---
title: Recovering from a failed change
outline: deep
---

# Recovering from a failed change

Use this page when WG Manager shows a warning that a change failed or may be incomplete. It stays on every page until you click **I've checked this**. Nothing is retried or undone automatically. The steps below work out what happened and put it right.

::: warning Don't do this over the VPN you are fixing
Work from your local network or a console. Restarting WireGuard, or restoring a backup that changes your own client, cuts the connection you are using.
:::

## 1. Look first {#look-first}

Run these on the server. All of them are read-only:

```sh
pivpn -l                                               # clients PiVPN knows about, and which are disabled
sudo wg show wg0                                       # what is live on the interface (private keys are hidden)
systemctl status wg-quick@wg0                          # is the interface up?
sudo python3 /usr/local/lib/wgmanager/wgmanager-host doctor
```

Then click refresh in WG Manager. If the client now looks the way you wanted, click **I've checked this**. You're done.

## 2. Find your situation {#find-your-situation}

The warning lists what didn't check out. Find its wording below.

### "It is not active on the running interface" / "It is still active on the running interface" (and nothing else) {#not-active}

**Cause:** the files are right, but WireGuard didn't reload.

**Fix:** reload it:

```sh
sudo systemctl reload wg-quick@wg0
```

If that fails, `journalctl -u wg-quick@wg0 -n 50` usually says why. A full `sudo systemctl restart wg-quick@wg0` also works but briefly disconnects every client.

### Add didn't finish

Run `pivpn -l` and find your case:

- **The client is listed.** Remove it with PiVPN, then add it again in WG Manager:

  ```sh
  pivpn remove <NAME>
  ```

- **It isn't listed, but adding it again fails.** PiVPN refuses because a leftover config file exists. Delete what `add` left behind, then add it again:

  ```sh
  sudo rm -f /etc/wireguard/configs/<NAME>.conf /etc/wireguard/keys/<NAME>_priv /etc/wireguard/keys/<NAME>_pub /etc/wireguard/keys/<NAME>_psk
  ```

  If the server config has a `### begin <NAME> ###` block for it, [restore the backup](#restoring-a-backup) to remove it.

- **Nothing was created at all.** PiVPN probably refused the add, for example because the VPN subnet has no free addresses left.

### Delete didn't finish

Run `pivpn -l` and find your case:

- **The client is still listed.** Run the delete again with PiVPN:

  ```sh
  pivpn remove <NAME>
  ```

- **It's gone from the list but still has a block in `/etc/wireguard/wg0.conf`, or is still live.** [Restore the backup](#restoring-a-backup), then delete it again.

### Enable or disable didn't stick

Run it again with PiVPN, then [reload](#not-active) if the interface still disagrees:

```sh
pivpn on <NAME>     # or: pivpn off <NAME>
```

### "Nothing was changed, but the client is not in the expected state"

**Cause:** the server config and the live interface disagreed before WG Manager touched anything.

**Fix:** find your case:

- **The client is disabled in the file but still live.** [Reload](#not-active).
- **The client has no block in the server config at all.** Run `pivpn remove <NAME>`, then add it again.

### "PiVPN did not finish within 30 seconds and was stopped"

**Cause:** PiVPN was stopped partway, so its files may be half-written.

**Fix:** look at them ([section 1](#look-first)), then follow the matching case above, or [restore the backup](#restoring-a-backup).

### "The host did not answer within 60 seconds" / "Lost contact with WG Manager"

**Cause:** WG Manager can't tell whether the change happened.

**Fix:** refresh. The list shows what is really on the server. Do the change again only if it didn't happen.

## 3. Restore a backup {#restoring-a-backup}

Before every change, the helper saves the server config and PiVPN's client list.

1. **Find the backup.** The warning shows its two files:

   ```
   /var/backups/wgmanager/<backup>.wg0.conf
   /var/backups/wgmanager/<backup>.clients.txt
   ```

   `<backup>` looks like `20261020T211500123Z-add-Bob_Phone`: the time in UTC, the action and the client. The newest 20 changes are kept by default. To list them:

   ```sh
   sudo ls -lt /var/backups/wgmanager
   ```

2. **Compare it with the current files, if you like.** The output contains keys, so don't paste it anywhere:

   ```sh
   sudo diff /var/backups/wgmanager/<backup>.wg0.conf /etc/wireguard/wg0.conf
   sudo diff /var/backups/wgmanager/<backup>.clients.txt /etc/wireguard/configs/clients.txt
   ```

3. **Restore both files and apply them.**

   ::: warning Use one backup, and the right one
   Restore both files from the **same** backup, and only the newest backup that is older than the problem. An older one also undoes every change made since.
   :::

   Use `cp` as shown: it keeps the existing files' owner and permissions.

   ```sh
   sudo cp /var/backups/wgmanager/<backup>.wg0.conf /etc/wireguard/wg0.conf
   sudo cp /var/backups/wgmanager/<backup>.clients.txt /etc/wireguard/configs/clients.txt
   sudo systemctl reload wg-quick@wg0
   ```

4. **Refresh WG Manager** and click **I've checked this**.

## 4. What a backup does not cover {#not-covered}

The backup holds only the server config and the client list. PiVPN keeps more for each client:

| What | Where | Created by add | Deleted by remove |
|---|---|---|---|
| Client's keys | `/etc/wireguard/keys/<NAME>_priv`, `_pub`, `_psk` | yes | yes |
| Client's config (with its private key) | `/etc/wireguard/configs/<NAME>.conf` | yes | yes |
| Copy of the config for the PiVPN user | `configs/<NAME>.conf` in that user's home folder | yes | yes |
| Pi-hole name (only with Pi-hole) | `/etc/pivpn/hosts.wireguard` | yes | yes |

So:

- **A deleted client can't be brought back from a backup.** Its keys and config are gone. Add it again and set the device up with the new config.
- **After restoring a backup that undoes an add**, the files above may be left behind. Delete them, or the next add with that name fails. If you use Pi-hole, remove the client's line from `hosts.wireguard` too.
- **Enable and disable** only change the server config, so a backup fully covers them.

## 5. When you're done {#done}

- Click **I've checked this** on the warning. The client stays flagged until the list is consistent again.
- Run `doctor` once more if anything about the setup itself was reported.
- Leave the backups where they are. They contain the server's private key and are readable by root only.
