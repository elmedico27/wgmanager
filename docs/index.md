---
layout: home

hero:
  name: WG Manager
  text: A web UI for your PiVPN WireGuard server
  tagline: Add, enable, disable and delete clients, show QR codes and download configs from your browser.
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
  - title: The web app
    details: Runs in Docker. It is the page you open in your browser, and it never touches WireGuard itself.
  - title: A small helper
    details: One root-owned Python file on your server. It runs PiVPN's own tools and checks every change really happened.
  - title: A locked-down SSH key
    details: Connects the two. It can start the helper and nothing else.
---
