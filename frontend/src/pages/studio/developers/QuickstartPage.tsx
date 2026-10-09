import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ExternalLink, Plus } from 'lucide-react';
import { useReadyVideos } from '@/components/developers/use-ready-videos';
import { VideoPicker } from '@/components/developers/VideoPicker';
import { PageContainer, PageHeader, SectionHeader } from '@/components/layout/PageContainer';
import { CodeBlock, type CodeSample } from '@/components/shared/CodeBlock';
import { CopyField } from '@/components/shared/CopyField';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isReplaced, useApiKeys } from '@/hooks/useApiKeys';
import { ROUTES } from '@/lib/constants';
import { embedSamples, needsSigning } from '@/lib/embed';
import { plural } from '@/lib/formatters';
import { preloadPage } from '@/lib/page-chunks';
import { buildSnippets, VIDEO_ID_PLACEHOLDER } from '@/lib/snippets';

interface Tab {
  id: string;
  title: string;
  description: string;
  scopeNote?: string;
  samples: CodeSample[];
}

const LINKS = [
  { label: 'API reference', href: '/api/v1/docs' },
  { label: 'SDK on npm', href: 'https://www.npmjs.com/package/@sluby/sdk' },
  { label: 'Source on GitHub', href: 'https://github.com/justmert/Sluby' },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 py-3 first:pt-0 last:pb-0 @2xl/page:grid-cols-[10rem_1fr] @2xl/page:items-center @2xl/page:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
}

function KeysSummary() {
  const keys = useApiKeys();
  const rows = keys.data?.data;
  const active = rows?.filter((k) => !isReplaced(k)).length;
  return (
    <>
      <span className="mr-auto text-sm">
        {active === undefined ? (
          keys.isError ? (
            <span className="text-muted-foreground">Could not load your API keys</span>
          ) : (
            <Skeleton className="inline-block h-4 w-24 align-middle" />
          )
        ) : active === 0 ? (
          'No active keys yet'
        ) : (
          `${plural(active, 'active key')}`
        )}
      </span>
      <Button variant="outline" size="sm" asChild>
        <Link to={ROUTES.API_KEYS} onPointerEnter={() => preloadPage(ROUTES.API_KEYS)}>
          Manage keys
        </Link>
      </Button>
      <Button size="sm" asChild>
        <Link
          to={`${ROUTES.API_KEYS}?create=key`}
          onPointerEnter={() => preloadPage(ROUTES.API_KEYS)}
        >
          <Plus />
          Create key
        </Link>
      </Button>
    </>
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
      <PageHeader title="Quickstart" description="Connect your app to this server" />

      <Card>
        <CardContent>
          <h2 className="sr-only">Your server</h2>
          <dl className="divide-y">
            <Row label="API base URL">
              <CopyField label="API base URL" value={origin} className="w-full max-w-md" />
            </Row>
            <Row label="API keys">
              <KeysSummary />
            </Row>
            <Row label="Reference">
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {LINKS.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-sm font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {l.label}
                      <ExternalLink aria-hidden="true" className="size-3.5 text-muted-foreground" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Row>
          </dl>
        </CardContent>
      </Card>

      <SectionHeader title="Code" description="Snippets for this server, ready to copy" />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <Tabs value={active} onValueChange={setActive} className="min-w-0 gap-4">
            {/* nine tasks do not fit a phone; the list scrolls sideways instead */}
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <TabsList aria-label="Snippets">
                {tabs.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="flex-none px-2.5">
                    {t.title}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="flex flex-col gap-2">
              <VideoPicker
                videos={ready.videos}
                selected={ready.selected}
                error={ready.list.error}
                onChange={setPickedId}
              />
              <p className="text-xs text-muted-foreground">
                Create an API key on the{' '}
                <Link to={ROUTES.API_KEYS} className="underline underline-offset-4">
                  API keys page
                </Link>{' '}
                and set it as <code className="font-mono">SLUBY_API_KEY</code> on your server. Never
                put a key in browser code. A video is called an asset in the API.
              </p>
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

      <div className="mt-6">
        <Button variant="outline" asChild>
          <Link to={ROUTES.EXPLORER} onPointerEnter={() => preloadPage(ROUTES.EXPLORER)}>
            Try a request in the API explorer
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </PageContainer>
  );
}
