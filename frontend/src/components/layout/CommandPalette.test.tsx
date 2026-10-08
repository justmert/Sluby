import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, type RecordedCall } from '@/test/render';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { CommandPalette } from './CommandPalette';

function asset(id: string, title: string, status = 'ready') {
  return {
    id,
    title,
    description: '',
    manifest_object_id: 'm',
    thumbnail_object_ids: [],
    duration_ms: 90_000,
    resolution: '1280x720',
    status,
    access_tier: 'public',
    creator_address: 'github:dev',
    segment_count: 1,
    total_storage_bytes: 2048,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };
}

const library = [asset('a1', 'Big Buck Bunny'), asset('a2', 'Sintel', 'processing')];

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function setup(operator = false) {
  const server = jsonFetch({
    '/api/v1/assets': ({ query }: RecordedCall) => {
      const q = (query.get('search') ?? '').toLowerCase();
      const data = library.filter((a) => a.title.toLowerCase().includes(q) || a.id === q);
      return { data, total: data.length, page: 1, limit: 5, next_cursor: null };
    },
  });
  vi.stubGlobal('fetch', vi.fn(server));
  renderPage(
    <WithSession operator={operator}>
      <CommandPalette />
      <Where />
    </WithSession>,
    { route: '/studio' },
  );
  return server;
}

afterEach(() => vi.unstubAllGlobals());

const openWithKeys = () => userEvent.keyboard('{Control>}k{/Control}');

describe('CommandPalette', () => {
  it('opens on ctrl+k with the search focused and recent videos listed', async () => {
    setup();
    await openWithKeys();
    const dialog = await screen.findByRole('dialog', { name: 'Search and commands' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /search videos/i })).toHaveFocus();
    expect(await screen.findByRole('option', { name: /Big Buck Bunny/ })).toBeInTheDocument();
    expect(screen.getByText('Recent videos')).toBeInTheDocument();
  });

  it('opens from the top bar button and jumps to a page', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Search and commands' }));
    await userEvent.type(screen.getByRole('combobox'), 'sett');
    await userEvent.click(await screen.findByRole('option', { name: 'Settings' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/settings');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('leaves out operator pages for a tenant', async () => {
    setup(false);
    await openWithKeys();
    await screen.findByRole('dialog');
    expect(screen.queryByRole('option', { name: 'Analytics' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Assets' })).toBeInTheDocument();
  });

  it('finds a video on the server and opens it with the keyboard', async () => {
    const server = setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'sintel');
    await waitFor(() =>
      expect(server.calls.some((c) => c.query.get('search') === 'sintel')).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Big Buck Bunny/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('option', { name: /Sintel/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/assets/a2');
  });

  it('switches the theme', async () => {
    setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'light');
    await userEvent.click(await screen.findByRole('option', { name: 'Use light theme' }));
    expect(document.documentElement).toHaveClass('light');
    expect(localStorage.getItem('sluby-theme')).toBe('light');
  });

  it('says when nothing matches', async () => {
    setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'zzzz');
    expect(await screen.findByText('Nothing matches “zzzz”.')).toBeInTheDocument();
  });
});
