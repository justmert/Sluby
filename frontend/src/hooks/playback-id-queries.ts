import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePlaybackIdInput, PlaybackId } from '@sluby/sdk';
import { errorStatus } from '@/hooks/asset-queries';
import { sluby } from '@/lib/sluby';

// under ['assets', ...] so forgetting or deleting the asset drops these too
const key = (assetId: string) => ['assets', 'playback-ids', assetId];

// a row shown while its create is on the way has no pb_ handle yet
const PENDING = 'pending:';
export const isPendingPlaybackId = (row: PlaybackId) => row.id.startsWith(PENDING);

// a created row keeps its placeholder's react key, so it settles in place
// instead of leaving and entering again
const keyAliases = new Map<string, string>();
export const playbackIdRowKey = (row: PlaybackId) => keyAliases.get(row.id) ?? row.id;

/** Where a player loads the HLS stream of a playback id on this deployment. */
export function playbackStreamUrl(playbackId: string, origin = window.location.origin) {
  return `${origin}/v1/stream/${encodeURIComponent(playbackId)}/master.m3u8`;
}

/**
 * A stream URL for a signed playback id that plays for `expiresIn` seconds.
 * The gateway checks the playback id's entry against the expiry and
 * signature the server mints for it.
 */
export async function signedPlaybackStreamUrl(playbackId: string, expiresIn = 3600) {
  const { signedUrl, expiresAt } = await sluby.playback.getSignedUrl(playbackId, { expiresIn });
  const signed = new URL(signedUrl, window.location.origin).searchParams;
  const expires = signed.get('expires');
  const sig = signed.get('sig');
  if (!expires || !sig) throw new Error('The signed URL came back without a signature');
  const query = new URLSearchParams({ expires, sig });
  return { url: `${playbackStreamUrl(playbackId)}?${query}`, expiresAt };
}

export function usePlaybackIds(assetId: string) {
  return useQuery({
    queryKey: key(assetId),
    queryFn: () => sluby.playbackIds.list(assetId),
  });
}

let pendingSeq = 0;

/** Create a playback id; a placeholder row shows until the server answers. */
export function useCreatePlaybackId(assetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlaybackIdInput) => sluby.playbackIds.create(assetId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key(assetId) });
      const placeholder: PlaybackId = {
        id: `${PENDING}${++pendingSeq}`,
        playbackId: '',
        policy: input.policy ?? 'public',
        name: input.name ?? '',
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData<PlaybackId[]>(key(assetId), (rows = []) => [placeholder, ...rows]);
      // the server lists the newest first
      return { placeholder };
    },
    onSuccess: (created, _input, context) => {
      keyAliases.set(created.id, context.placeholder.id);
      queryClient.setQueryData<PlaybackId[]>(key(assetId), (rows = []) =>
        rows.map((r) => (r.id === context.placeholder.id ? created : r)),
      );
    },
    onError: (_err, _input, context) => {
      queryClient.setQueryData<PlaybackId[]>(key(assetId), (rows = []) =>
        rows.filter((r) => r.id !== context?.placeholder.id),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key(assetId) }),
  });
}

/** Delete a playback id; the row goes at once and comes back if the server says no. */
export function useDeletePlaybackId(assetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (playbackId: string) => {
      try {
        await sluby.playbackIds.delete(playbackId);
      } catch (err) {
        // already gone is what a delete asks for
        if (errorStatus(err) !== 404) throw err;
      }
    },
    onMutate: async (playbackId) => {
      await queryClient.cancelQueries({ queryKey: key(assetId) });
      const previous = queryClient.getQueryData<PlaybackId[]>(key(assetId));
      queryClient.setQueryData<PlaybackId[]>(key(assetId), (rows = []) =>
        rows.filter((r) => r.playbackId !== playbackId),
      );
      return { previous };
    },
    onError: (_err, _playbackId, context) => {
      if (context?.previous) queryClient.setQueryData(key(assetId), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key(assetId) }),
  });
}
