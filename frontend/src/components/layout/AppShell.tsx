import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Toaster } from '@/components/ui/toaster';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0f]">
      <Sidebar />
      <div className="relative z-10 flex-1 flex flex-col min-w-0 transition-all duration-300 ease-out">
        <TopBar />
        <main className="flex-1 overflow-y-auto scroll-smooth">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
