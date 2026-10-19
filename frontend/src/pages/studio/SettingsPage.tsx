import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { SessionsSection } from '@/components/settings/SessionsSection';
import { SignInMethodsSection } from '@/components/settings/SignInMethodsSection';
import { useSession } from '@/lib/session';
import { PAGE_HEADS } from '@/components/layout/page-heads';

export default function SettingsPage() {
  const { authDisabled } = useSession();
  return (
    <PageContainer>
      <PageHeader
        title={PAGE_HEADS.settings.title}
        description={PAGE_HEADS.settings.description}
        className="mb-2"
      />
      <AccountSection />
      {/* with sign-in off nobody signs in, so there are no methods or browsers to list */}
      {!authDisabled && <SignInMethodsSection />}
      {!authDisabled && <SessionsSection />}
      <AppearanceSection />
    </PageContainer>
  );
}
