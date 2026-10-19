import '@/index.css';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import SettingsPage from './SettingsPage';

// loaded by a specifier typescript does not follow, as in Sidebar.browser.test:
// its types redeclare jest-dom's matchers for the whole project
const browser = () =>
  import('vitest/browser' as string) as Promise<{
    page: { viewport(width: number, height: number): Promise<void> };
  }>;

const sessions = [
  {
    id: 's1',
    user_agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    created_at: '2026-10-10T09:00:00Z',
    expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    last_seen_at: new Date().toISOString(),
    current: true,
  },
  {
    id: 's2',
    user_agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    created_at: '2026-10-04T09:00:00Z',
    expires_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
    last_seen_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    current: false,
  },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(input).endsWith('/auth/config')
            ? {
                auth_disabled: false,
                setup_required: false,
                methods: { password: true, github: true },
              }
            : { data: sessions },
        ),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function draw(width: number) {
  await (await browser()).page.viewport(width, 1000);
  renderPage(
    <WithSession
      admin
      name="Mert Köklü"
      username="justmert"
      signIn={[
        { provider: 'password', username: 'mert@example.com' },
        { provider: 'github', username: 'justmert' },
      ]}
    >
      <SettingsPage />
    </WithSession>,
  );
  await screen.findByText('Safari on iPhone');
}

const parts = (name: string) => {
  const section = screen.getByRole('region', { name });
  return {
    label: section.firstElementChild!.getBoundingClientRect(),
    content: section.lastElementChild!.getBoundingClientRect(),
  };
};

describe('Settings in a real browser', () => {
  it('puts each label column beside its content at 1440 px', async () => {
    await draw(1440);
    for (const name of ['Account', 'Sign-in methods', 'Signed-in browsers', 'Appearance']) {
      const { label, content } = parts(name);
      expect(Math.round(label.top)).toBe(Math.round(content.top));
      expect(label.right).toBeLessThanOrEqual(content.left);
      // the label column stays within 280 px
      expect(label.width).toBeLessThanOrEqual(280);
    }
    // the chosen theme card has a 2px edge
    const system = screen.getByRole('radio', { name: 'System' }).closest('label')!;
    expect(getComputedStyle(system).borderTopWidth).toBe('2px');
    const light = screen.getByRole('radio', { name: 'Light' }).closest('label')!;
    expect(getComputedStyle(light).borderTopWidth).toBe('1px');
  });

  it('stacks the label over its content at phone width without scrolling sideways', async () => {
    await draw(390);
    for (const name of ['Account', 'Sign-in methods', 'Signed-in browsers', 'Appearance']) {
      const { label, content } = parts(name);
      expect(content.top).toBeGreaterThanOrEqual(label.bottom);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });
});
