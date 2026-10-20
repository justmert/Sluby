import React, { useMemo, useRef, useState } from 'react';
import {
  ProcessingFailedError,
  SlubyClient,
  type AccessTier,
  type AssetUploadHandle,
  type VideoAsset,
} from '@sluby/sdk';
import { SlubyPlayer, type QualityLevel, type SlubyPlayerHandle } from '@sluby/player';
import { describeError } from './errors.js';

// Defaults come from the Vite env; every field is overridable in the form so
// the example runs against any Sluby backend without rebuilding.
const ENV = import.meta.env as Record<string, string | undefined>;

type Phase = 'idle' | 'uploading' | 'processing';

interface Playing {
  assetId: string;
  signed: boolean;
  /** A playback URL to play as given, such as a signed URL from your server. */
  src?: string;
  /** Present when this page uploaded the asset; absent for a pasted id. */
  asset?: VideoAsset;
}

export function App() {
  const [baseUrl, setBaseUrl] = useState(ENV.VITE_SLUBY_BASE_URL ?? 'http://localhost:8080');
  const [deliveryUrl, setDeliveryUrl] = useState(ENV.VITE_SLUBY_DELIVERY_URL ?? '');
  const [apiKey, setApiKey] = useState(ENV.VITE_SLUBY_API_KEY ?? '');

  // Optional viewer identity: when all three are set, playback streams directly
  // from Sia (backend out of the byte path). Provision one with
  // `npm run provision-viewer` in the backend. All three are publishable.
  const [siaIndexerUrl, setSiaIndexerUrl] = useState(ENV.VITE_SLUBY_SIA_INDEXER_URL ?? '');
  const [siaAppId, setSiaAppId] = useState(ENV.VITE_SLUBY_SIA_APP_ID ?? '');
  const [siaAppKey, setSiaAppKey] = useState(ENV.VITE_SLUBY_SIA_APP_KEY ?? '');

  const [phase, setPhase] = useState<Phase>('idle');
  const [accessTier, setAccessTier] = useState<AccessTier>('public');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [assetIdInput, setAssetIdInput] = useState('');
  const [signedInput, setSignedInput] = useState(false);
  const [srcInput, setSrcInput] = useState('');
  const [playing, setPlaying] = useState<Playing | null>(null);

  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState<QualityLevel | null>(null);
  // -1 is adaptive, otherwise the pinned rendition's index
  const [pinnedQuality, setPinnedQuality] = useState(-1);
  const [delivery, setDelivery] = useState<'sia' | 'hybrid' | 'gateway' | null>(null);

  const uploadRef = useRef<AssetUploadHandle | null>(null);
  const playerRef = useRef<SlubyPlayerHandle>(null);

  // One client per configuration. The player's effects key on the client, so a
  // new instance on every render would restart playback.
  const client = useMemo(() => {
    if (!baseUrl) return null;
    const sia =
      siaIndexerUrl && siaAppId && siaAppKey
        ? { indexerUrl: siaIndexerUrl, appId: siaAppId, appKey: siaAppKey }
        : undefined;
    return new SlubyClient({
      // public playback, direct from Sia included, needs no key; uploading,
      // deleting and minting signed urls do
      apiKey: apiKey || undefined,
      baseUrl,
      deliveryBaseUrl: deliveryUrl || undefined,
      sia,
    });
  }, [apiKey, baseUrl, deliveryUrl, siaIndexerUrl, siaAppId, siaAppKey]);

  function play(next: Playing) {
    setQualities([]);
    setCurrentQuality(null);
    setPinnedQuality(-1);
    setDelivery(null);
    setPlaying(next);
  }

  async function handleUpload(file: File) {
    if (!client) return;
    setError(null);
    setNotice(null);
    setPhase('uploading');
    setProgress(0);
    try {
      const upload = client.uploads.upload(file, {
        title: file.name,
        description: 'Uploaded from the Sluby quickstart example',
        accessTier,
        onProgress: (pct) => setProgress(pct),
      });
      uploadRef.current = upload;

      // the asset exists as soon as the upload starts
      const videoAssetId = await upload.assetId;
      await upload;

      setPhase('processing');
      setStage('');
      const stagePoll = setInterval(() => {
        client.assets
          .processing(videoAssetId)
          .then((job) => setStage(`${job.stage}, ${job.progressPercent}%`))
          .catch(() => {
            // the next poll tries again; waitForReady reports real failures
          });
      }, 3000);
      let ready: VideoAsset;
      try {
        ready = await client.assets.waitForReady(videoAssetId, {
          pollInterval: 3000,
          timeout: 30 * 60_000,
        });
      } catch (err) {
        if (!(err instanceof ProcessingFailedError)) throw err;
        // the processing job says why it failed
        const job = await client.assets.processing(videoAssetId).catch(() => null);
        throw new Error(`Processing failed: ${job?.errorMessage ?? 'no reason was recorded'}`, {
          cause: err,
        });
      } finally {
        clearInterval(stagePoll);
      }
      setAssetIdInput(ready.id);
      play({ assetId: ready.id, signed: ready.accessTier === 'private', asset: ready });
    } catch (err) {
      setError(describeError(err));
    } finally {
      uploadRef.current = null;
      setPaused(false);
      setPhase('idle');
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

  function pickQuality(value: string) {
    const index = Number(value);
    // -1 hands the choice back to hls.js's adaptive bitrate logic
    playerRef.current?.setQuality(index);
    setPinnedQuality(index);
  }

  async function handleDelete() {
    if (!client || !playing) return;
    setError(null);
    try {
      await client.assets.delete(playing.assetId);
      setNotice(`Deleted ${playing.assetId}. Its Sia objects are being unpinned.`);
      setPlaying(null);
    } catch (err) {
      setError(describeError(err));
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
      {notice && <p style={{ color: 'green' }}>{notice}</p>}

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
        <label style={styles.label}>
          API key (for uploading and deleting; playback needs none)
        </label>
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

      {phase === 'idle' && (
        <section style={styles.card}>
          <label style={styles.label}>Access</label>
          <select
            value={accessTier}
            onChange={(e) => setAccessTier(e.target.value === 'private' ? 'private' : 'public')}
          >
            <option value="public">public</option>
            <option value="private">private (plays from a signed URL)</option>
          </select>
          <label style={styles.label}>Upload a video</label>
          <input
            type="file"
            accept="video/*"
            disabled={!client}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
            }}
          />
          {!client && <p style={{ color: '#a00', fontSize: 13 }}>Enter a base URL first.</p>}
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
          {stage && <p style={{ color: '#666', fontSize: 13 }}>Stage: {stage}</p>}
        </section>
      )}

      <section style={styles.card}>
        <label style={styles.label}>Play an asset by id (or pb_ playback id)</label>
        <input
          style={styles.input}
          value={assetIdInput}
          onChange={(e) => setAssetIdInput(e.target.value)}
        />
        <label style={styles.label}>
          Playback URL (optional: a signed URL your server minted for a private asset)
        </label>
        <input
          style={styles.input}
          value={srcInput}
          placeholder="empty plays the public stream URL, no key needed"
          onChange={(e) => setSrcInput(e.target.value)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <label style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={signedInput}
              onChange={(e) => setSignedInput(e.target.checked)}
            />{' '}
            signed URL
          </label>
          <button
            type="button"
            disabled={!client || !assetIdInput.trim()}
            onClick={() =>
              play({
                assetId: assetIdInput.trim(),
                signed: signedInput,
                src: srcInput.trim() || undefined,
              })
            }
          >
            Play
          </button>
        </div>
      </section>

      {playing && client && (
        <section style={styles.card}>
          <SlubyPlayer
            key={`${playing.assetId}:${playing.signed}:${playing.src ?? ''}`}
            ref={playerRef}
            // a public asset plays from its stream url with no key, and with a
            // viewer identity straight from Sia; "signed" without a url has the
            // client mint one, which needs a key
            src={
              playing.src ??
              (playing.signed ? undefined : client.playback.streamUrl(playing.assetId))
            }
            client={client}
            assetId={playing.assetId}
            // the player only signs without a src, and warns if these come with one
            {...(playing.signed && !playing.src ? { signed: true, expiresIn: 3600 } : {})}
            controls
            style={{ width: '100%' }}
            onQualitiesChange={setQualities}
            onQualityChange={setCurrentQuality}
            onDeliveryChange={setDelivery}
            onError={(err) => setError(`Playback failed: ${err.message}`)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <label style={{ fontSize: 13 }}>Quality</label>
            <select
              value={String(pinnedQuality)}
              disabled={qualities.length === 0}
              onChange={(e) => pickQuality(e.target.value)}
            >
              <option value="-1">
                Auto{pinnedQuality === -1 && currentQuality ? ` (${currentQuality.name})` : ''}
              </option>
              {qualities.map((q) => (
                <option key={q.index} value={q.index}>
                  {q.name} · {Math.round(q.bitrate / 1000)} kbps
                </option>
              ))}
            </select>
            {delivery && (
              <span style={{ color: delivery === 'sia' ? '#059669' : '#666', fontSize: 13 }}>
                {delivery === 'sia' ? 'direct from Sia' : 'gateway delivery'}
              </span>
            )}
          </div>
          {playing.asset && (
            <div style={{ marginTop: 12 }}>
              <strong>{playing.asset.title}</strong> · {playing.asset.resolution} ·{' '}
              {(playing.asset.totalStorageBytes / 1_000_000).toFixed(1)} MB
            </div>
          )}
          <button type="button" style={styles.deleteBtn} onClick={() => void handleDelete()}>
            Delete asset
          </button>
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
