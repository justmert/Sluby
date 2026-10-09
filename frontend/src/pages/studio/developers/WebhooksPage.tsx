import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { Webhooks } from '@/pages/studio/DeveloperPage';

export default function WebhooksPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Webhooks"
        description="Requests this server sends you when a video changes"
      />
      <Webhooks />
    </PageContainer>
  );
}
