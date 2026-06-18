import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/lib/theme';
import { ApiKeyProvider } from '@/lib/api-key-provider';
import { AuthGate } from '@/components/AuthGate';
import { App } from '@/App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
    mutations: {
      onError: (error: Error) => {
        console.error('Mutation failed:', error);
      },
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <AuthGate>
        <QueryClientProvider client={queryClient}>
          <ApiKeyProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ApiKeyProvider>
        </QueryClientProvider>
      </AuthGate>
    </ThemeProvider>
  </StrictMode>,
);
