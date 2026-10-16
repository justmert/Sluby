import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { AppSidebar } from './Sidebar';

const render = (operator: boolean) =>
  renderPage(
    <WithSession operator={operator}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </WithSession>,
    { route: '/studio' },
  );

describe('AppSidebar', () => {
  it('leaves the operator-only analytics out for a tenant', () => {
    render(false);
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Analytics' })).not.toBeInTheDocument();
  });

  it('shows analytics to an operator', () => {
    render(true);
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute(
      'href',
      '/studio/analytics',
    );
  });
});
