import { screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { AnimatedItem, AnimatedList } from './AnimatedList';
import { Collapse } from './Collapse';

function List({ items }: { items: string[] }) {
  return (
    <AnimatedList aria-label="videos">
      {items.map((item) => (
        <AnimatedItem key={item}>{item}</AnimatedItem>
      ))}
    </AnimatedList>
  );
}

afterEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

describe('AnimatedList', () => {
  it('renders a list of its items', () => {
    renderWithMotion(<List items={['a', 'b', 'c']} />);
    const list = screen.getByRole('list', { name: 'videos' });
    expect(list.tagName).toBe('UL');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('removes a deleted item once its exit is done', async () => {
    const { rerender } = renderWithMotion(<List items={['a', 'b', 'c']} />);
    rerender(<List items={['a', 'c']} />);
    await waitFor(() => expect(screen.queryByText('b')).not.toBeInTheDocument());
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a', 'c']);
  });

  it('keeps a deleted item around while it animates out', async () => {
    MotionGlobalConfig.skipAnimations = false;
    const { rerender } = renderWithMotion(<List items={['a', 'b', 'c']} />);
    rerender(<List items={['a', 'c']} />);
    expect(screen.getByText('b')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('b')).not.toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it('starts its first items and an item added later from the hidden state', () => {
    MotionGlobalConfig.skipAnimations = false;
    const { rerender } = renderWithMotion(<List items={['a']} />);
    expect(screen.getByText('a').style.opacity).toBe('0');
    rerender(<List items={['a', 'b']} />);
    expect(screen.getByText('b').style.opacity).toBe('0');
  });

  it('shows its items when it first renders inside a collapse that is already open', async () => {
    // the collapse skips its own first animation, which blocked the list's
    // too while its items still started hidden: the overview's needs
    // attention rows stayed invisible on a cold load
    MotionGlobalConfig.skipAnimations = false;
    renderWithMotion(
      <Collapse open>
        <AnimatedList aria-label="videos" initial="hidden">
          <AnimatedItem key="a">a</AnimatedItem>
        </AnimatedList>
      </Collapse>,
    );
    await waitFor(() => expect(screen.getByText('a').style.opacity).toBe('1'), { timeout: 2000 });
  });

  it('adds a new item', async () => {
    const { rerender } = renderWithMotion(<List items={['a']} />);
    rerender(<List items={['a', 'b']} />);
    await waitFor(() => expect(screen.getByText('b')).toBeVisible());
  });
});
