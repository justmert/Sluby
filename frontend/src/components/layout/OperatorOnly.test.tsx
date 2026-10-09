import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { OperatorOnly } from './OperatorOnly';

const renderAs = (operator: boolean) =>
  renderPage(
    <WithSession operator={operator}>
      <OperatorOnly>
        <p>Deployment page</p>
      </OperatorOnly>
    </WithSession>,
  );

describe('OperatorOnly', () => {
  it('shows the page to an operator', () => {
    renderAs(true);
    expect(screen.getByText('Deployment page')).toBeInTheDocument();
  });

  it('tells a member why instead of showing it', () => {
    renderAs(false);
    expect(screen.queryByText('Deployment page')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'For operators only' })).toBeInTheDocument();
    expect(
      screen.getByText('Health and metrics cover every account on this server.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute(
      'href',
      '/studio',
    );
  });
});
