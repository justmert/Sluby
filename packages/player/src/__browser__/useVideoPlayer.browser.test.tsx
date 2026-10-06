// The documented way to build custom controls: useVideo(playerRef) on a real
// <SlubyPlayer> with real hls.js. The player owns the <video> and builds a new
// hls.js instance per load, so the hook has to follow both through the handle.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { useRef, useState } from 'react';
import { SlubyPlayer, type SlubyPlayerHandle } from '../SlubyPlayer.js';
import { useVideo } from '../hooks/useVideo.js';
import type { UseVideoReturn } from '../types.js';
import {
  getCatalog,
  injectFault,
  mount,
  objectUrl,
  resetGateway,
  type FixtureCatalog,
  type Mounted,
} from './harness.js';

let catalog: FixtureCatalog;
let mounted: Mounted | null = null;

beforeAll(async () => {
  catalog = await getCatalog();
});

beforeEach(async () => {
  await resetGateway();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

interface Latest {
  api: UseVideoReturn | null;
  player: () => SlubyPlayerHandle | null;
  showPlayer: ((show: boolean) => void) | null;
}

function Controls({
  src,
  latest,
  initiallyShown,
}: {
  src: string;
  latest: Latest;
  initiallyShown: boolean;
}) {
  const player = useRef<SlubyPlayerHandle>(null);
  const api = useVideo(player);
  const [shown, setShown] = useState(initiallyShown);
  latest.api = api;
  latest.player = () => player.current;
  latest.showPlayer = setShown;
  return shown ? <SlubyPlayer ref={player} src={src} muted autoPlay /> : null;
}

function render(initiallyShown = true): Latest {
  const latest: Latest = { api: null, player: () => null, showPlayer: null };
  mounted = mount(
    <Controls src={objectUrl(catalog.masterId)} latest={latest} initiallyShown={initiallyShown} />,
  );
  return latest;
}

describe('useVideo(playerRef) on a real SlubyPlayer', () => {
  it('reports what the player is doing', async () => {
    const latest = render();

    await vi.waitFor(
      () => {
        expect(latest.api!.isPlaying).toBe(true);
        expect(latest.api!.currentTime).toBeGreaterThan(0.5);
        expect(latest.api!.duration).toBeGreaterThan(2);
        expect(latest.api!.qualities.map((q) => q.name)).toEqual(['144p', '240p']);
        expect(latest.api!.currentQuality).not.toBeNull();
      },
      { timeout: 15_000, interval: 50 },
    );

    latest.api!.pause();
    await vi.waitFor(() => expect(latest.api!.isPlaying).toBe(false), { timeout: 5_000 });

    // quality control goes to the player's current hls.js instance
    latest.api!.setQuality(1);
    expect(latest.player()!.getHlsInstance()!.manualLevel).toBe(1);
    expect(latest.player()!.isAutoQuality()).toBe(false);
  });

  it('follows a player mounted after the hook first ran', async () => {
    const latest = render(false);
    await vi.waitFor(() => expect(latest.showPlayer).not.toBeNull());
    expect(latest.api!.isPlaying).toBe(false);

    latest.showPlayer!(true);

    await vi.waitFor(
      () => {
        expect(latest.api!.isPlaying).toBe(true);
        expect(latest.api!.qualities).toHaveLength(2);
      },
      { timeout: 15_000, interval: 50 },
    );
  });

  it('keeps tracking the new hls.js instance after a Retry', async () => {
    // the master 404s, the player gives up, and Retry makes a new instance
    await injectFault(catalog.masterId, 404);
    const latest = render();
    const container = mounted!.container;
    const retry = await vi.waitFor(
      () => {
        const btn = container.querySelector<HTMLButtonElement>(
          '[data-sluby-overlay="error"] button',
        );
        expect(btn).not.toBeNull();
        return btn!;
      },
      { timeout: 20_000, interval: 50 },
    );
    expect(latest.api!.qualities).toEqual([]);

    await resetGateway();
    retry.click();

    await vi.waitFor(
      () => {
        expect(latest.api!.qualities).toHaveLength(2);
        expect(latest.api!.isPlaying).toBe(true);
      },
      { timeout: 15_000, interval: 50 },
    );
    latest.api!.setQuality(0);
    expect(latest.player()!.getHlsInstance()!.manualLevel).toBe(0);
  });
});
