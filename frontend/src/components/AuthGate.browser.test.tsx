import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionProvider } from '@/components/motion/MotionProvider';
import { createQueryClient } from '@/lib/query-client';
import { AuthGate } from './AuthGate';

afterEach(() => vi.unstubAllGlobals());

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'Not signed in' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

// FLW-01: when /auth/me answered 401 within the first frames, the loading
// screen's exit never finished and the sign-in button never mounted
describe('AuthGate signed out, in a real browser', () => {
  it('shows "Continue with GitHub" on every load, however fast the 401 is', async () => {
    let hangs = 0;
    for (let i = 0; i < 30; i++) {
      const delay = i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 16;
      vi.stubGlobal('fetch', () =>
        delay < 0
          ? Promise.resolve(unauthorized())
          : new Promise<Response>((r) => setTimeout(() => r(unauthorized()), delay)),
      );
      const view = render(
        // as main.tsx renders it: strict mode, and motion's features loading
        // on demand, which is what the loading screen's exit waited on
        <StrictMode>
          <MotionProvider>
            <QueryClientProvider client={createQueryClient()}>
              <AuthGate>
                <p>signed in</p>
              </AuthGate>
            </QueryClientProvider>
          </MotionProvider>
        </StrictMode>,
      );
      const shown = await expect
        .poll(() => document.body.textContent?.includes('Continue with GitHub') ?? false, {
          timeout: 2000,
        })
        .toBe(true)
        .then(
          () => true,
          () => false,
        );
      if (!shown) hangs++;
      view.unmount();
    }
    expect(hangs).toBe(0);
  });
});
