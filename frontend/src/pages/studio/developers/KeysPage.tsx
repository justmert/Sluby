import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { ApiKeysCard } from '@/pages/studio/SettingsPage';

export default function KeysPage() {
  return (
    <PageContainer>
      <PageHeader
        title="API keys"
        description="For the REST API and SDK, shown once when created"
      />
      <ApiKeysCard />
    </PageContainer>
  );
}
