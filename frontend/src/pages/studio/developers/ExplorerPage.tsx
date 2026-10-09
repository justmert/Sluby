import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { ApiExplorer } from '@/pages/studio/DeveloperPage';

export default function ExplorerPage() {
  return (
    <PageContainer>
      <PageHeader title="API explorer" description="Send requests to this server as you" />
      <ApiExplorer />
    </PageContainer>
  );
}
