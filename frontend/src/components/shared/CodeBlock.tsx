import { useState } from 'react';
import { cn } from '@/lib/cn';
import { CopyButton } from './CopyButton';

export interface CodeBlockProps {
  variants: Record<string, string>;
  title?: string;
  className?: string;
}

export function CodeBlock({ variants, title, className }: CodeBlockProps) {
  const tabs = Object.keys(variants);
  const [activeTab, setActiveTab] = useState(tabs[0] ?? '');

  const activeCode = variants[activeTab] ?? '';

  return (
    <div className={cn('rounded-xl border border-white/[0.08] overflow-hidden backdrop-blur-sm', className)}>
      {title && (
        <div className="px-4 py-2.5 text-xs font-medium text-zinc-400 bg-white/[0.02] border-b border-white/[0.08]">
          {title}
        </div>
      )}
      <div className="flex items-center justify-between bg-white/[0.02] border-b border-white/[0.08] px-2">
        <div className="flex gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-3 py-2.5 text-xs font-medium transition-all duration-200 relative',
                activeTab === tab
                  ? 'text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {tab}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-gradient-to-r from-teal-500 to-teal-400" />
              )}
            </button>
          ))}
        </div>
        <CopyButton value={activeCode} />
      </div>
      <div className="bg-[#0a0a0f]/80 p-4 overflow-x-auto">
        <pre className="font-mono text-xs text-zinc-300 leading-relaxed whitespace-pre">
          {activeCode}
        </pre>
      </div>
    </div>
  );
}
