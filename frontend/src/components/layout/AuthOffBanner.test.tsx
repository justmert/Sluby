import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { AUTH_OFF_DISMISSED_KEY, AuthOffBanner } from './AuthOffBanner';

afterEach(() => sessionStorage.clear());

const render = (authDisabled: boolean) =>
  renderPage(
    <WithSession authDisabled={authDisabled}>
      <AuthOffBanner />
    </WithSession>,
  );

describe('AuthOffBanner (FLW-29, D-15)', () => {
  it('warns that anyone who can open the address is an admin, with how to turn sign-in on', () => {
    render(true);
    const banner = screen.getByRole('region', { name: 'Sign-in is off' });
    expect(banner).toHaveTextContent(
      'Sign-in is off. Anyone who can open this address has admin access.',
    );
    const link = screen.getByRole('link', { name: 'Turn on sign-in, opens in a new tab' });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/justmert/Sluby/blob/main/docs/guide/configuration.md#sign-in',
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('is not there when sign-in is on', () => {
    render(false);
    expect(screen.queryByRole('region', { name: 'Sign-in is off' })).not.toBeInTheDocument();
  });

  it('can be hidden for the rest of this browser session', async () => {
    const view = render(true);
    await userEvent.click(
      screen.getByRole('button', { name: 'Hide this warning until the next visit' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Sign-in is off' })).not.toBeInTheDocument(),
    );
    expect(sessionStorage.getItem(AUTH_OFF_DISMISSED_KEY)).toBe('1');
    view.unmount();
    render(true);
    expect(screen.queryByRole('region', { name: 'Sign-in is off' })).not.toBeInTheDocument();
  });
});
