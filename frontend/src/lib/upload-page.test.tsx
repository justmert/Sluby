import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { isUploadPage, onPendingFiles, takePendingFiles, useOpenUpload } from './upload-page';

function Probe() {
  const open = useOpenUpload();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="where">{location.pathname + location.search + location.hash}</p>
      <button onClick={() => open()}>open</button>
      <button onClick={() => open([new File(['a'], 'a.mp4'), new File(['b'], 'b.mp4')])}>
        drop
      </button>
      <button onClick={() => void navigate(-1)}>back</button>
    </>
  );
}

const renderAt = (entries: string[]) =>
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Probe />
    </MemoryRouter>,
  );

const where = () => screen.getByTestId('where').textContent;

afterEach(() => {
  takePendingFiles();
});

describe('useOpenUpload', () => {
  it('goes to the upload page as a new history entry, so Back returns', async () => {
    renderAt(['/studio/videos?status=ready']);
    await userEvent.click(screen.getByText('open'));
    expect(where()).toBe('/studio/videos/upload');
    await userEvent.click(screen.getByText('back'));
    expect(where()).toBe('/studio/videos?status=ready');
  });

  it('parks dropped files until the upload page takes them, once', async () => {
    renderAt(['/studio/videos']);
    const listener = vi.fn();
    const off = onPendingFiles(listener);
    await userEvent.click(screen.getByText('drop'));
    expect(where()).toBe('/studio/videos/upload');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(takePendingFiles().map((f) => f.name)).toEqual(['a.mp4', 'b.mp4']);
    expect(takePendingFiles()).toEqual([]);
    off();
  });

  it('adds files on the upload page without another history entry', async () => {
    renderAt(['/studio', '/studio/videos/upload']);
    await userEvent.click(screen.getByText('drop'));
    expect(takePendingFiles()).toHaveLength(2);
    expect(where()).toBe('/studio/videos/upload');
    await userEvent.click(screen.getByText('back'));
    expect(where()).toBe('/studio');
  });
});

describe('isUploadPage', () => {
  it('matches the upload page with or without a trailing slash, and nothing else', () => {
    expect(isUploadPage('/studio/videos/upload')).toBe(true);
    expect(isUploadPage('/studio/videos/upload/')).toBe(true);
    expect(isUploadPage('/studio/videos')).toBe(false);
    expect(isUploadPage('/studio/videos/a1')).toBe(false);
  });
});
