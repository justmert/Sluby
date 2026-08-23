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

  const [phase, setPhase] = useState<Phase>('config');
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [asset, setAsset] = useState<VideoAsset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadRef = useRef<UploadHandle | null>(null);

  const client = useMemo(() => {
    if (!apiKey || !baseUrl) return null;
    return new SlubyClient({
      apiKey,
      baseUrl,
      deliveryBaseUrl: deliveryUrl || undefined,
    });
  }, [apiKey, baseUrl, deliveryUrl]);

  async function handleUpload(file: File) {
    if (!client) return;
    setError(null);
    setPhase('uploading');
    setProgress(0);
    try {
      const { videoAssetId, uploadUrl } = await client.uploads.create({
        title: file.name,
        description: 'Uploaded from the Sluby quickstart example',
        accessTier: 'public',
      });

      const upload = client.uploads.uploadFile(uploadUrl, file, {
        onProgress: (pct) => setProgress(pct),
      });
      uploadRef.current = upload;
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
            {(asset.totalStorageBytes / 1_000_000).toFixed(1)} MB
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
