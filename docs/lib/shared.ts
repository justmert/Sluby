import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'Sluby';
export const docsRoute = '/';
export const docsContentRoute = '/llms.mdx';

export const gitConfig = {
  user: 'justmert',
  repo: 'Sluby',
  branch: 'main',
};

export const repoUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

const getContentUrl = createGetUrl(docsContentRoute);

// every page gets a plain markdown twin for agents, served from /llms.mdx/<slug>/content.md
export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}
