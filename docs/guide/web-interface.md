---
title: Web interface
outline: deep
---

# Web interface

What each page does and how to use it.

The sidebar (a bar along the bottom on phones) has three pages: **Clients**, **Host** and **Settings**. At its bottom are a theme button (follow your device, light or dark) and **Sign out**.

## Clients

![The Clients page in card view (sample data)](/screenshot-light.png){.screenshot .only-light}
![The Clients page in card view (sample data)](/screenshot-dark.png){.screenshot .only-dark}

Lists your VPN clients as cards or as a list. Switch between them with the buttons at the top. The page refreshes every 15 seconds while the tab is visible.

### Add a client

1. Click **Add client**, enter a name and confirm.
2. The new client's QR code and config download appear straight away.
3. On a phone, scan the QR code with the WireGuard app. On a computer, download the config file.

**Client names:**

- Letters, digits, `_` and `-`, up to 15 characters.
- Not all digits, and not `server`.
- Unique. `Alice` and `alice` count as the same name.

Use one client per device, for example `Alice_Phone`.

### Open a client

Click a client. A panel slides in with:

- its QR code and config, each behind a click (they contain the client's private key)
- a download button
- its details (see [What the details mean](#what-the-details-mean))
- **Manage** buttons to disable, enable or delete it. Disabling and deleting ask you to confirm.

### Add a note

1. Open a client and type in the **Notes** box, up to 500 characters (spaces at the start and end don't count).
2. Click **Save**.

Good to know:

- The Notes box can be resized.
- **Save** is disabled for notes longer than 500 characters but text is not truncated (for instance, if pasting).
- A small note icon next to a client's name means it has a note. Point at it to read the note (on a phone, open the client).
- Notes are stored by WG Manager, not on the server. Deleting a client deletes its note. A client re-created under the same name does not restore the previous note.

### Search clients

1. Click the magnifying glass next to the refresh button and type.
2. The list shows only clients whose name, address or note contains your text (capitals don't matter).

Good to know:

- A dot on the magnifying glass shows the filter is on. It stays on when you close the search box, open clients, use Back and Forward, or visit Host and Settings.
- Reloading the page, signing out, or clicking **Clear** (if no results) clears the search.
- A direct link to a client always opens it, even one the filter hides.

### Sort clients

- **Card view:** click the arrows button next to the magnifying glass and pick a field under **Sort by**.
- **List view:** click a column heading.

Click the same field again to reverse. Your browser remembers your choice.

### What the details mean

| Item | Meaning |
|---|---|
| Status dot | **Green:** enabled and active on the server's WireGuard interface. **Red:** disabled. **Yellow:** something doesn't line up, for example enabled but not active. Open the client to see why; **Enable again** can fix it. |
| Connected now | The device completed a *handshake* (the brief exchange WireGuard uses to set up a secure link) in the last 3 minutes. An idle device sends nothing, so a connected but idle device can look disconnected. |
| Last handshake | When that exchange last happened. |
| Last seen from | The device's public internet address at its last handshake. It is not your server's address. |
| Downloaded / Uploaded | Data transferred, counted from the device's point of view, since the WireGuard interface last started. |
| Address | The client's address inside the VPN. |

### Greyed-out clients

A greyed-out client is shown with a reason. Either its name breaks the rules in [Add a client](#add-a-client), or its address is outside the VPN's range. Manage these clients with `pivpn` on the server.

You can still open a greyed-out client. The panel shows its details and its note (which you can edit), but no QR code or config, and its buttons are switched off.

### When the WireGuard interface is down

**Add client** and **Enable** are switched off. See [The WireGuard interface is down](./troubleshooting#interface-down).

## Host

![The Host page (sample data)](/screenshot-host-light.png){.screenshot .only-light}
![The Host page (sample data)](/screenshot-host-dark.png){.screenshot .only-dark}

Shows the state of the server side:

- **The WireGuard interface:** name, port, public key and number of clients.
- **The helper:** version, protocol, backend and the address it was reached at.
- **The PiVPN scripts it runs:** each with its SHA-256 hash.
- **Warnings from the server.**

## Settings

![The Settings page (sample data)](/screenshot-settings-light.png){.screenshot .only-light}
![The Settings page (sample data)](/screenshot-settings-dark.png){.screenshot .only-dark}

- **Appearance:** follow your device, light or dark.
- **Admin password:** enter the current password and a new one. This signs out every other browser. A password needs 12 to 128 characters. The 128 limit is counted in bytes: plain English letters, digits and symbols take one byte each; accented letters, other scripts and emoji take 2 to 4. A password that is too long is refused, never cut off.
- **SSH connection:** shows the server address, port and account WG Manager uses. To change them, edit `.env` (see [Configuration reference](./configuration)).
- **Server identity:** the pinned fingerprint. Use **Confirm a new server identity…** only after you have deliberately replaced the server's SSH keys.
- **App key:** the app's public SSH key and the install command, used when you [update](./getting-started#update) the helper.

## Notices

Two kinds of notice can appear above every page:

- **A change failed or may be incomplete.** It stays until you click **I've checked this**. See [Recovering from a failed change](./recovery).
- **Helper update available.** Click **Show update command**, run the command on the server, then click **Check again**. See [Update](./getting-started#update).

## App install

Add WG Manager to a phone's home screen, or to a computer's apps, so it opens in its own window without the browser's address bar. Menu wording differs between browsers and versions, but it is usually:

- **Android, Chrome:** the menu (three dots), then **Install app** or **Add to Home Screen**.
- **iPhone and iPad, Safari:** the Share button, then **Add to Home Screen**.
- **Chrome or Edge on a computer:** the install icon at the right end of the address bar, or the browser menu.

::: tip Use HTTPS for the full app
Browsers offer to install a site as an app only over HTTPS (or from `localhost`). Over a plain `http://` address on your own network you may only get a shortcut that opens in a normal browser tab. To get the full app, put WG Manager behind an HTTPS reverse proxy; see [Run behind a reverse proxy](./configuration#reverse-proxy).
:::

Good to know:

- The installed app still needs the server. There is no offline mode.
- The same sign-in rules apply, and the installed app may keep its own sign-in, so you might have to sign in again there.

## Page links

Each page has its own address, so you can bookmark it: `/clients`, `/host` and `/settings`. A client's panel has one too: `/clients/<name>`. Your browser's Back and Forward buttons work as expected.
