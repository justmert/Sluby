import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  Clapperboard,
  CloudUpload,
  Code,
  Cog,
  Copy,
  KeyRound,
  Link2,
  MemoryStick,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  SquarePlay,
  Timer,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';

/*
 * one icon per concept, so the same thing looks the same on every page and
 * no icon means two things (visual audit VIS-22). error is CircleAlert
 * everywhere, TriangleAlert is only for warnings.
 */
export const Icons = {
  video: SquarePlay,
  upload: Upload,
  storeOnSia: CloudUpload,
  processing: Cog,
  memory: MemoryStick,
  uptime: Timer,
  playtime: Clapperboard,
  apiKey: KeyRound,
  /** a pulse line: a webhook is the stream of events a server sends out */
  webhook: Activity,
  error: CircleAlert,
  warning: TriangleAlert,
  open: ArrowUpRight,
  copy: Copy,
  delete: Trash2,
  /** watch a video in place, without leaving the page */
  preview: Play,
  /** copy code that plays a video on another site */
  embed: Code,
  /** copy a url, such as a stream URL */
  link: Link2,
  /** retry a failed thing */
  retry: RotateCcw,
  /** rotate a key */
  rotate: RotateCw,
  /** run a check again now */
  refresh: RefreshCw,
} as const;
