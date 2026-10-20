import { applyMdxPreset } from 'fumadocs-mdx/config';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
    // applyMdxPreset keeps the default plugins (headings, search structure, code highlighting)
    mdxOptions: applyMdxPreset({
      remarkPlugins: [remarkMdxMermaid],
    }),
  },
  meta: {
    schema: metaSchema,
  },
});
