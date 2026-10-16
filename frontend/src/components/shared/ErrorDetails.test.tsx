import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorDetails } from './ErrorDetails';

describe('ErrorDetails', () => {
  it('gives the Details toggle a touch-sized hit area without moving the text (A11Y-47)', () => {
    render(<ErrorDetails detail="ECONNREFUSED" />);
    expect(screen.getByText('Details')).toHaveClass('pointer-coarse:py-3', 'pointer-coarse:-my-3');
  });
});
