import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { TopBar } from './TopBar';

// the design's header has no upload button of its own on a wide screen: the
// sidebar's primary button is the way in. only the phone header adds one,
// as the phone board does, and the upload progress ring adds none
describe('TopBar upload control', () => {
  it.each(['/studio', '/studio/videos', '/studio/settings', '/studio/videos/a1'])(
    'has exactly one Upload video link on %s, for phones only',
    (route) => {
      renderPage(
        <WithSession>
          <SidebarProvider>
            <TopBar />
          </SidebarProvider>
        </WithSession>,
        { route },
      );
      const links = screen.getAllByRole('link', { name: /upload video/i });
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveClass('sm:hidden');
      expect(screen.queryByRole('button', { name: /upload video/i })).not.toBeInTheDocument();
    },
  );
});
