---
title: Configuration reference
---

# Configuration reference

Settings live in the `.env` file next to `compose.yaml`. All are optional. After changing one, run `docker compose up -d` in that folder to apply it. (The **Settings** page in the app shows the SSH values in use but can't change them.)

| Setting | Default | What it does | Change it when |
|---|---|---|---|
| `WEB_PORT` | `7501` | The port you type in your browser to open WG Manager. | Another program already uses 7501. |
| `WEB_BIND` | `0.0.0.0` | Which of the server's network addresses the web page is available on. `0.0.0.0` means all of them. A single address such as `192.168.1.10` limits it to that one; `127.0.0.1` allows only the server itself. | You want to restrict who can reach the page, for example behind a reverse proxy. |
| `SSH_HOST` | `172.29.88.1` | The address WG Manager uses to reach your server's SSH service. The default is the server itself, as seen from inside the container. | You changed the app's network (see [clash](./troubleshooting#network-clash)). |
| `SSH_PORT` | `22` | The port your server's SSH service listens on. | Your SSH port isn't 22. |
| `SSH_USER` | `wgweb` | The account the installer creates for WG Manager. | Almost never. |
| `TRUST_PROXY` | `0` | Set to `1` only if an HTTPS reverse proxy sits in front of WG Manager. It then marks sign-in cookies as secure and trusts the proxy's `X-Forwarded-*` headers. | You put WG Manager behind a reverse proxy that serves HTTPS. |
| `WGM_VERSION` | `latest` | Which version of the app to run: `latest` (the newest release), `edge` (the newest, less tested, commit) or a fixed version such as `0.1.0`. | You want to stay on a specific version. |

**Where the image comes from:** each release is published to two registries with identical tags: GitHub Container Registry (`ghcr.io/elmedico27/wgmanager`, the default in `compose.yaml`) and [Docker Hub](https://hub.docker.com/r/elmedico27/wgmanager) (`elmedico27/wgmanager`). To pull from Docker Hub instead, change the `image:` line in `compose.yaml` to `elmedico27/wgmanager:${WGM_VERSION:-latest}`.

**Behind a reverse proxy:** set `TRUST_PROXY=1`, and consider `WEB_BIND=127.0.0.1` so the page can be reached only through the proxy. Plain HTTP on your own network works too.
