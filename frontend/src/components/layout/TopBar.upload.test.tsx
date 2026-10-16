import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { TopBar } from './TopBar';

// P3's UploadIndicator always renders the top bar's "Upload video" button;
// stand it in, so the test pins what TopBar itself adds: no second one
vi.mock('./UploadIndicator', () => ({
  UploadIndicator: () => <button type="button">Upload video</button>,
}));

describe('TopBar upload control', () => {
  it.each(['/studio', '/studio/videos', '/studio/settings', '/studio/videos/a1'])(
    'has exactly one Upload video button on %s, the indicator’s',
    (route) => {
      renderPage(
        <WithSession>
          <SidebarProvider>
            <TopBar />
          </SidebarProvider>
        </WithSession>,
        { route },
      );
      expect(screen.getAllByRole('button', { name: /upload video/i })).toHaveLength(1);
    },
  );
});
