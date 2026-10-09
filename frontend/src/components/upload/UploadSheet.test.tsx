import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { useUploadSheet } from '@/lib/upload-sheet';
import { UploadSheet } from './UploadSheet';

function Opener() {
  const sheet = useUploadSheet();
  const { pathname, search } = useLocation();
  return (
    <>
      <p data-testid="where">{pathname + search}</p>
      <button
        onClick={() =>
          sheet.open([new File(['x'], 'clip.mp4', { type: 'video/mp4' }), new File(['y'], 'a.txt')])
        }
      >
        drop
      </button>
      <button onClick={() => sheet.open()}>open</button>
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      jsonFetch({
        '/api/v1/assets': { data: [], total: 0 },
        'OPTIONS /api/v1/uploads': () =>
          new Response(null, { status: 204, headers: { 'Tus-Max-Size': '10737418240' } }),
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderAt = (route: string) =>
  renderPage(
    <WithSession>
      <Opener />
      <UploadSheet />
    </WithSession>,
    { route },
  );

describe('UploadSheet', () => {
  it('is open while the url says ?upload=1', async () => {
    renderAt('/studio/videos?upload=1');
    expect(await screen.findByRole('dialog', { name: 'Upload videos' })).toBeInTheDocument();
    expect(await screen.findByText(/drop videos here/i)).toBeInTheDocument();
  });

  it('stays closed without it', () => {
    renderAt('/studio/videos');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('takes dropped files as drafts and says which ones are not videos', async () => {
    renderAt('/studio');
    await userEvent.click(screen.getByText('drop'));
    expect(await screen.findByDisplayValue('clip')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('a.txt is not a video file.');
  });

  it('closes by dropping the param', async () => {
    renderAt('/studio/videos?view=grid&upload=1');
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/videos?view=grid');
  });

  it('starts on choose files', async () => {
    renderAt('/studio');
    const opener = screen.getByText('open');
    opener.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Upload videos' });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /drop videos here, or choose files/i }),
      ).toHaveFocus(),
    );
  });
});
