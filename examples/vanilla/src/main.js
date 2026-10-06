import Hls from 'hls.js';
import { SlubyClient } from '@sluby/sdk';
import { describeError } from './errors.js';
import { playAsset } from './player.js';

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return /** @type {T} */ (el);
}

/** @type {HTMLInputElement} */ const baseUrlInput = $('base-url');
/** @type {HTMLInputElement} */ const deliveryUrlInput = $('delivery-url');
/** @type {HTMLInputElement} */ const apiKeyInput = $('api-key');
/** @type {HTMLInputElement} */ const siaIndexerInput = $('sia-indexer');
/** @type {HTMLInputElement} */ const siaAppIdInput = $('sia-app-id');
/** @type {HTMLInputElement} */ const siaAppKeyInput = $('sia-app-key');
/** @type {HTMLInputElement} */ const fileInput = $('file');
/** @type {HTMLSelectElement} */ const tierSelect = $('tier');
/** @type {HTMLButtonElement} */ const uploadButton = $('upload');
/** @type {HTMLButtonElement} */ const pauseButton = $('pause');
/** @type {HTMLProgressElement} */ const progressBar = $('progress');
/** @type {HTMLParagraphElement} */ const uploadStatus = $('upload-status');
/** @type {HTMLInputElement} */ const assetIdInput = $('asset-id');
/** @type {HTMLInputElement} */ const playbackUrlInput = $('playback-url');
/** @type {HTMLInputElement} */ const signedInput = $('signed');
/** @type {HTMLButtonElement} */ const playButton = $('play');
/** @type {HTMLButtonElement} */ const deleteButton = $('delete');
/** @type {HTMLVideoElement} */ const video = $('video');
/** @type {HTMLSelectElement} */ const qualitySelect = $('quality');
/** @type {HTMLSpanElement} */ const deliveryLabel = $('delivery');
/** @type {HTMLDivElement} */ const errorBox = $('error');

const env = import.meta.env;
baseUrlInput.value = env.VITE_SLUBY_BASE_URL ?? 'http://localhost:8080';
deliveryUrlInput.value = env.VITE_SLUBY_DELIVERY_URL ?? '';
apiKeyInput.value = env.VITE_SLUBY_API_KEY ?? '';
siaIndexerInput.value = env.VITE_SLUBY_SIA_INDEXER_URL ?? '';
siaAppIdInput.value = env.VITE_SLUBY_SIA_APP_ID ?? '';
siaAppKeyInput.value = env.VITE_SLUBY_SIA_APP_KEY ?? '';

/** @param {unknown} err */
function showError(err) {
  errorBox.textContent = describeError(err);
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
}

/** @type {SlubyClient | null} */
let client = null;
/** @type {string} */
let clientKey = '';

// one client per configuration, so the sia viewer session (and its wasm
// module) is reused across plays instead of reconnecting every time
function getClient() {
  const config = {
    baseUrl: baseUrlInput.value.trim(),
    deliveryBaseUrl: deliveryUrlInput.value.trim() || undefined,
    // playback needs no key; uploading, deleting and minting signed urls do
    apiKey: apiKeyInput.value.trim() || undefined,
    sia:
      siaIndexerInput.value && siaAppIdInput.value && siaAppKeyInput.value
        ? {
            indexerUrl: siaIndexerInput.value.trim(),
            appId: siaAppIdInput.value.trim(),
            appKey: siaAppKeyInput.value.trim(),
          }
        : undefined,
  };
  const key = JSON.stringify(config);
  if (!client || key !== clientKey) {
    client = new SlubyClient(config);
    clientKey = key;
  }
  return client;
}

/** @type {import('@sluby/sdk').AssetUploadHandle | null} */
let currentUpload = null;

uploadButton.addEventListener('click', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  clearError();
  uploadButton.disabled = true;
  pauseButton.disabled = false;
  progressBar.value = 0;
  try {
    const sluby = getClient();
    const accessTier = tierSelect.value === 'private' ? 'private' : 'public';
    const upload = sluby.uploads.upload(file, {
      title: file.name,
      accessTier,
      onProgress: (percent) => {
        progressBar.value = percent;
        uploadStatus.textContent = `Uploading: ${percent}%`;
      },
    });
    currentUpload = upload;

    // the asset exists as soon as the upload starts
    const assetId = await upload.assetId;
    assetIdInput.value = assetId;
    signedInput.checked = accessTier === 'private';
    await upload;
    pauseButton.disabled = true;

    uploadStatus.textContent = 'Processing: transcoding and storing on Sia.';
    const stagePoll = setInterval(async () => {
      try {
        const job = await sluby.assets.processing(assetId);
        uploadStatus.textContent = `Processing: ${job.stage}, ${job.progressPercent}%`;
      } catch {
        // the next poll tries again; waitForReady below reports real failures
      }
    }, 3000);
    try {
      await sluby.assets.waitForReady(assetId, { pollInterval: 3000, timeout: 30 * 60_000 });
      uploadStatus.textContent = 'Ready.';
    } catch (err) {
      // waitForReady throws a plain Error when processing failed; the
      // processing job carries the reason
      const job = await sluby.assets.processing(assetId).catch(() => null);
      throw job?.errorMessage ? new Error(`Processing failed: ${job.errorMessage}`) : err;
    } finally {
      clearInterval(stagePoll);
    }
  } catch (err) {
    showError(err);
    uploadStatus.textContent = '';
  } finally {
    currentUpload = null;
    uploadButton.disabled = false;
    pauseButton.disabled = true;
  }
});

pauseButton.addEventListener('click', async () => {
  if (!currentUpload) return;
  if (currentUpload.isPaused) {
    currentUpload.resume();
    pauseButton.textContent = 'Pause';
  } else {
    await currentUpload.pause();
    pauseButton.textContent = 'Resume';
  }
});

/** @type {import('./player.js').Playback | null} */
let playback = null;

playButton.addEventListener('click', async () => {
  const assetId = assetIdInput.value.trim();
  if (!assetId) return;
  clearError();
  playback?.destroy();
  playback = null;
  qualitySelect.replaceChildren();
  qualitySelect.disabled = true;
  try {
    playback = await playAsset(video, getClient(), assetId, {
      src: playbackUrlInput.value.trim() || undefined,
      signed: signedInput.checked,
      onFatalError: (message) => showError(new Error(`Playback failed: ${message}`)),
    });
    deliveryLabel.textContent =
      playback.delivery === 'sia' ? 'direct from Sia' : 'through the gateway';

    const hls = playback.hls;
    if (hls) {
      hls.once(Hls.Events.MANIFEST_PARSED, () => {
        // -1 hands the choice back to hls.js's adaptive bitrate logic
        qualitySelect.add(new Option('Auto', '-1'));
        hls.levels.forEach((level, index) => {
          qualitySelect.add(new Option(`${level.height}p`, String(index)));
        });
        qualitySelect.disabled = false;
      });
      qualitySelect.onchange = () => {
        hls.currentLevel = Number(qualitySelect.value);
      };
    }
    await video.play();
  } catch (err) {
    showError(err);
  }
});

deleteButton.addEventListener('click', async () => {
  const assetId = assetIdInput.value.trim();
  if (!assetId) return;
  clearError();
  try {
    playback?.destroy();
    playback = null;
    await getClient().assets.delete(assetId);
    uploadStatus.textContent = `Deleted ${assetId}. Its Sia objects are being unpinned.`;
    assetIdInput.value = '';
  } catch (err) {
    showError(err);
  }
});
