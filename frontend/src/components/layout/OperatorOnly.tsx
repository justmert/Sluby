import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { PageState } from '@/components/shared/PageState';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/constants';
import { useSession } from '@/lib/session';

/**
 * The deployment pages, for operators only. The api refuses their data to
 * members, so a member who follows a link here is told why instead of being
 * moved somewhere else (plan D-03).
 */
export function OperatorOnly({ children }: { children: ReactNode }) {
  const { operator } = useSession();
  if (operator) return children;
  return (
    <PageState
      icon={ShieldAlert}
      title="For operators only"
      description="Health and metrics cover every account on this server."
      actions={
        <Button variant="outline" asChild>
          <Link to={ROUTES.OVERVIEW}>Back to overview</Link>
        </Button>
      }
    />
  );
}
