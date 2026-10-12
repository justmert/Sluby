import { LogOut } from 'lucide-react';
import { SectionHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { SETTINGS_HEAD } from './section';

/**
 * The signed-in browsers heading with its Sign out everywhere button. Its
 * own module so the settings route skeleton draws the same lines.
 */
export function SessionsHeader({
  username,
  onSignOutAll,
}: {
  username: string;
  onSignOutAll?: () => void;
}) {
  return (
    <SectionHeader
      id="settings-browsers"
      className={SETTINGS_HEAD}
      title="Signed-in browsers"
      description={
        <>
          Where you are signed in as <span dir="auto">{username}</span>.
        </>
      }
      // always there, so the header does not grow when the list lands;
      // it signs this browser out too, so it works with no others listed
      action={
        <Button variant="outline" size="sm" data-sign-out-all onClick={onSignOutAll}>
          <LogOut aria-hidden="true" />
          Sign out everywhere
        </Button>
      }
    />
  );
}
