import { ApiKeysCard } from '@/components/developers/ApiKeysManager';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { SessionsSection } from '@/components/settings/SessionsSection';
import { useSession } from '@/lib/session';

// the keys moved to the developers section (plan D-05); this card shows the
// same manager until the settings page drops it
export { ApiKeysCard };

export default function SettingsPage() {
  const { authDisabled } = useSession();
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="Settings" description="Your account, browsers and appearance" />
      <div className="flex flex-col gap-10">
        <AccountSection />
        {/* with sign-in off nobody signs in, so there are no browsers to list */}
        {!authDisabled && <SessionsSection />}
        <AppearanceSection />
      </div>
    </PageContainer>
  );
}
