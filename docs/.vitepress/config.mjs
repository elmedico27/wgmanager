import { defineConfig } from 'vitepress'

const repo = 'https://github.com/elmedico27/wgmanager'

export default defineConfig({
  title: 'WG Manager',
  description: 'A web page for managing the clients of a PiVPN WireGuard server.',
  lang: 'en-US',
  // Served as a GitHub Pages project site: https://elmedico27.github.io/wgmanager/
  base: '/wgmanager/',
  cleanUrls: true,
  lastUpdated: false,
  // Old flat files; they move into the page tree in the content step.
  srcExclude: ['HELPER-SPEC.md', 'RECOVERY.md'],
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/wgmanager/favicon.svg' }]],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/helper-protocol' },
      { text: 'Development', link: '/development/' },
      { text: 'Demo', link: 'https://wgmanager-demo.pages.dev' }
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Using WG Manager', link: '/guide/using' },
          { text: 'Configuration', link: '/guide/configuration' }
        ]
      },
      {
        text: 'When something goes wrong',
        items: [
          { text: 'Troubleshooting', link: '/guide/troubleshooting' },
          { text: 'Recovering from a failed change', link: '/guide/recovery' }
        ]
      },
      {
        text: 'How it works',
        items: [
          { text: 'Architecture', link: '/guide/how-it-works' },
          { text: 'Security', link: '/guide/security' }
        ]
      },
      {
        text: 'Reference',
        items: [{ text: 'Helper protocol', link: '/reference/helper-protocol' }]
      },
      {
        text: 'Development',
        items: [
          { text: 'Overview', link: '/development/' },
          { text: 'Web UI', link: '/development/web' },
          { text: 'Backend', link: '/development/server' },
          { text: 'Host tools', link: '/development/host' }
        ]
      }
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    editLink: { pattern: `${repo}/edit/master/docs/:path`, text: 'Edit this page on GitHub' },
    footer: { message: 'Released under the GPL-3.0 license.' }
  }
})
