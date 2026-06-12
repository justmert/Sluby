export type VideoStatus = 'created' | 'uploading' | 'processing' | 'ready' | 'failed';

export type AccessTier = 'public' | 'private';

export interface VideoAsset {
  id: string;
  title: string;
  description?: string;
  status: VideoStatus;
  accessTier: AccessTier;
  creatorAddress?: string;
  duration?: number;
  resolution?: string;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  thumbnailObjectIds?: string[];
  playbackUrl?: string;
  manifestObjectId?: string;
  segmentCount?: number;
  totalStorage?: number;
  createdAt: string;
  updatedAt: string;
}

export type UploadStatus = 'idle' | 'creating' | 'uploading' | 'processing' | 'complete' | 'error';

export interface UploadSession {
  id: string;
  assetId: string;
  status: UploadStatus;
  progress: number;
  bytesUploaded: number;
  bytesTotal: number;
  uploadUrl: string;
  error?: string;
}

export type JobStatus = 'queued' | 'running' | 'complete' | 'failed';

export interface ProcessingJob {
  id: string;
  assetId: string;
  status: JobStatus;
  progress: number;
  stage?: string;
  error?: string;
  renditions?: RenditionStatus[];
}

export interface RenditionStatus {
  quality: string;
  width: number;
  height: number;
  bitrate: string;
  status: JobStatus;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimit: number;
  createdAt: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  createdAt: string;
}

export type WebhookEvent =
  | 'upload.started'
  | 'upload.completed'
  | 'upload.failed'
  | 'processing.started'
  | 'processing.progress'
  | 'asset.ready'
  | 'asset.errored';

export interface AllowlistEntry {
  id: string;
  name: string;
  videoId: string;
  members: string[];
  createdAt: string;
}

export interface PlaybackInfo {
  url: string;
  format: string;
  accessTier: AccessTier;
}

export interface SignedPlaybackInfo extends PlaybackInfo {
  signedUrl: string;
  expiresAt: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalEntries: number;
  cacheSize: number;
}
