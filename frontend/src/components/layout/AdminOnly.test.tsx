import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { AdminOnly } from './AdminOnly';

const renderAs = (admin: boolean) =>
  renderPage(
    <WithSession admin={admin}>
      <AdminOnly>
        <p>Deployment page</p>
      </AdminOnly>
    </WithSession>,
  );

describe('AdminOnly', () => {
  it('shows the page to an admin', () => {
    renderAs(true);
    expect(screen.getByText('Deployment page')).toBeInTheDocument();
  });

  it('tells a member why instead of showing it', () => {
    renderAs(false);
    expect(screen.queryByText('Deployment page')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'For admins only' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Members, health and metrics are for the admins of this server. Ask an admin if you need them.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute(
      'href',
      '/studio',
    );
  });
});
