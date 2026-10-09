import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { UploadSheet } from './UploadSheet';

// the panel's chunk cannot be fetched, for example offline
vi.mock('./StudioUploadPanel', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(jsonFetch({})));
});
afterEach(() => vi.unstubAllGlobals());

describe('UploadSheet when its panel cannot load', () => {
  it('still opens, says so and offers Try again', async () => {
    renderPage(
      <WithSession>
        <UploadSheet />
      </WithSession>,
      { route: '/studio/videos?upload=1' },
    );
    expect(await screen.findByRole('dialog', { name: 'Upload videos' })).toBeInTheDocument();
    expect(screen.getByText('Could not load the upload sheet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
