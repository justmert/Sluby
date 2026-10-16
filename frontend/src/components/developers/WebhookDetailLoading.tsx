import { DescriptionItem, DescriptionList } from '@/components/shared/DescriptionList';
import { PageHeader, SectionHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { OptionListLoading } from './OptionListLoading';
import { WEBHOOK_EVENTS } from './options';

/**
 * A webhook's page while it loads, in the page's own boxes: the header, the
 * endpoint card, the events and the deliveries. The page and its route
 * skeleton both draw it.
 */
export function WebhookDetailLoading() {
  return (
    <div aria-hidden="true">
      <PageHeader
        title="Loading webhook"
        heading={<Skeleton className={cn('h-8 w-72 max-w-full', lateReveal)} />}
        meta={
          <>
            <Skeleton className={cn('h-5 w-14 rounded-full', lateReveal)} />
            <Skeleton className={cn('h-3.5 w-56', lateReveal)} />
          </>
        }
        secondaryActions={
          <>
            <Skeleton className={cn('h-8 w-24', lateReveal)} />
            <Skeleton className={cn('h-8 w-20', lateReveal)} />
            <Skeleton className={cn('size-8', lateReveal)} />
          </>
        }
      />
      <Card>
        <CardContent>
          <DescriptionList>
            {['Endpoint URL', 'Webhook ID'].map((label) => (
              <DescriptionItem key={label} label={label}>
                <Skeleton className={cn('my-0.5 h-4 w-64 max-w-full', lateReveal)} />
              </DescriptionItem>
            ))}
          </DescriptionList>
        </CardContent>
      </Card>
      <SectionHeader title="Events" description="What this server sends to the endpoint" />
      <Card>
        {/* the events card as the page draws it (WebhookDetailPage), names and all */}
        <CardContent className="flex flex-col gap-4">
          <OptionListLoading
            options={WEBHOOK_EVENTS}
            barClassName={lateReveal}
            className="@3xl/page:grid-flow-col @3xl/page:grid-rows-3"
          />
        </CardContent>
      </Card>
      <SectionHeader title="Deliveries" description="The latest attempts, newest first" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn('h-10', lateReveal)} />
        ))}
      </div>
    </div>
  );
}
