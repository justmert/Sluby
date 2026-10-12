import { Link } from 'react-router';
import { FileQuestion } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/constants';

// drawn like the empty and error states: a centred card with an icon tile,
// a title, one sentence and the way back
export default function NotFoundPage() {
  return (
    <PageContainer className="flex min-h-[60vh] max-w-160 items-center">
      <section
        aria-labelledby="not-found-title"
        className="flex w-full flex-col items-center gap-3 rounded-xl border bg-card px-7 py-10 text-center text-sm motion-safe:animate-enter"
      >
        <span className="grid size-14 place-items-center rounded-2xl border text-primary">
          <FileQuestion aria-hidden="true" className="size-6.5" strokeWidth={1.8} />
        </span>
        <h1 id="not-found-title" className="text-lg leading-7 font-bold">
          Page not found
        </h1>
        <p className="max-w-75 text-muted-foreground">This page does not exist.</p>
        <div className="mt-1.5 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to={ROUTES.OVERVIEW}>Back to overview</Link>
          </Button>
        </div>
      </section>
    </PageContainer>
  );
}
