import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SidebarProvider, SidebarTrigger, useSidebar } from './sidebar';

function State() {
  return <span data-testid="state">{useSidebar().state}</span>;
}

describe('SidebarProvider', () => {
  it('toggles without writing a cookie', async () => {
    document.cookie = 'sidebar_state=; max-age=0; path=/';
    render(
      <SidebarProvider>
        <SidebarTrigger />
        <State />
      </SidebarProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed');
    expect(document.cookie).not.toContain('sidebar_state');
  });
});
