import { useMemo, useState } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { SnippetBlock } from '@/components/developers/SnippetBlock';
import { useReadyVideos } from '@/components/developers/use-ready-videos';
import { VideoPicker } from '@/components/developers/VideoPicker';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { isReplaced, useApiKeys } from '@/hooks/useApiKeys';
import { embedCode, needsSigning } from '@/lib/embed';
import { plural } from '@/lib/formatters';
import type { CodeLanguage } from '@/lib/highlight';
import { buildSnippets, RECEIVE_WEBHOOKS, VIDEO_ID_PLACEHOLDER } from '@/lib/snippets';
import { ApiStep, KeysCountLoading, QuickstartFrame, StepCard, TryStep } from './quickstart-parts';
import { stepHeadingId } from './quickstart-copy';

interface Snippet {
  id: string;
  title: string;
  description: string;
  filename: string;
  language: CodeLanguage;
  code: string;
}

function KeysCount() {
  const keys = useApiKeys();
  const rows = keys.data?.data;
  const active = rows?.filter((k) => !isReplaced(k)).length;
  if (active !== undefined)
    return active === 0 ? 'No active keys yet' : plural(active, 'active key');
  if (!keys.isError) return <KeysCountLoading />;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-muted-foreground">
      Could not load your API keys.
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-sm"
        onClick={() => void keys.refetch()}
        disabled={keys.isFetching}
      >
        {keys.isFetching ? 'Trying again…' : 'Try again'}
      </Button>
    </span>
  );
}

// the snippet tabs: a track of pills, the selected one raised on the card
// surface. radix gives the arrow keys, roving focus and the tab panels
const SEGMENT =
  'h-7.5 rounded-[7px] px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow,scale] duration-150 ease-design outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:active:scale-[0.97] data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs pointer-coarse:h-9';

export default function QuickstartPage() {
  const origin = window.location.origin;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const ready = useReadyVideos(pickedId);
  const video = ready.selected ?? null;
  const videoId = video?.id ?? VIDEO_ID_PLACEHOLDER;

  const snippets = useMemo<Snippet[]>(() => {
    const server = buildSnippets(origin, videoId);
    const upload = server.find((s) => s.id === 'upload')!;
    const setup = server.find((s) => s.id === 'setup')!;
    const embedFor = video ?? { id: VIDEO_ID_PLACEHOLDER, accessTier: 'public' as const };
    const react = embedCode(embedFor, { kind: 'react', baseUrl: origin });
    return [
      {
        id: 'react',
        title: 'Play in React',
        description: needsSigning(embedFor)
          ? 'This video is private, so the player asks your server for a signed URL first. The server code that signs it is on the video’s Share tab.'
          : 'Drop the player into any React page. Public videos need no key.',
        filename: 'App.tsx',
        language: react.language as CodeLanguage,
        code: react.code,
      },
      {
        id: 'upload',
        title: 'Upload from Node',
        description: upload.description,
        filename: 'upload.ts',
        language: upload.js.lang,
        code: upload.js.code,
      },
      {
        id: 'webhook',
        title: 'Verify a webhook',
        description:
          'Check every request’s signature before you trust it. Checking needs only the webhook’s signing secret, no API key.',
        filename: 'webhook.ts',
        language: 'ts',
        code: RECEIVE_WEBHOOKS,
      },
      {
        id: 'curl',
        title: 'curl',
        description:
          'List your videos from a terminal, to check a key works. Set SLUBY_API_KEY to a key from the API keys page first.',
        filename: 'request.sh',
        language: 'bash',
        code: setup.curl,
      },
    ];
  }, [origin, videoId, video]);

  const [active, setActive] = useState('react');

  return (
    <PageContainer>
      <QuickstartFrame>
        <StepCard n={1} bodyClassName="gap-2.5">
          <VideoPicker
            videos={ready.videos}
            selected={ready.selected}
            error={ready.list.error}
            onRetry={() => ready.list.refetch()}
            retrying={ready.list.isFetching}
            onChange={setPickedId}
            labelledBy={stepHeadingId(1)}
          />
        </StepCard>

        <ApiStep count={<KeysCount />} />

        <StepCard n={3}>
          <TabsPrimitive.Root
            value={active}
            onValueChange={setActive}
            className="flex min-w-0 flex-col gap-3"
          >
            {/* four tasks fit a phone only if the strip may scroll sideways */}
            <div className="-m-1 overflow-x-auto p-1">
              <TabsPrimitive.List
                aria-label="Snippets"
                className="inline-flex rounded-[9px] bg-sunken p-[3px]"
              >
                {snippets.map((s) => (
                  <TabsPrimitive.Trigger key={s.id} value={s.id} className={SEGMENT}>
                    {s.title}
                  </TabsPrimitive.Trigger>
                ))}
              </TabsPrimitive.List>
            </div>
            {snippets.map((s) => (
              <TabsPrimitive.Content
                key={s.id}
                value={s.id}
                className="flex min-w-0 flex-col gap-3 rounded-sm"
              >
                <p className="text-muted-foreground">{s.description}</p>
                <SnippetBlock
                  filename={s.filename}
                  code={s.code}
                  language={s.language}
                  label={`${s.title} snippet`}
                />
              </TabsPrimitive.Content>
            ))}
          </TabsPrimitive.Root>
        </StepCard>

        <TryStep />
      </QuickstartFrame>
    </PageContainer>
  );
}
