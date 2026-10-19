import { defineConfig } from 'vitepress';

const repo = 'https://github.com/justmert/Sluby';

export default defineConfig({
  title: 'Sluby',
  description: 'Self-hosted video platform that stores everything on Sia',
  cleanUrls: true,
  // the guides link to the local stack, which the build cannot reach
  ignoreDeadLinks: 'localhostLinks',
  lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],
  markdown: {
    config(md) {
      // ```mermaid fences render as diagrams in the browser instead of code
      const fence = md.renderer.rules.fence!;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.info.trim() === 'mermaid') {
          return `<Mermaid code="${encodeURIComponent(token.content)}" />`;
        }
        return fence(tokens, idx, options, env, self);
      };
    },
  },
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Guide', link: '/guide/quickstart' },
      { text: 'API', link: '/api/' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'GitHub', link: repo },
    ],
    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Quickstart', link: '/guide/quickstart' },
          { text: 'Production deployment', link: '/guide/production' },
          { text: 'Configuration', link: '/guide/configuration' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'React', link: '/guide/react' },
          { text: 'Plain JavaScript', link: '/guide/javascript' },
          { text: 'Share and embed', link: '/guide/share' },
        ],
      },
      {
        text: 'API',
        items: [
          { text: 'Overview', link: '/api/' },
          { text: 'Reference', link: '/api/reference' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Overview', link: '/architecture/' },
          { text: 'Upload pipeline', link: '/architecture/upload-pipeline' },
          { text: 'Playback', link: '/architecture/playback' },
          {
            text: 'Deletion and reconciliation',
            link: '/architecture/deletion-and-reconciliation',
          },
          { text: 'Data model', link: '/architecture/data-model' },
          { text: 'Accounts and roles', link: '/architecture/auth-and-tenancy' },
          { text: 'SDK integration patterns', link: '/architecture/sdk-patterns' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path` },
    search: { provider: 'local' },
    footer: { message: 'Released under the Apache 2.0 license.' },
  },
});
