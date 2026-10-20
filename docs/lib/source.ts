import { llms, loader } from 'fumadocs-core/source';
import { docs } from './collections';
import { openapi } from './openapi';
import { docsRoute } from './shared';

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({
      baseDir: 'developers/reference/api',
      per: 'operation',
      groupBy: 'tag',
      // short stable slugs like get-assets-id instead of the full path
      name(output) {
        if (output.type !== 'operation') return output.item.name;
        const parts = output.item.path
          .replace(/^\/(api\/)?v1\//, '/')
          .split('/')
          .filter(Boolean)
          .map((part) =>
            part
              .replace(/[{}]/g, '')
              .replace(/[^a-zA-Z0-9]+/g, '-')
              .toLowerCase(),
          );
        return [output.item.method, ...parts].join('-');
      },
      meta: { folderStyle: 'folder' },
    }),
  },
  {
    baseUrl: docsRoute,
    plugins: [openapi.loaderPlugin()],
  },
);

export type DocsPage = (typeof source)['$inferPage'];

// api pages carry no markdown, so give agents the operation straight from the spec
function renderOperations(page: DocsPage & { type: 'openapi' }): string {
  const { bundled } = page.data.getSchema();
  const { operations = [] } = page.data.getOpenAPIPageProps();
  return operations
    .map(({ path, method }) => {
      const operation = bundled.paths?.[path]?.[method];
      return `## ${method.toUpperCase()} ${path}

\`\`\`json
${JSON.stringify(operation, null, 2)}
\`\`\``;
    })
    .join('\n\n');
}

export const docsLlms = llms(source, {
  renderPage: async (page) => {
    const body =
      page.type === 'openapi'
        ? `${page.data.description ?? ''}\n\nFull spec: /openapi.json\n\n${renderOperations(page)}`
        : await page.data.getText('processed');
    return `# ${page.data.title} (${page.url})

${body}`;
  },
});
