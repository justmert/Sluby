import { SlubyClient, type SiaViewerConfig } from '@sluby/sdk';

// the studio is served from the same origin as the api, so the sdk rides on
// the session cookie and needs no api key
function viewerConfig(): SiaViewerConfig | undefined {
  const indexerUrl = import.meta.env.VITE_SLUBY_SIA_INDEXER_URL;
  const appId = import.meta.env.VITE_SLUBY_SIA_APP_ID;
  const appKey = import.meta.env.VITE_SLUBY_SIA_APP_KEY;
  if (!indexerUrl || !appId || !appKey) return undefined;
  return { indexerUrl, appId, appKey, name: 'Sluby Studio' };
}

export const sluby = new SlubyClient({
  baseUrl: window.location.origin,
  sia: viewerConfig(),
});
