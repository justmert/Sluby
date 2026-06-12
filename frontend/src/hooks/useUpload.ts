import { useState, useCallback, useRef, useEffect } from 'react';
import { apiClient, ApiError, TUS_ENDPOINT } from '../lib/api-client';
import { getStoredApiKey } from '../lib/api-key-store';
import type { VideoAsset } from './useAssets';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadStatus =
  | 'idle'
  | 'creating'
  | 'uploading'
  | 'processing'
  | 'complete'
  | 'error';

export interface ChunkState {
  index: number;
  status: 'pending' | 'uploading' | 'complete' | 'error';
}

export interface ProcessingLogEntry {
  timestamp: string;
  stage: string;
  message: string;
}

export interface UploadState {
  status: UploadStatus;
  progress: number;
  speed: number;
  videoAssetId: string | null;
  uploadUrl: string | null;
  uploadSessionId: string | null;
  asset: VideoAsset | null;
  error: string | null;
  chunks: ChunkState[];
  processingProgress: number;
  processingStage: string | null;
  processingLogs: ProcessingLogEntry[];
}

export interface UploadMetadata {
  title: string;
  description: string;
  access_tier: string;
  creator_address?: string;
  initial_viewer_addresses?: string;
}

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const VIZ_CHUNK_SIZE = 1024 * 1024; // 1 MB visualization granularity
const POLL_INTERVAL = 2000;

const INITIAL_STATE: UploadState = {
  status: 'idle',
  progress: 0,
  speed: 0,
  videoAssetId: null,
  uploadUrl: null,
  uploadSessionId: null,
  asset: null,
  error: null,
  chunks: [],
  processingProgress: 0,
  processingStage: null,
  processingLogs: [],
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUpload() {
  const [state, setState] = useState<UploadState>(INITIAL_STATE);
  const tusRef = useRef<{ abort?: () => void } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tusRef.current?.abort) tusRef.current.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startUpload = useCallback(
    async (file: File, metadata: UploadMetadata) => {
      const totalVizChunks = Math.ceil(file.size / VIZ_CHUNK_SIZE);
      const chunks: ChunkState[] = Array.from({ length: totalVizChunks }, (_, i) => ({
        index: i,
        status: 'pending' as const,
      }));

      setState({
        ...INITIAL_STATE,
        status: 'creating',
        chunks,
      });

      const apiKey = getStoredApiKey();
      if (!apiKey) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'Please set an API key first.',
        }));
        return;
      }

      try {
        const { Upload } = await import('tus-js-client');
        const startTime = Date.now();
        let videoAssetId: string | null = null;
        setState((s) => ({ ...s, status: 'uploading' }));

        const upload = new Upload(file, {
          endpoint: TUS_ENDPOINT,
          headers: { Authorization: `Bearer ${apiKey}` },
          metadata: {
            filename: file.name,
            filetype: file.type,
            title: metadata.title,
            description: metadata.description,
            accessTier: metadata.access_tier,
            ...(metadata.creator_address ? { creatorAddress: metadata.creator_address } : {}),
            ...(metadata.initial_viewer_addresses ? { initialViewerAddresses: metadata.initial_viewer_addresses } : {}),
          },
          chunkSize: CHUNK_SIZE,
          retryDelays: [0, 3000, 5000, 10000],

          onAfterResponse: (
            _req: unknown,
            res: { getHeader: (name: string) => string | undefined },
          ) => {
            // Capture session ID from TUS Location header
            const location = res.getHeader('Location');
            if (location && !upload.url) {
              const parts = location.split('/');
              const sessionId = parts[parts.length - 1];
              if (sessionId) {
                setState((s) => ({
                  ...s,
                  uploadUrl: location,
                  uploadSessionId: sessionId,
                }));
              }
            }

            if (videoAssetId) return;

            // Extract videoAssetId from Upload-Metadata header
            const metaHeader = res.getHeader('Upload-Metadata');
            if (metaHeader) {
              const pairs = metaHeader.split(',').map((p: string) => p.trim());
              for (const pair of pairs) {
                const [key, b64val] = pair.split(' ');
                if (key === 'videoAssetId' && b64val) {
                  try {
                    videoAssetId = atob(b64val);
                    setState((s) => ({ ...s, videoAssetId }));
                  } catch (err) {
                    console.error('[useUpload] Failed to decode videoAssetId from Upload-Metadata header:', err);
                  }
                }
              }
            }
          },

          onProgress: (bytesUploaded: number, bytesTotal: number) => {
            const progress = (bytesUploaded / bytesTotal) * 100;
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? bytesUploaded / elapsed : 0;

            const completedViz = Math.floor(bytesUploaded / VIZ_CHUNK_SIZE);
            const activeIdx =
              completedViz < totalVizChunks ? completedViz : totalVizChunks - 1;

            setState((s) => ({
              ...s,
              progress,
              speed,
              chunks: s.chunks.map((c) => {
                if (c.index < completedViz)
                  return { ...c, status: 'complete' as const };
                if (c.index === activeIdx)
                  return { ...c, status: 'uploading' as const };
                return { ...c, status: 'pending' as const };
              }),
            }));
          },

          onSuccess: async () => {
            setState((s) => ({
              ...s,
              status: 'processing',
              progress: 100,
              chunks: s.chunks.map((c) => ({ ...c, status: 'complete' as const })),
            }));

            // Fallback: try HEAD to get videoAssetId if not captured yet
            if (!videoAssetId && upload.url) {
              try {
                const headRes = await fetch(upload.url, {
                  method: 'HEAD',
                  headers: {
                    'Tus-Resumable': '1.0.0',
                    Authorization: `Bearer ${apiKey}`,
                  },
                });
                const metaHeader = headRes.headers.get('Upload-Metadata');
                if (metaHeader) {
                  for (const pair of metaHeader
                    .split(',')
                    .map((p: string) => p.trim())) {
                    const [key, b64val] = pair.split(' ');
                    if (key === 'videoAssetId' && b64val) {
                      videoAssetId = atob(b64val);
                      setState((s) => ({ ...s, videoAssetId }));
                    }
                  }
                }
              } catch (err) {
                console.error('[useUpload] HEAD fallback for videoAssetId failed:', err);
              }
            }

            // Last resort: fetch most recent asset and match by title.
            // NOTE: This is fragile with concurrent uploads. If two uploads
            // finish at the same time, the wrong asset could be matched.
            // Prefer extracting the asset ID from TUS response headers
            // (onAfterResponse / HEAD fallback above) whenever possible.
            if (!videoAssetId) {
              try {
                const list = await apiClient.get<{
                  data: VideoAsset[];
                }>('/assets?page=1&limit=5');
                // Try to find the asset by matching the title we uploaded
                const uploadTitle = metadata.title || file.name;
                const matched = list.data.find(
                  (a) => a.title === uploadTitle,
                );
                if (matched) {
                  videoAssetId = matched.id;
                  setState((s) => ({ ...s, videoAssetId }));
                } else if (list.data.length > 0) {
                  // Fall back to most recent if title match fails
                  videoAssetId = list.data[0].id;
                  setState((s) => ({ ...s, videoAssetId }));
                }
              } catch (err) {
                console.error('[useUpload] Last-resort asset lookup failed:', err);
              }
            }

            if (!videoAssetId) {
              setState((s) => ({ ...s, status: 'complete' }));
              return;
            }

            // Poll for processing completion
            const assetId = videoAssetId;
            pollRef.current = setInterval(async () => {
              try {
                // Fetch processing progress
                try {
                  const job = await apiClient.get<{
                    id: string;
                    status: string;
                    progress_percent: number;
                    error_message: string | null;
                    logs: ProcessingLogEntry[];
                  }>(`/assets/${assetId}/processing`);
                  let stage: string | null = null;
                  if (job.progress_percent <= 60) stage = 'Transcoding';
                  else if (job.progress_percent <= 65) stage = 'Extracting thumbnails';
                  else if (job.progress_percent <= 90) stage = 'Uploading to Sia';
                  else stage = 'Finalizing';
                  setState((s) => ({
                    ...s,
                    processingProgress: job.progress_percent,
                    processingStage: stage,
                    processingLogs: job.logs ?? [],
                  }));
                } catch (err) {
                  if (err instanceof ApiError && err.status === 404) {
                    // Job not created yet - expected, continue polling
                  } else {
                    console.error('[useUpload] Processing progress check failed:', err);
                  }
                }

                const asset = await apiClient.get<VideoAsset>(`/assets/${assetId}`);
                if (asset.status === 'ready') {
                  if (pollRef.current) clearInterval(pollRef.current);
                  pollRef.current = null;
                  setState((s) => ({
                    ...s,
                    status: 'complete',
                    asset,
                    processingProgress: 100,
                  }));
                } else if (asset.status === 'failed') {
                  if (pollRef.current) clearInterval(pollRef.current);
                  pollRef.current = null;
                  setState((s) => ({
                    ...s,
                    status: 'error',
                    error: 'Video processing failed',
                  }));
                }
              } catch (err) {
                if (err instanceof ApiError && err.status === 404) {
                  // Job not created yet - expected, continue polling
                } else {
                  if (pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                  }
                  setState(s => ({ ...s, error: err instanceof Error ? err.message : 'Processing status check failed' }));
                }
              }
            }, POLL_INTERVAL);
          },

          onError: (err: Error) => {
            setState((s) => ({
              ...s,
              status: 'error',
              error: err.message ?? 'Upload failed',
              chunks: s.chunks.map((c) =>
                c.status === 'uploading'
                  ? { ...c, status: 'error' as const }
                  : c,
              ),
            }));
          },
        });

        tusRef.current = upload;

        // Capture existing URL if resuming
        if (upload.url) {
          const parts = upload.url.split('/');
          const sessionId = parts[parts.length - 1];
          if (sessionId) {
            setState((s) => ({
              ...s,
              uploadUrl: upload.url,
              uploadSessionId: sessionId,
            }));
          }
        }

        upload.start();
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [],
  );

  const cancelUpload = useCallback(async () => {
    if (tusRef.current?.abort) tusRef.current.abort();
    tusRef.current = null;

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    const sessionId = state.uploadSessionId;
    if (sessionId) {
      try {
        await apiClient.delete(`/uploads/${sessionId}`);
      } catch (err) {
        console.error('[useUpload] Failed to delete upload session on cancel:', err);
      }
    }

    setState((s) => ({
      ...s,
      status: 'error',
      error: 'Upload cancelled',
      chunks: s.chunks.map((c) =>
        c.status === 'uploading' ? { ...c, status: 'error' as const } : c,
      ),
    }));
  }, [state.uploadSessionId]);

  const reset = useCallback(() => {
    if (tusRef.current?.abort) tusRef.current.abort();
    tusRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setState(INITIAL_STATE);
  }, []);

  return {
    state,
    progress: state.progress,
    speed: state.speed,
    asset: state.asset,
    error: state.error,
    startUpload,
    cancelUpload,
    reset,
  };
}
