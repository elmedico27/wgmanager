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
      { text: 'Technical details', link: '/guide/how-it-works' },
      { text: 'Contributing', link: '/development/' },
      { text: 'Demo', link: 'https://wgmanager-demo.pages.dev' }
    ],
    sidebar: [
      {
        text: 'Using WG Manager',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Web interface', link: '/guide/web-interface' },
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
        text: 'Technical details',
        items: [
          { text: 'How it works', link: '/guide/how-it-works' },
          { text: 'Security', link: '/guide/security' },
          { text: 'Helper protocol', link: '/reference/helper-protocol' }
        ]
      },
      {
        text: 'Development',
        items: [{ text: 'Contributing', link: '/development/' }]
      }
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    editLink: { pattern: `${repo}/edit/master/docs/:path`, text: 'Edit this page on GitHub' },
    footer: { message: 'Released under the GPL-3.0 license.' }
  }
})
