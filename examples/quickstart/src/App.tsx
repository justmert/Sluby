import React, { useMemo, useRef, useState } from 'react';
import { SlubyClient, type UploadHandle, type VideoAsset } from '@sluby/sdk';
import { SlubyPlayer } from '@sluby/player';

// Defaults come from the Vite env; every field is overridable in the form so
// the example runs against any Sluby backend without rebuilding.
const ENV = import.meta.env as Record<string, string | undefined>;

type Phase = 'config' | 'uploading' | 'processing' | 'ready' | 'deleting' | 'deleted';

export function App() {
  const [baseUrl, setBaseUrl] = useState(ENV.VITE_SLUBY_BASE_URL ?? 'http://localhost:4500');
  const [deliveryUrl, setDeliveryUrl] = useState(ENV.VITE_SLUBY_DELIVERY_URL ?? '');
  const [apiKey, setApiKey] = useState(ENV.VITE_SLUBY_API_KEY ?? '');

  // Optional viewer identity: when all three are set, playback streams directly
  // from Sia (backend out of the byte path). Provision one with
  // `npm run provision-viewer` in the backend. All three are publishable.
  const [siaIndexerUrl, setSiaIndexerUrl] = useState(ENV.VITE_SLUBY_SIA_INDEXER_URL ?? '');
  const [siaAppId, setSiaAppId] = useState(ENV.VITE_SLUBY_SIA_APP_ID ?? '');
  const [siaAppKey, setSiaAppKey] = useState(ENV.VITE_SLUBY_SIA_APP_KEY ?? '');

  const [phase, setPhase] = useState<Phase>('config');
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [asset, setAsset] = useState<VideoAsset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadRef = useRef<UploadHandle | null>(null);

  const client = useMemo(() => {
    if (!apiKey || !baseUrl) return null;
    const sia =
      siaIndexerUrl && siaAppId && siaAppKey
        ? { indexerUrl: siaIndexerUrl, appId: siaAppId, appKey: siaAppKey }
        : undefined;
    return new SlubyClient({
      apiKey,
      baseUrl,
      deliveryBaseUrl: deliveryUrl || undefined,
      sia,
    });
  }, [apiKey, baseUrl, deliveryUrl, siaIndexerUrl, siaAppId, siaAppKey]);

  async function handleUpload(file: File) {
    if (!client) return;
    setError(null);
    setPhase('uploading');
    setProgress(0);
    try {
      const upload = client.uploads.upload(file, {
        title: file.name,
        description: 'Uploaded from the Sluby quickstart example',
        accessTier: 'public',
        onProgress: (pct) => setProgress(pct),
      });
      uploadRef.current = upload;

      const videoAssetId = await upload.assetId;
      await upload;

      setPhase('processing');
      const ready = await client.assets.waitForReady(videoAssetId, { pollInterval: 3000 });
      setAsset(ready);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('config');
    }
  }

  function togglePause() {
    const upload = uploadRef.current;
    if (!upload) return;
    if (upload.isPaused) {
      upload.resume();
      setPaused(false);
    } else {
      void upload.pause();
      setPaused(true);
    }
  }

  async function handleDelete() {
    if (!client || !asset) return;
    setPhase('deleting');
    try {
      await client.assets.delete(asset.id);
      setPhase('deleted');
      setAsset(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('ready');
    }
  }

  return (
    <main style={styles.main}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Sluby quickstart</h1>
      <p style={{ color: '#666', marginTop: 0, fontSize: 14 }}>
        Upload a video with the SDK, watch it process, play it with the React player, then delete
        it.
      </p>

      {error && <div style={styles.error}>{error}</div>}

      <section style={styles.card}>
        <label style={styles.label}>API base URL</label>
        <input style={styles.input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        <label style={styles.label}>Delivery base URL (optional, defaults to API base)</label>
        <input
          style={styles.input}
          value={deliveryUrl}
          placeholder="e.g. http://localhost:8080 (nginx cache)"
          onChange={(e) => setDeliveryUrl(e.target.value)}
        />
        <label style={styles.label}>API key</label>
        <input
          style={styles.input}
          value={apiKey}
          type="password"
          onChange={(e) => setApiKey(e.target.value)}
        />

        <hr style={styles.hr} />
        <p style={{ fontSize: 13, color: '#444', margin: '0 0 4px' }}>
          Direct-from-Sia playback (optional). Set all three to stream bytes straight from Sia
          instead of the gateway. Provision with <code>npm run provision-viewer</code> in the
          backend. These are publishable.
        </p>
        <label style={styles.label}>Sia indexer URL</label>
        <input
          style={styles.input}
          value={siaIndexerUrl}
          placeholder="e.g. https://sia.storage"
          onChange={(e) => setSiaIndexerUrl(e.target.value)}
        />
        <label style={styles.label}>Viewer app id (hex)</label>
        <input
          style={styles.input}
          value={siaAppId}
          onChange={(e) => setSiaAppId(e.target.value)}
        />
        <label style={styles.label}>Viewer app key (hex)</label>
        <input
          style={styles.input}
          value={siaAppKey}
          onChange={(e) => setSiaAppKey(e.target.value)}
        />
      </section>

      {(phase === 'config' || phase === 'deleted') && (
        <section style={styles.card}>
          {phase === 'deleted' && (
            <p style={{ color: 'green' }}>Asset deleted. Objects are being unpinned from Sia.</p>
          )}
          <input
            type="file"
            accept="video/*"
            disabled={!client}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
            }}
          />
          {!client && (
            <p style={{ color: '#a00', fontSize: 13 }}>Enter an API key and base URL first.</p>
          )}
        </section>
      )}

      {phase === 'uploading' && (
        <section style={styles.card}>
          <div style={styles.progressOuter}>
            <div style={{ ...styles.progressInner, width: `${progress}%` }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <span>{progress}%</span>
            <button type="button" onClick={togglePause}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </section>
      )}

      {phase === 'processing' && (
        <section style={styles.card}>
          <p>Transcoding and storing on Sia. This can take a while for large files.</p>
        </section>
      )}

      {phase === 'ready' && asset && client && (
        <section style={styles.card}>
          <SlubyPlayer client={client} assetId={asset.id} controls style={{ width: '100%' }} />
          <div style={{ marginTop: 12 }}>
            <strong>{asset.title}</strong> · {asset.resolution} ·{' '}
            {(asset.totalStorageBytes / 1_000_000).toFixed(1)} MB ·{' '}
            <span style={{ color: client.sia ? '#059669' : '#666' }}>
              {client.sia ? 'direct from Sia' : 'gateway delivery'}
            </span>
          </div>
          <button type="button" style={styles.deleteBtn} onClick={() => void handleDelete()}>
            Delete asset
          </button>
        </section>
      )}

      {phase === 'deleting' && (
        <section style={styles.card}>
          <p>Deleting asset and unpinning Sia objects…</p>
        </section>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 640,
    margin: '40px auto',
    padding: 16,
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
  },
  label: { display: 'block', fontSize: 13, color: '#444', marginTop: 8, marginBottom: 4 },
  input: { width: '100%', padding: 8, boxSizing: 'border-box', fontSize: 14 },
  hr: { border: 'none', borderTop: '1px solid #eee', margin: '16px 0 8px' },
  error: {
    background: '#fee',
    border: '1px solid #f99',
    color: '#900',
    padding: 12,
    borderRadius: 6,
    marginTop: 12,
    fontSize: 14,
  },
  progressOuter: { height: 10, background: '#eee', borderRadius: 5, overflow: 'hidden' },
  progressInner: { height: '100%', background: '#3b82f6', transition: 'width 0.2s' },
  deleteBtn: {
    marginTop: 12,
    padding: '8px 16px',
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
};
