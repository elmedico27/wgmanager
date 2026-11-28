---
title: Configuration reference
---

# Configuration reference

All settings live in the `.env` file next to `compose.yaml`, and all are optional. A setting that is missing, empty or commented out uses the default in the table below.

To change a setting:

1. Edit `.env`.
2. In the same folder, run `docker compose up -d` to apply it.

The **Settings** page in the app shows the SSH values in use but can't change them.

## Settings

| Setting | Default | What it does | Change it when |
|---|---|---|---|
| `WEB_PORT` | `7501` | The port you type in your browser to open WG Manager. | Another program already uses 7501. |
| `WEB_BIND` | `0.0.0.0` | Which of the server's network addresses the web page is available on. `0.0.0.0` means all of them. A single address such as `192.168.1.10` limits it to that one. `127.0.0.1` allows only the server itself. | You want to restrict who can reach the page, for example behind a reverse proxy. |
| `SSH_HOST` | `172.29.88.1` | The address WG Manager uses to reach your server's SSH service. The default is the server itself, as seen from inside the container. | You changed the app's network. See [The app's network clashes](./troubleshooting#network-clash). |
| `SSH_PORT` | `22` | The port your server's SSH service listens on. | Your SSH port isn't 22. |
| `SSH_USER` | `wgweb` | The account the installer creates for WG Manager. | Almost never. |
| `TRUST_PROXY` | `0` | Set to `1` only if an HTTPS reverse proxy sits in front of WG Manager. It then marks sign-in cookies as secure and trusts the proxy's `X-Forwarded-*` headers. | You put WG Manager behind a reverse proxy that serves HTTPS. |
| `UPDATE_CHECK` | `0` | `1` or `true` makes WG Manager ask GitHub for the latest release when it starts and every 12 hours, and show a notice on the **Host** page (and a dot on the Host button) when a newer one exists. `0` or `false` (the default) means the container never contacts GitHub. Only release images check; `edge` and locally built images never do. See [Update check](./security#update-check). | You want to be told when a new release is out. |
| `NTFY_ENABLE` | `false` | `true` (or `1`) turns on [notifications to a ntfy server](#ntfy). `false` (or `0`) means WG Manager sends nothing to ntfy. | You want to be notified about failed changes or new releases. |
| `NTFY_URL` | none | The full address of your ntfy server, with `https://` or `http://`, for example `https://ntfy.example.com` or `http://192.168.1.10:2586`. `https://` is checked and encrypted; with `http://` the messages and the token travel unencrypted and a warning is logged at start. No user name or password in the address. Required when `NTFY_ENABLE` is `true`. | Notifications are on. |
| `NTFY_TOPIC` | none | The ntfy topic to send to: letters, digits, `_` and `-`, up to 64 characters. Required when `NTFY_ENABLE` is `true`. | Notifications are on. |
| `NTFY_TOKEN` | none | An access token for a ntfy user that may publish to the topic. Recommended over a password. Don't set it together with `NTFY_USER`. | Your ntfy requires sign-in. |
| `NTFY_USER`, `NTFY_PASSWORD` | none | A ntfy user name and password, set together, as an alternative to a token. | Your ntfy requires sign-in and you don't use tokens. |
| `NTFY_ON_ERRORS` | `true` | `true` sends a notification when a change fails or may be incomplete (at most 5 an hour) or when the VPN server can't be reached or is set up wrongly. WG Manager checks the server about once a minute for this and tells you once per problem, and again when it is fixed. `false` turns these off. | You want only update notices. |
| `NTFY_ON_UPDATES` | `true` | `true` sends a notification when a newer WG Manager release exists (needs `UPDATE_CHECK=1`) or when the helper on your server is older than the one this image ships, once per release. `false` turns it off. | You want only error notices. |
| `WGM_VERSION` | `latest` | Which version of the app to run: `latest` (the newest release), `edge` (the newest commit, less tested) or a fixed version such as `0.1.0`. | You want to stay on a specific version. |

## Common changes

### Run behind a reverse proxy {#reverse-proxy}

1. In `.env`, set `TRUST_PROXY=1`.
2. If the proxy runs on this server, also set `WEB_BIND=127.0.0.1`, so the page can be reached only through the proxy.
3. Run `docker compose up -d`.

Without a proxy, plain HTTP on your own network works too.

### Send notifications to ntfy {#ntfy}

1. On your ntfy server, create a user for WG Manager that can only publish to your topic, and an access token for it. With ntfy's command line, run these in its container (see the [ntfy documentation](https://docs.ntfy.sh/)); the last command prints the token once, so save it:

   ```sh
   ntfy user add wgmanager
   ntfy access wgmanager <topic> write-only
   ntfy token add --label=wgmanager wgmanager
   ```

2. In `.env`, set `NTFY_ENABLE`, `NTFY_URL`, `NTFY_TOPIC` and `NTFY_TOKEN`. The commented-out examples are in `.env.example`. If you installed before 0.3.3, also download the current `compose.yaml` (see [Update](./getting-started#update)); the older one doesn't pass these settings to the container.
3. Run `docker compose up -d`.
4. Send a test message:

   ```sh
   docker exec wgmanager wgmanager ntfy-test
   ```

   It prints `Sent.` and the notification arrives in your ntfy app. If it doesn't, the output says why.

Good to know:

- Messages are generic, for example "a change to a client may be incomplete" or "version 0.4.0 is available". They never contain client names, keys or addresses. Open WG Manager for the details.
- A failed change sends at most 5 notifications an hour. Each new release is announced once.
- Update notices need `UPDATE_CHECK=1`.
- If ntfy can't be reached, WG Manager carries on normally and logs the problem once. `docker logs wgmanager` shows at start whether notifications are on and which kinds.
- See [Notifications](./security#notifications) for what is sent and where.

### Pull the image from Docker Hub

Images are published to both GitHub Container Registry (`ghcr.io/elmedico27/wgmanager`, the default in `compose.yaml`) and [Docker Hub](https://hub.docker.com/r/elmedico27/wgmanager) (`elmedico27/wgmanager`), with identical tags.

1. In `compose.yaml`, change the `image:` line to:

   ```yaml
   image: elmedico27/wgmanager:${WGM_VERSION:-latest}
   ```

2. Run `docker compose pull && docker compose up -d`.
