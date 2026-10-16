import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import NotFoundPage from './NotFoundPage';

describe('NotFoundPage', () => {
  it('says the page does not exist and links back to the overview (CPY-35)', () => {
    renderPage(<NotFoundPage />, { route: '/studio/nope' });
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('This page does not exist.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute(
      'href',
      '/studio',
    );
  });
});
