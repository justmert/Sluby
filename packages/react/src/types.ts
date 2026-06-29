export interface QualityLevel {
  index: number;
  width: number;
  height: number;
  bitrate: number;
  name: string;
}

export interface SlubyPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  controls?: boolean;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  onQualityChange?: (level: QualityLevel) => void;
}

export interface UseVideoReturn {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setQuality: (levelIndex: number) => void;
  qualities: QualityLevel[];
  currentQuality: QualityLevel | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  setVolume: (vol: number) => void;
}
