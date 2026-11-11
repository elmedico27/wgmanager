---
layout: home

hero:
  name: WG Manager
  text: A web UI for your PiVPN WireGuard server
  tagline: Add, enable, disable, and delete clients, show QR codes and download configs from your browser.
  image:
    light: /screenshot-light.png
    dark: /screenshot-dark.png
    alt: WG Manager's client list (sample data)
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Try the demo
      link: https://wgmdemo.pages.dev
    - theme: alt
      text: View on GitHub
      link: https://github.com/elmedico27/wgmanager

features:
  - title: 🔧 Manage WireGuard clients
    details: Add, delete, enable, and disable clients without opening a terminal.
    link: /guide/web-interface
    linkText: Web interface guide
  - title: 📲 Connect devices
    details: Show a client's QR code to scan with the WireGuard app, or download its config file.
    link: /guide/web-interface#add-a-client
    linkText: Add a client
  - title: 🔒 Security focused
    details: A small helper on your server accepts seven fixed requests from the app, and nothing else.
    link: /guide/security
    linkText: Security
---
