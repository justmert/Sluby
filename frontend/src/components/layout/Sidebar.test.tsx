import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { AppSidebar } from './Sidebar';

const render = (operator: boolean, route = '/studio') =>
  renderPage(
    <WithSession operator={operator}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </WithSession>,
    { route },
  );

const nav = () => within(screen.getByRole('navigation', { name: 'Studio' }));

describe('AppSidebar', () => {
  it('lists the pages in their groups, without deployment for a member', () => {
    render(false);
    expect(nav().getByText('Developers')).toBeInTheDocument();
    expect(nav().queryByText('Deployment')).not.toBeInTheDocument();
    expect(
      nav()
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Overview', '/studio'],
      ['Videos', '/studio/videos'],
      ['Quickstart', '/studio/developers'],
      ['API keys', '/studio/developers/keys'],
      ['Webhooks', '/studio/developers/webhooks'],
      ['API explorer', '/studio/developers/explorer'],
      ['Settings', '/studio/settings'],
    ]);
  });

  it('shows health and metrics to an operator', () => {
    render(true);
    expect(nav().getByText('Deployment')).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Health' })).toHaveAttribute(
      'href',
      '/studio/deployment',
    );
    expect(nav().getByRole('link', { name: 'Metrics' })).toHaveAttribute(
      'href',
      '/studio/deployment/metrics',
    );
  });

  it('marks only the page itself current, and a detail page under its list', () => {
    render(true, '/studio/developers/keys');
    expect(nav().getByRole('link', { name: 'API keys' })).toHaveAttribute('aria-current', 'page');
    expect(nav().getByRole('link', { name: 'Quickstart' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the list current on a detail page', () => {
    render(false, '/studio/developers/webhooks/w1');
    expect(nav().getByRole('link', { name: 'Webhooks' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks health current only on its own path', () => {
    render(true, '/studio/deployment/metrics');
    expect(nav().getByRole('link', { name: 'Metrics' })).toHaveAttribute('aria-current', 'page');
    expect(nav().getByRole('link', { name: 'Health' })).not.toHaveAttribute('aria-current');
  });
});
