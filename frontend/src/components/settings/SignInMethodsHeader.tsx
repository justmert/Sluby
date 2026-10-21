import type { ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { SETTINGS_SECTION, SectionLabel } from './section';

// its own module, like SessionsHeader, so the settings route skeleton draws
// the same lines without loading the section's queries

export function SignInMethodsHeader() {
  return (
    <SectionLabel id="settings-sign-in" title="Sign-in methods">
      How you sign in to this Studio.
    </SectionLabel>
  );
}

/** One way to sign in: its icon, its name, what is on file, and an action. */
export function MethodRow({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4.5 py-3.5 [&+&]:border-t">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/40 text-secondary-foreground"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        <div className="text-muted-foreground wrap-anywhere">{detail}</div>
      </div>
      {action}
    </li>
  );
}

/**
 * The password row, from the session alone: the email it signs in with and
 * Change password, or how to get a password.
 */
export function PasswordRow({
  onChange,
  onChangeEmail,
}: {
  onChange?: () => void;
  onChangeEmail?: () => void;
}) {
  const password = useSession().signIn.find((m) => m.provider === 'password');
  return (
    <MethodRow
      icon={<KeyRound className="size-4.5" />}
      title="Password"
      detail={
        password ? (
          <span dir="auto">{password.username}</span>
        ) : (
          'Ask an admin for a reset link to add a password.'
        )
      }
      action={
        password && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-8 pointer-coarse:h-10" onClick={onChangeEmail}>
              Change email
            </Button>
            <Button variant="outline" className="h-8 pointer-coarse:h-10" onClick={onChange}>
              Change password
            </Button>
          </div>
        )
      }
    />
  );
}

export const METHODS_LIST = 'overflow-hidden rounded-xl border bg-card text-sm';

/**
 * The section as it first draws, for the route skeleton: the password row
 * needs nothing from the server, and the GitHub row waits on the config.
 */
export function SignInMethodsSectionLoading() {
  return (
    <section className={SETTINGS_SECTION}>
      <SignInMethodsHeader />
      <div className="flex flex-col gap-3">
        <ul className={METHODS_LIST}>
          <PasswordRow />
        </ul>
      </div>
    </section>
  );
}
