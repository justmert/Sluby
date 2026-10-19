import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionProvider } from '@/components/motion/MotionProvider';
import { createQueryClient } from '@/lib/query-client';
import { AuthGate } from './AuthGate';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// the session check says no; the config the sign-in screen reads alongside it says how
const answer = (input: RequestInfo | URL) =>
  String(input).endsWith('/auth/config')
    ? json(
        { auth_disabled: false, setup_required: false, methods: { password: true, github: true } },
        200,
      )
    : json({ error: 'Not signed in' }, 401);

// FLW-01: when /auth/me answered 401 within the first frames, the loading
// screen's exit never finished and the sign-in button never mounted
describe('AuthGate signed out, in a real browser', () => {
  it('shows the sign-in form on every load, however fast the 401 is', async () => {
    let hangs = 0;
    for (let i = 0; i < 30; i++) {
      const delay = i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 16;
      vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
        delay < 0
          ? Promise.resolve(answer(input))
          : new Promise<Response>((r) => setTimeout(() => r(answer(input)), delay)),
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
        .poll(
          () =>
            document.querySelector('input[type=email]') !== null &&
            document.querySelector('input[autocomplete=current-password]') !== null &&
            (document.body.textContent?.includes('Continue with GitHub') ?? false),
          { timeout: 2000 },
        )
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
