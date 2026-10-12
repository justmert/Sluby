import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { SessionsSection } from '@/components/settings/SessionsSection';
import { useSession } from '@/lib/session';
import { PAGE_HEADS } from '@/components/layout/page-heads';

export default function SettingsPage() {
  const { authDisabled } = useSession();
  return (
    <PageContainer className="max-w-240">
      <PageHeader {...PAGE_HEADS.settings} />
      <div className="flex flex-col gap-6">
        <AccountSection />
        {/* with sign-in off nobody signs in, so there are no browsers to list */}
        {!authDisabled && <SessionsSection />}
        <AppearanceSection />
      </div>
    </PageContainer>
  );
}
