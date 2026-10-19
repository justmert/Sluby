import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { PageState } from '@/components/shared/PageState';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/constants';
import { useSession } from '@/lib/session';

/**
 * The deployment pages and Members, for admins only. The api refuses their
 * data to members, so a member who follows a link here is told why instead
 * of being moved somewhere else (plan D-03).
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { admin } = useSession();
  if (admin) return children;
  return (
    <PageState
      icon={ShieldAlert}
      title="For admins only"
      description="Members, health and metrics are for the admins of this server. Ask an admin if you need them."
      actions={
        <Button variant="outline" asChild>
          <Link to={ROUTES.OVERVIEW}>Back to overview</Link>
        </Button>
      }
    />
  );
}
