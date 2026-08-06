import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/cn';
import { STUDIO_NAV } from '@/lib/constants';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Auto-collapse when switching to mobile
  useEffect(() => {
    if (isMobile) {
      setCollapsed(true);
    }
  }, [isMobile]);

  const navItems = STUDIO_NAV;

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isMobile && !collapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setCollapsed(true)}
        />
      )}

      {/* Mobile hamburger button */}
      {isMobile && collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed top-3 left-3 z-50 flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-900/90 border border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors shadow-lg"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      <aside
        className={cn(
          'flex flex-col h-screen bg-[#0a0a0f]/95 backdrop-blur-2xl border-r border-white/[0.04] transition-all duration-300 ease-out',
          collapsed ? 'w-16' : 'w-[260px]',
          isMobile && 'fixed z-50 top-0 left-0',
          isMobile && collapsed && '-translate-x-full',
        )}
      >
        {/* Header */}
        <div className="p-3">
          <AnimatePresence mode="wait">
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2.5 mb-4 px-2 pt-1"
              >
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
                  <span className="text-white text-sm font-bold">S</span>
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-zinc-100 block leading-tight font-heading">
                    Sluby
                  </span>
                  <span className="text-[10px] text-zinc-600 block leading-tight">
                    Studio Platform
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Section label */}
        <div className={cn('px-4 pt-2 pb-1.5', collapsed && 'px-2')}>
          {!collapsed && (
            <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              Studio
            </span>
          )}
          {collapsed && <div className="h-px bg-white/[0.08] mx-1" />}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
          <div className="space-y-0.5">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/studio'}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'text-teal-400 bg-teal-500/[0.08]'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.div
                        layoutId="nav-active"
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-r-full bg-teal-500"
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                      />
                    )}
                    <item.icon
                      className={cn(
                        'h-4 w-4 shrink-0 transition-colors duration-150',
                        isActive ? 'text-teal-400' : 'text-zinc-500 group-hover:text-zinc-400',
                      )}
                    />
                    <AnimatePresence mode="wait">
                      {!collapsed && (
                        <motion.span
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: 'auto' }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={{ duration: 0.15 }}
                          className="whitespace-nowrap overflow-hidden"
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="relative z-10 p-2 border-t border-white/[0.06]">
          <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-end')}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-label={
                collapsed ? 'Expand sidebar' : isMobile ? 'Close sidebar' : 'Collapse sidebar'
              }
              className="flex items-center justify-center w-8 h-8 rounded-lg text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.05] transition-all duration-200"
            >
              {isMobile ? (
                collapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )
              ) : collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronLeft className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
