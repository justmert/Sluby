import { lazy, Suspense, type ComponentProps } from 'react';
import type { AssetPlayer as Player } from './AssetPlayer';

// the player brings hls.js, the biggest dependency the studio has, so only a
// sheet or page that shows a ready video downloads it
const AssetPlayer = lazy(() => import('./AssetPlayer').then((m) => ({ default: m.AssetPlayer })));

/** AssetPlayer, loaded the first time one is shown, holding its frame meanwhile. */
export function LazyAssetPlayer(props: ComponentProps<typeof Player>) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-3" aria-busy="true">
          <div className="aspect-video w-full rounded-xl bg-media" />
        </div>
      }
    >
      <AssetPlayer {...props} />
    </Suspense>
  );
}
