import { useMemo, useState } from 'react';
import { useReadyVideos } from '@/components/developers/use-ready-videos';
import { VideoPicker } from '@/components/developers/VideoPicker';
import { PageContainer, PageHeader, SectionHeader } from '@/components/layout/PageContainer';
import { CodeBlock, type CodeSample } from '@/components/shared/CodeBlock';
import { ScrollFade } from '@/components/shared/ScrollFade';
import { CopyField } from '@/components/shared/CopyField';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isReplaced, useApiKeys } from '@/hooks/useApiKeys';
import { embedSamples, needsSigning } from '@/lib/embed';
import { plural } from '@/lib/formatters';
import { buildSnippets, VIDEO_ID_PLACEHOLDER } from '@/lib/snippets';
import { KeyNote } from './KeyNote';
import {
  KeysCountLoading,
  KeysRow,
  ReferenceLinks,
  ServerRow,
  TryExplorerLink,
} from './quickstart-parts';
import { PAGE_HEADS } from '@/components/layout/page-heads';

interface Tab {
  id: string;
  title: string;
  description: string;
  scopeNote?: string;
  samples: CodeSample[];
}

function KeysSummary() {
  const keys = useApiKeys();
  const rows = keys.data?.data;
  const active = rows?.filter((k) => !isReplaced(k)).length;
  return (
    <KeysRow
      count={
        active === undefined ? (
          keys.isError ? (
            <span className="inline-flex flex-wrap items-center gap-x-2 text-muted-foreground">
              Could not load your API keys.
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => void keys.refetch()}
                disabled={keys.isFetching}
              >
                {keys.isFetching ? 'Trying again…' : 'Try again'}
              </Button>
            </span>
          ) : (
            <KeysCountLoading />
          )
        ) : active === 0 ? (
          'No active keys yet'
        ) : (
          `${plural(active, 'active key')}`
        )
      }
    />
  );
}

export default function QuickstartPage() {
  const origin = window.location.origin;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const ready = useReadyVideos(pickedId);
  const video = ready.selected ?? null;
  const videoId = video?.id ?? VIDEO_ID_PLACEHOLDER;

  const tabs = useMemo<Tab[]>(() => {
    const snippets = buildSnippets(origin, videoId).map((s): Tab => ({
      id: s.id,
      title: s.title,
      description: s.description,
      scopeNote: s.scopeNote,
      samples: [
        { label: 'JavaScript', language: s.js.lang, code: s.js.code },
        { label: 'curl', language: 'bash', code: s.curl },
      ],
    }));
    const embedFor = video ?? { id: VIDEO_ID_PLACEHOLDER, accessTier: 'public' as const };
    const play: Tab = {
      id: 'play',
      title: 'Play',
      description: needsSigning(embedFor)
        ? 'This video is private: your server signs a short-lived URL and the player plays it. The same code is on the video’s Share tab.'
        : 'Play this video on your site. A public video needs no key. The same code is on the video’s Share tab.',
      samples: embedSamples(embedFor, { baseUrl: origin }).map((c) => ({
        label: c.label,
        language: c.language,
        code: c.code,
      })),
    };
    const at = snippets.findIndex((s) => s.id === 'library') + 1;
    return [...snippets.slice(0, at), play, ...snippets.slice(at)];
  }, [origin, videoId, video]);

  const [active, setActive] = useState('setup');
  // the language stays picked from one snippet to the next
  const [language, setLanguage] = useState('JavaScript');

  return (
    <PageContainer>
      <PageHeader {...PAGE_HEADS.quickstart} />

      <Card>
        <CardContent>
          <h2 className="sr-only">Your server</h2>
          <dl className="divide-y">
            <ServerRow label="API base URL">
              <CopyField label="API base URL" value={origin} className="w-full max-w-md" />
            </ServerRow>
            <ServerRow label="API keys">
              <KeysSummary />
            </ServerRow>
            <ServerRow label="Reference">
              <ReferenceLinks />
            </ServerRow>
          </dl>
        </CardContent>
      </Card>

      <SectionHeader title="Code" description="Snippets for this server, ready to copy" />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <Tabs value={active} onValueChange={setActive} className="min-w-0 gap-4">
            {/* nine tasks do not fit a phone; the list scrolls sideways instead */}
            <ScrollFade>
              <div className="-mx-1 overflow-x-auto px-1 pb-1">
                <TabsList
                  aria-label="Snippets"
                  // a tab half outside the strip scrolls into view when it takes focus
                  onFocus={(e) =>
                    e.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
                  }
                >
                  {tabs.map((t) => (
                    <TabsTrigger key={t.id} value={t.id} className="flex-none px-2.5">
                      {t.title}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </ScrollFade>
            <div className="flex flex-col gap-2">
              <VideoPicker
                videos={ready.videos}
                selected={ready.selected}
                error={ready.list.error}
                onRetry={() => ready.list.refetch()}
                retrying={ready.list.isFetching}
                onChange={setPickedId}
              />
              <KeyNote />
            </div>
            {tabs.map((t) => (
              <TabsContent key={t.id} value={t.id} className="flex min-w-0 flex-col gap-3">
                <p className="text-sm text-muted-foreground">{t.description}</p>
                <CodeBlock
                  label={`${t.title} snippet`}
                  samples={t.samples}
                  value={language}
                  onValueChange={setLanguage}
                  tabsLabel="Snippet language"
                  preClassName="max-h-[28rem]"
                />
                {t.scopeNote && <p className="text-xs text-muted-foreground">{t.scopeNote}</p>}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <TryExplorerLink />
    </PageContainer>
  );
}
