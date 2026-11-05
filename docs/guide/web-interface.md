---
title: Web interface
---

# Web interface

The sidebar (a bar along the bottom on phones) has three pages: **Clients**, **Host** and **Settings**. At its bottom are a theme button (follow your device, light or dark) and **Sign out**.

## Clients

This page lists your VPN clients as cards or as a list; switch between them with the buttons at the top. It refreshes itself every 15 seconds while the tab is visible.

- **Add a client:** click **Add client**, enter a name and confirm. The new client's QR code and config download appear straight away. Scan the QR code with the WireGuard app on a phone, or download the config file for a computer.
- **Open a client:** click it. A panel slides in with its QR code and config (each behind a click, because they contain the client's private key), a download button, its details, and **Manage** buttons to disable, enable or delete it. Disabling and deleting ask you to confirm.
- **Sort:** click a column heading in list view, or use **Sort by** above the cards. Click again to reverse. Your browser remembers your choice.

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

Some clients are shown greyed out with a reason and no buttons. These are clients whose name breaks the rules above, or whose address is outside the VPN's range. Manage them with `pivpn` on the server.

If the WireGuard interface is down, **Add client** and **Enable** are switched off, because a change couldn't take effect. See [The WireGuard interface is down](./troubleshooting#interface-down).

## Host

Shows the state of the server side: the WireGuard interface (name, port, public key, number of clients), the helper (version, protocol, backend and the address it was reached at) and the PiVPN scripts it runs, with a SHA-256 hash of each. Warnings from the server appear here too.

## Settings

- **Appearance:** follow your device, light or dark.
- **Admin password:** change it by entering the current one and a new one. This signs out every other browser.
- **SSH connection:** shows the server address, port and account WG Manager uses. These can't be changed here; edit `.env` instead (see [Configuration reference](./configuration)).
- **Server identity:** the pinned fingerprint. Use **Confirm a new server identity…** only after you have deliberately replaced the server's SSH keys.
- **App key:** the app's public SSH key and the install command, used when you [update](./getting-started#update) the helper.

## Notices at the top

Two kinds of notice can appear above every page:

- **A change failed or may be incomplete.** It stays until you click **I've checked this**. See [Recovering from a failed change](./recovery).
- **Helper update available.** The helper on your server is older than the one this version of WG Manager comes with. Click **Show update command**, run the command on the server, then click **Check again**. The notice disappears once the helper is current.

## Page links

Each page has its own address, so you can bookmark it: `/clients`, `/host` and `/settings`. A client's panel has one too: `/clients/<name>`. Your browser's Back and Forward buttons work as expected.
