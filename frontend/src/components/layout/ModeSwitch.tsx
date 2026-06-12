import { useNavigate, useLocation } from 'react-router-dom';
import { Monitor, Eye } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export type AppMode = 'studio' | 'watch';

export function ModeSwitch({ collapsed }: { collapsed?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();

  const currentMode: AppMode = location.pathname.startsWith('/watch') ? 'watch' : 'studio';

  const switchMode = (mode: AppMode) => {
    if (mode === currentMode) return;
    navigate(mode === 'studio' ? '/studio' : '/watch');
  };

  if (collapsed) {
    return (
      <div className="flex flex-col gap-1 px-1">
        <button
          onClick={() => switchMode('studio')}
          className={cn(
            'relative flex items-center justify-center h-9 w-full rounded-lg transition-all duration-200',
            currentMode === 'studio'
              ? 'text-teal-400'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]',
          )}
        >
          {currentMode === 'studio' && (
            <motion.div
              layoutId="mode-pill"
              className="absolute inset-0 rounded-lg bg-teal-500/[0.12] border border-teal-500/20"
              transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
            />
          )}
          <Monitor className="h-4 w-4 relative z-10" />
        </button>
        <button
          onClick={() => switchMode('watch')}
          className={cn(
            'relative flex items-center justify-center h-9 w-full rounded-lg transition-all duration-200',
            currentMode === 'watch'
              ? 'text-teal-400'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]',
          )}
        >
          {currentMode === 'watch' && (
            <motion.div
              layoutId="mode-pill"
              className="absolute inset-0 rounded-lg bg-teal-500/[0.12] border border-teal-500/20"
              transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
            />
          )}
          <Eye className="h-4 w-4 relative z-10" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-0 p-1 rounded-xl bg-white/[0.03] border border-white/[0.08]">
      <button
        onClick={() => switchMode('studio')}
        className={cn(
          'relative flex items-center gap-2 flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 z-10',
          currentMode === 'studio'
            ? 'text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-300',
        )}
      >
        {currentMode === 'studio' && (
          <motion.div
            layoutId="mode-active"
            className="absolute inset-0 rounded-lg bg-white/[0.07] border border-white/[0.08] shadow-sm"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
          />
        )}
        <Monitor className="h-3.5 w-3.5 relative z-10" />
        <span className="relative z-10">Studio</span>
      </button>
      <button
        onClick={() => switchMode('watch')}
        className={cn(
          'relative flex items-center gap-2 flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 z-10',
          currentMode === 'watch'
            ? 'text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-300',
        )}
      >
        {currentMode === 'watch' && (
          <motion.div
            layoutId="mode-active"
            className="absolute inset-0 rounded-lg bg-white/[0.07] border border-white/[0.08] shadow-sm"
            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
          />
        )}
        <Eye className="h-3.5 w-3.5 relative z-10" />
        <span className="relative z-10">Watch</span>
      </button>
    </div>
  );
}
