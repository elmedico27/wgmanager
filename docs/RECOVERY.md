# Recovering from a failed change

WG Manager changes your server by running PiVPN's own commands (`pivpn add`, `remove`, `on`, `off`), then checks that the change really happened. If a check fails, it shows a warning that stays until you acknowledge it. Nothing is retried or undone automatically. This page is for working out what happened and putting things right.

> [!WARNING]
> Do this from your local network or a console, not over the VPN you are fixing. Restarting WireGuard, or restoring a backup that changes your own client, cuts the connection you are using.

## 1. Look first

All of these are read-only:

```sh
pivpn -l                                               # clients PiVPN knows about, and which are disabled
sudo wg show wg0                                       # what is live on the interface (private keys are hidden)
systemctl status wg-quick@wg0                          # is the interface up?
sudo python3 /usr/local/lib/wgmanager/wgmanager-host doctor
```

Then click refresh in WG Manager. If the client now looks the way you wanted, the warning was about a check that has since passed: click **I've checked this** and you're done.

## 2. Find your situation

The warning lists what didn't check out. Most failures fall into one of these.

### "It is not active on the running interface" / "It is still active on the running interface" (and nothing else)

The files are right, but WireGuard didn't reload. PiVPN reports success even when its reload fails. Reload it:

```sh
sudo systemctl reload wg-quick@wg0
```

If that fails, `journalctl -u wg-quick@wg0 -n 50` usually says why. A full `sudo systemctl restart wg-quick@wg0` also works but briefly disconnects every client.

### Add didn't finish

If the client shows up in `pivpn -l`, remove it with PiVPN, then add it again in WG Manager:

```sh
pivpn remove <NAME>
```

If it doesn't show up but adding it again fails, PiVPN refuses because a leftover config file exists. Delete what `add` left behind, then add it again:

```sh
sudo rm -f /etc/wireguard/configs/<NAME>.conf /etc/wireguard/keys/<NAME>_priv /etc/wireguard/keys/<NAME>_pub /etc/wireguard/keys/<NAME>_psk
```

If the server config has a `### begin <NAME> ###` block for it, [restore the backup](#3-restoring-a-backup) to remove it.

If nothing was created at all, PiVPN probably refused the add, for example because the VPN subnet has no free addresses left.

### Delete didn't finish

If the client still shows up in `pivpn -l`, run the delete again with PiVPN:

```sh
pivpn remove <NAME>
```

If it's gone from the list but still has a block in `/etc/wireguard/wg0.conf` or is still live, [restore the backup](#3-restoring-a-backup) and then delete it again.

### Enable or disable didn't stick

Run it again with PiVPN, then reload if the interface still disagrees:

```sh
pivpn on <NAME>     # or: pivpn off <NAME>
```

"Nothing was changed, but the client is not in the expected state" means the server config and the live interface disagreed before WG Manager touched anything. For example, the client is disabled in the file but still live, or it has no block in the server config at all. A reload (first section) fixes the first case. The second needs `pivpn remove` and adding it again.

### "PiVPN did not finish within 30 seconds and was stopped"

PiVPN was stopped partway, so its files may be half-written. Look at them (section 1), then follow the matching case above, or restore the backup.

### "The host did not answer within 60 seconds" / "Lost contact with WG Manager"

WG Manager can't tell whether the change happened. Refresh: the list shows what is really on the server. Do the change again only if it didn't happen.

## 3. Restoring a backup

Before every change, the helper saves the server config and PiVPN's client list. The warning shows the two files:

```
/var/backups/wgmanager/<backup>.wg0.conf
/var/backups/wgmanager/<backup>.clients.txt
```

`<backup>` looks like `20261020T211500123Z-add-Bob_Phone`: the time in UTC, the action and the client. The newest 20 changes are kept by default. To list them:

```sh
sudo ls -lt /var/backups/wgmanager
```

To compare a backup with the current file (the output contains keys, so don't paste it anywhere):

```sh
sudo diff /var/backups/wgmanager/<backup>.wg0.conf /etc/wireguard/wg0.conf
sudo diff /var/backups/wgmanager/<backup>.clients.txt /etc/wireguard/configs/clients.txt
```

To restore both and apply them. Copying over the existing files keeps their owner and permissions:

```sh
sudo cp /var/backups/wgmanager/<backup>.wg0.conf /etc/wireguard/wg0.conf
sudo cp /var/backups/wgmanager/<backup>.clients.txt /etc/wireguard/configs/clients.txt
sudo systemctl reload wg-quick@wg0
```

Restore both files from the **same** backup, and only the newest backup that is older than the problem. Restoring an older one also undoes every change made since.

Then refresh WG Manager and click **I've checked this**.

## 4. What a backup does not cover

The backup holds only the server config and the client list. PiVPN keeps more for each client:

| What | Where | Created by add | Deleted by remove |
|---|---|---|---|
| Client's keys | `/etc/wireguard/keys/<NAME>_priv`, `_pub`, `_psk` | yes | yes |
| Client's config (with its private key) | `/etc/wireguard/configs/<NAME>.conf` | yes | yes |
| Copy of the config for the PiVPN user | `configs/<NAME>.conf` in that user's home folder | yes | yes |
| Pi-hole name (only with Pi-hole) | `/etc/pivpn/hosts.wireguard` | yes | yes |

So:

- **A deleted client can't be brought back from a backup.** Its keys and config are gone. Add it again and set the device up with the new config.
- **After restoring a backup that undoes an add**, the files above may be left behind. Delete them, or the next add with that name fails. Remove the client's line from `hosts.wireguard` too if you use Pi-hole.
- **Enable and disable** only change the server config, so a backup fully covers them.

## 5. When you're done

- Click **I've checked this** on the warning. The client stays flagged until the list is consistent again.
- Run `doctor` once more if anything about the setup itself was reported.
- The backups contain the server's private key. They are readable by root only. Leave them where they are.
