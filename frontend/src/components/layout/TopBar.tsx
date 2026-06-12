import { useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

function getBreadcrumbs(pathname: string): Array<{ label: string; path?: string }> {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: Array<{ label: string; path?: string }> = [];

  if (segments[0] === 'studio') {
    crumbs.push({ label: 'Studio', path: '/studio' });
    if (segments[1]) {
      const labels: Record<string, string> = {
        upload: 'Upload',
        assets: 'Assets',
        player: 'Player',
        'access-control': 'Access Control',
        developer: 'Developer',
        analytics: 'Analytics',
        sponsorship: 'Sponsorship',
        settings: 'Settings',
      };
      const label = labels[segments[1]] || segments[1];
      crumbs.push({ label, path: `/studio/${segments[1]}` });

      if (segments[2] && segments[1] === 'assets') {
        crumbs.push({ label: segments[2] });
      }
    }
  }

  return crumbs;
}

export function TopBar() {
  const location = useLocation();
  const breadcrumbs = getBreadcrumbs(location.pathname);

  return (
    <header className="h-14 flex items-center px-6 border-b border-white/[0.06] bg-[#0a0a0f]/60 backdrop-blur-md">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1 text-sm min-w-0 overflow-hidden">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1 min-w-0 shrink-0 last:shrink">
            {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />}
            <span
              className={cn(
                'transition-colors duration-150 truncate',
                i === breadcrumbs.length - 1
                  ? 'text-[#f0f0f0] font-medium'
                  : 'text-zinc-500 hover:text-zinc-400',
              )}
            >
              {crumb.label}
            </span>
          </span>
        ))}
      </nav>
    </header>
  );
}
