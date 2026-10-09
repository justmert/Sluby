import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { Snippets } from '@/pages/studio/DeveloperPage';

export default function QuickstartPage() {
  return (
    <PageContainer>
      <PageHeader title="Quickstart" description="Connect your app to this server" />
      <Snippets />
    </PageContainer>
  );
}
