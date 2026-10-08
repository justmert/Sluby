import { Link } from 'react-router';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageState } from '@/components/layout/PageState';

export default function NotFoundPage() {
  return (
    <PageState
      icon={FileQuestion}
      title="Page not found"
      description="The page you are looking for does not exist or has been moved."
      actions={
        <Button asChild>
          <Link to="/studio">Back to dashboard</Link>
        </Button>
      }
    />
  );
}
