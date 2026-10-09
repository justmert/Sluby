import { Link, useParams } from 'react-router';
import { PageContainer, PageHeader, SectionHeader } from '@/components/layout/PageContainer';
import { DescriptionItem, DescriptionList } from '@/components/shared/DescriptionList';
import { PageState } from '@/components/shared/PageState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useWebhooks, webhookLabel } from '@/hooks/useWebhooks';
import { ROUTES } from '@/lib/constants';
import { formatDate } from '@/lib/formatters';
import { Deliveries } from '@/pages/studio/DeveloperPage';

const backToWebhooks = (
  <Button variant="outline" asChild>
    <Link to={ROUTES.WEBHOOKS}>Back to webhooks</Link>
  </Button>
);

export default function WebhookDetailPage() {
  const { id = '' } = useParams();
  const hooks = useWebhooks();

  if (hooks.isError) {
    return (
      <PageState
        title="Could not load this webhook"
        error={hooks.error}
        onRetry={() => void hooks.refetch()}
        retrying={hooks.isFetching}
        actions={backToWebhooks}
      />
    );
  }
  if (!hooks.data) {
    return (
      <PageContainer>
        <h1 className="sr-only">Loading webhook</h1>
        <Skeleton className="mb-6 h-8 w-72 max-w-full" />
        <Skeleton className="h-40 rounded-xl" />
      </PageContainer>
    );
  }

  const hook = hooks.data.data.find((w) => w.id === id);
  if (!hook) {
    return (
      <PageState
        title="Webhook not found"
        description="It may have been deleted."
        actions={backToWebhooks}
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={webhookLabel(hook.url)}
        meta={
          <>
            <StatusBadge kind="webhook" status={hook.is_active ? 'active' : 'inactive'} />
            <span>Added {formatDate(hook.created_at)}</span>
          </>
        }
      />
      <Card>
        <CardContent>
          <DescriptionList>
            <DescriptionItem label="Endpoint URL" mono copy={hook.url}>
              {hook.url}
            </DescriptionItem>
            <DescriptionItem label="Events">
              <span className="flex flex-wrap gap-1">
                {hook.events.map((e) => (
                  <Badge key={e} variant="code">
                    {e}
                  </Badge>
                ))}
              </span>
            </DescriptionItem>
          </DescriptionList>
        </CardContent>
      </Card>
      <SectionHeader title="Deliveries" />
      <Card>
        <CardContent>
          <Deliveries id={hook.id} freshAfter={null} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
