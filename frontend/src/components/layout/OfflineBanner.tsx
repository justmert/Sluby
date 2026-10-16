import { WifiOff } from 'lucide-react';
import { Collapse } from '@/components/motion';
import { useOnline } from '@/hooks/useOnline';

/**
 * A line over the page while the browser is offline. Queries pause and keep
 * what they last loaded, so pages look normal but stop updating; this says
 * why. The live region stays mounted so the change is announced.
 */
export function OfflineBanner() {
  const online = useOnline();
  return (
    <div role="status" aria-label="Connection">
      <Collapse open={!online}>
        <p className="flex items-start gap-2 border-b bg-muted px-4 py-2 text-sm text-foreground sm:items-center sm:px-8">
          <WifiOff
            className="mt-0.5 size-4 shrink-0 text-muted-foreground sm:mt-0"
            aria-hidden="true"
          />
          You are offline. Pages keep what last loaded and update when the connection is back.
        </p>
      </Collapse>
    </div>
  );
}
