import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { useAssetStats } from '@/hooks/useStats';
import { healthOf, useSystemStatus } from '@/hooks/useSystemStatus';
import { OperatorCards, StatusCard } from '@/pages/studio/DashboardPage';

// operators only: App.tsx wraps the route in OperatorOnly
export default function HealthPage() {
  const system = useSystemStatus({ poll: true });
  const stats = useAssetStats();
  return (
    <PageContainer>
      <PageHeader
        title="Health"
        description="Whether this server and its Sia storage are working"
        meta={system.data && <StatusBadge kind="health" status={healthOf(system.data)} />}
      />
      <StatusCard
        status={system.data}
        error={system.error}
        showOwnObjects={false}
        onRetry={() => void system.refetch()}
        retrying={system.isFetching}
      />
      <OperatorCards
        status={system.data}
        error={system.error}
        storedBytes={stats.data?.stored_bytes}
        stagger={false}
      />
    </PageContainer>
  );
}
