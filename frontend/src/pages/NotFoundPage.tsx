import { Link } from 'react-router';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageState } from '@/components/layout/PageState';
import { ROUTES } from '@/lib/constants';

export default function NotFoundPage() {
  return (
    <PageState
      icon={FileQuestion}
      title="Page not found"
      description="This page does not exist."
      actions={
        <Button asChild>
          <Link to={ROUTES.OVERVIEW}>Back to overview</Link>
        </Button>
      }
    />
  );
}
