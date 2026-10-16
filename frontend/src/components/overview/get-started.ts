// what the get started checklist knows: each step's state from live data,
// and whether this browser hid the card for the account
import { useCallback, useState } from 'react';
import type { VideoAsset } from '@sluby/sdk';
import type { AssetStats, SystemStatus } from '@/hooks/useStats';
import type { Usage } from '@/hooks/useUsage';

export type StepId = 'sia' | 'upload' | 'play' | 'key';

export interface StepState {
  id: StepId;
  done: boolean;
}

export interface GetStartedInput {
  operator: boolean;
  status?: SystemStatus;
  stats?: AssetStats;
  usage?: Usage;
  /** the newest videos, whose all-time play counts also tick step 3 */
  videos?: VideoAsset[];
  activeKeys?: number;
}

/** Step 1 is done when the indexer answers and, for an operator, the Sia account is ready. */
export function siaConnected(status: SystemStatus | undefined, operator: boolean): boolean {
  if (!status?.indexer.ok) return false;
  if (status.scope !== 'deployment' || !operator) return true;
  return status.indexer.account?.ready === true;
}

export function stepStates(input: GetStartedInput): StepState[] {
  return [
    { id: 'sia', done: siaConnected(input.status, input.operator) },
    // a video still waiting for its file was created, not uploaded
    {
      id: 'upload',
      done: (input.stats?.total ?? 0) - (input.stats?.by_status.created ?? 0) > 0,
    },
    {
      id: 'play',
      done: (input.usage?.total ?? 0) > 0 || (input.videos ?? []).some((v) => v.playCount > 0),
    },
    { id: 'key', done: (input.activeKeys ?? 0) > 0 },
  ];
}

export const REQUIRED_STEPS = 4;

export const doneCount = (steps: StepState[]) => steps.filter((s) => s.done).length;

const storageKey = (accountId: string) => `sluby:get-started-dismissed:${accountId}`;

/**
 * Whether the card is hidden for this account in this browser: dismissed, or
 * finished once. A finished checklist stays finished, so deleting the last
 * video later does not bring the onboarding back.
 */
export function useGetStartedHidden(accountId: string) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(storageKey(accountId)) !== null;
    } catch {
      // storage blocked (private window, site data off): the card shows, nothing breaks
      return false;
    }
  });
  const hide = useCallback(
    (why: 'dismissed' | 'done') => {
      setHidden(true);
      try {
        localStorage.setItem(storageKey(accountId), why);
      } catch {
        // see above: hidden for this visit only
      }
    },
    [accountId],
  );
  return { hidden, hide };
}

/** The video a processing line names: the newest one still uploading or processing. */
export function busyVideo(videos: VideoAsset[] | undefined): VideoAsset | undefined {
  return videos?.find((v) => v.status === 'processing' || v.status === 'uploading');
}
