export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptime: number;
  timestamp: string;
}

export interface MetricsResponse {
  totalAssets: number;
  totalUploads: number;
  activeStreams: number;
  storageUsed: number;
  cacheHitRate: number;
  totalRequests: number;
  avgResponseTime: number;
  bandwidth: number;
}
