import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { SessionsSection } from '@/components/settings/SessionsSection';
import { useSession } from '@/lib/session';

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
