import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  language: 'english',
  buildIndex(page) {
    return {
      id: page.url,
      url: page.url,
      title: page.data.title ?? '',
      description: page.data.description,
      structuredData: page.data.structuredData,
      // the first slug is the audience section, used by the search tag filter
      tag: page.slugs[0],
    };
  },
});
