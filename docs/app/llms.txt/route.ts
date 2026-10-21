import { docsLlms } from '@/lib/source';

export const revalidate = false;

export async function GET() {
  // fumadocs titles the index "Docs", name the site instead
  const index = (await docsLlms.index()).replace(
    /^# Docs\n/,
    '# Sluby documentation\n\n> Sluby is a self-hosted video platform that stores its media on the Sia network. Full text of every page: /llms-full.txt\n',
  );
  return new Response(index);
}
