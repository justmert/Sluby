import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader, SectionHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders an h1 with the description and meta', () => {
    render(<PageHeader title="Videos" description="Your library" meta={<span>5 videos</span>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Videos' })).toHaveClass('text-title');
    expect(screen.getByText('Your library')).toBeInTheDocument();
    expect(screen.getByText('5 videos')).toBeInTheDocument();
  });

  it('puts secondary actions before the primary one', () => {
    render(
      <PageHeader
        title="Video"
        primaryAction={<button>Save</button>}
        secondaryActions={<button>Cancel</button>}
      />,
    );
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Cancel', 'Save']);
  });

  it('lets a right-to-left title set its own direction', () => {
    render(<PageHeader title="مقطع فيديو طويل" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('dir', 'auto');
  });

  it('gives a long string title a tooltip with the full text', () => {
    render(<PageHeader title="A very long video title" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute(
      'title',
      'A very long video title',
    );
  });
});

describe('SectionHeader', () => {
  it('is a 16px semibold h2 by default, h3 on request', () => {
    const { rerender } = render(
      <SectionHeader title="Deployment" description="Only operators see this" />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Deployment' })).toHaveClass(
      'text-heading',
    );
    rerender(<SectionHeader title="Hosts" as="h3" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Hosts' })).toBeInTheDocument();
  });

  it('takes a heading block of its own in place of the h1', () => {
    render(
      <PageHeader
        title="ignored"
        heading={<h1 className="custom">Editable title</h1>}
        meta={<span>Ready</span>}
      />,
    );
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Editable title');
    expect(screen.queryByText('ignored')).toBeNull();
  });
});
