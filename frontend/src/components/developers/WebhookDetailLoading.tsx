import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

const bar = (className: string) => <Skeleton className={cn(className, lateReveal)} />;

const CARD = 'flex flex-col gap-2.5 rounded-xl border bg-card px-5 py-4.5';

/**
 * A webhook's page while it loads, in the page's own boxes (WebhookDetailPage):
 * the url title row, the events and signing secret cards on the left and the
 * deliveries card on the right. The page and its route skeleton both draw it.
 */
export function WebhookDetailLoading() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        {bar('h-6 w-80 max-w-full')}
        {bar('h-5.5 w-16 rounded-full')}
        <div className="ml-auto flex gap-2">
          {bar('h-9 w-24')}
          {bar('h-9 w-20')}
          {bar('h-9 w-20')}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-4">
          <div className={CARD}>
            <h2 className="font-heading text-heading">Events</h2>
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-2.5 py-0.5">
                {bar('h-4 w-24')}
                {bar('h-4 w-40')}
              </div>
            ))}
          </div>
          <div className={CARD}>
            <h2 className="font-heading text-heading">Signing secret</h2>
            {bar('h-4 w-full')}
            {bar('h-9 w-32')}
          </div>
        </div>
        <div className="min-w-0 flex-[999_1_35rem] overflow-hidden rounded-xl border bg-card">
          <div className="px-5 py-4">
            <h2 className="font-heading text-heading">Deliveries</h2>
          </div>
          <div className="flex flex-col gap-2 px-5 pb-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className={cn('h-10', lateReveal)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
