---
title: Web interface
---

# Web interface

The sidebar (a bar along the bottom on phones) has three pages: **Clients**, **Host** and **Settings**. At its bottom are a theme button (follow your device, light or dark) and **Sign out**.

## Clients

![The Clients page in card view (sample data)](/screenshot-light.png){.screenshot .only-light}
![The Clients page in card view (sample data)](/screenshot-dark.png){.screenshot .only-dark}

This page lists your VPN clients as cards or as a list; switch between them with the buttons at the top. It refreshes itself every 15 seconds while the tab is visible.

- **Add a client:** click **Add client**, enter a name and confirm. The new client's QR code and config download appear straight away. Scan the QR code with the WireGuard app on a phone, or download the config file for a computer.
- **Open a client:** click it. A panel slides in with its QR code and config (each behind a click, because they contain the client's private key), a download button, its details, and **Manage** buttons to disable, enable or delete it. Disabling and deleting ask you to confirm.
- **Notes:** each client's panel has a **Notes** box for anything you want to remember about it, up to 500 characters (spaces at the start and end don't count). Drag the box's bottom corner to make it taller. If it runs over (for example after pasting), nothing is cut off: the counter turns red and **Save** stays off until you shorten it. Click **Save** to keep it; closing the panel or using Back or Forward with unsaved changes asks first, and if the client disappears from the list while you are typing, your text stays on screen until you close the panel. Clients with a note show a small note icon next to their name; point at it to read the note (on a phone, open the client). Notes are stored by WG Manager, not on the server, and belong to that client only: deleting the client in WG Manager deletes its note, and a client re-created under the same name starts without one.
- **Search:** click the magnifying glass next to the refresh button and type. The list shows only clients whose name, address or note contains your text (capitals don't matter). The filter stays on when you close the search box, and a dot on the magnifying glass shows it's on. It also stays while you open clients, use Back and Forward, or visit Host and Settings. Reloading the page or signing out clears it. If nothing matches, click **Clear**. A link to a client always opens it, even one the filter hides.
- **Sort:** in card view, click the arrows button next to the magnifying glass and pick a field under **Sort by**; in list view, click a column heading. Click the same field again to reverse. Your browser remembers your choice.

**Client names** can use letters, digits, `_` and `-`, up to 15 characters. A name can't be all digits, can't be `server`, and must be unique (`Alice` and `alice` count as the same name). Use one client per device, for example `Alice_Phone`.

**What the details mean:**

| Item | Meaning |
|---|---|
| Status dot | **Green:** enabled and active on the server's WireGuard interface. **Red:** disabled. **Yellow:** something doesn't line up, for example enabled but not active. Open the client to see why; **Enable again** can fix it. |
| Connected now | The device completed a *handshake* (the brief exchange WireGuard uses to set up a secure link) in the last 3 minutes. WireGuard has no real "connected" state, and an idle device sends nothing, so a connected but idle device can look disconnected. |
| Last handshake | When that exchange last happened. |
| Last seen from | The device's public internet address at its last handshake. It is not your server's address. |
| Downloaded / Uploaded | Data transferred, counted from the device's point of view, since the WireGuard interface last started. |
| Address | The client's address inside the VPN. |

Some clients are shown greyed out with a reason. These are clients whose name breaks the rules above, or whose address is outside the VPN's range. Manage them with `pivpn` on the server. You can still open them: the panel shows their details and their note (which you can edit), but no QR code or config, and its buttons are switched off.

If the WireGuard interface is down, **Add client** and **Enable** are switched off, because a change couldn't take effect. See [The WireGuard interface is down](./troubleshooting#interface-down).

## Host

![The Host page (sample data)](/screenshot-host-light.png){.screenshot .only-light}
![The Host page (sample data)](/screenshot-host-dark.png){.screenshot .only-dark}

Shows the state of the server side: the WireGuard interface (name, port, public key, number of clients), the helper (version, protocol, backend and the address it was reached at) and the PiVPN scripts it runs, with a SHA-256 hash of each. Warnings from the server appear here too.

## Settings

![The Settings page (sample data)](/screenshot-settings-light.png){.screenshot .only-light}
![The Settings page (sample data)](/screenshot-settings-dark.png){.screenshot .only-dark}

- **Appearance:** follow your device, light or dark.
- **Admin password:** change it by entering the current one and a new one. This signs out every other browser. A password needs 12 to 128 characters. The 128 limit is counted in bytes, which is the same as characters for plain English letters, digits and symbols; accented letters, other scripts and emoji use 2 to 4 bytes each. Nothing is ever cut off: a password that is too long is refused.
- **SSH connection:** shows the server address, port and account WG Manager uses. These can't be changed here; edit `.env` instead (see [Configuration reference](./configuration)).
- **Server identity:** the pinned fingerprint. Use **Confirm a new server identity…** only after you have deliberately replaced the server's SSH keys.
- **App key:** the app's public SSH key and the install command, used when you [update](./getting-started#update) the helper.

## Notices at the top

Two kinds of notice can appear above every page:

- **A change failed or may be incomplete.** It stays until you click **I've checked this**. See [Recovering from a failed change](./recovery).
- **Helper update available.** The helper on your server is older than the one this version of WG Manager comes with. Click **Show update command**, run the command on the server, then click **Check again**. The notice disappears once the helper is current.

## Install as an app

You can add WG Manager to a phone's home screen, or to a computer's apps, so it opens in its own window without the browser's address bar. The exact menu wording differs between browsers and versions, but it is usually:

- **Android, Chrome:** the menu (three dots), then **Install app** or **Add to Home screen**.
- **iPhone and iPad, Safari:** the Share button, then **Add to Home Screen**.
- **Chrome or Edge on a computer:** the install icon at the right end of the address bar, or the browser menu.

Browsers offer to install a site as an app only when it is served over HTTPS (or from `localhost`). Over a plain `http://` address on your own network you may only get a shortcut that opens in a normal browser tab. To get the full app, put WG Manager behind an HTTPS reverse proxy ([Configuration](./configuration) says how it is set up).

Installing changes only how it looks. It still needs the server (there is no offline mode), the same sign-in rules apply, and the installed app may keep its own sign-in, so you might have to sign in again there.

## Page links

Each page has its own address, so you can bookmark it: `/clients`, `/host` and `/settings`. A client's panel has one too: `/clients/<name>`. Your browser's Back and Forward buttons work as expected.
