# Security policy

## Supported versions

Only the latest release gets security fixes. A fix ships as a new release; update to it as described in the [README](README.md#update).

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately instead:

1. Open this repository's **Security** tab.
2. Click **Report a vulnerability** and fill in the form.

Helpful details:

- the WG Manager version (the image tag you run) and the helper version (shown on the **Host** page)
- what an attacker could do, and what they need first (access to your network, the admin password, a shell on the server, and so on)
- steps to reproduce

WG Manager is maintained by one person in their spare time. I aim to acknowledge reports within a week and to fix confirmed problems as soon as practical. You'll be credited in the advisory and the [changelog](CHANGELOG.md) unless you'd rather not be.

## Scope

In scope:

- the web app: sign-in, sessions, setup codes, cross-site request protection
- the SSH connection between the app and the server, and how the app's key and the server's identity are handled
- the helper and `wgmanager-host`, which run as root on your server; anything that lets the app's key do more than the [seven helper actions](https://elmedico27.github.io/wgmanager/reference/helper-protocol#_13-what-the-app-s-key-can-and-cannot-do) is especially important
- the published container image

Out of scope:

- problems in PiVPN, WireGuard, OpenSSH, Docker or other tools WG Manager uses; please report those to their own projects
- setups that expose WG Manager directly to the internet
- anything that already requires root on the server
- the [public demo](https://wgmdemo.pages.dev), which runs in your browser on sample data and has no backend

## How WG Manager is secured

The [Security](https://elmedico27.github.io/wgmanager/guide/security) and [How it works](https://elmedico27.github.io/wgmanager/guide/how-it-works) pages describe the design: what the container may do, how the admin password and sessions are protected, what the installer changes on the server, and what someone holding the app's SSH key can and cannot do.
