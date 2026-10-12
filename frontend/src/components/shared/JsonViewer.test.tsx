import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { JSON_CHUNK, JsonViewer } from './JsonViewer';

const payload = {
  id: 'evt_1',
  type: 'asset.ready',
  data: {
    id: 'vid_1',
    duration_ms: 30000,
    public: true,
    thumbnail: null,
    renditions: [{ height: 1080 }, { height: 720 }, { height: 480 }, { height: 360 }],
  },
};

const item = (name: string | RegExp) => screen.getByRole('treeitem', { name });

describe('JsonViewer', () => {
  it('colors keys, strings, numbers, booleans and null by type', () => {
    renderWithMotion(<JsonViewer value={payload} label="Payload" />);
    const tree = screen.getByRole('tree', { name: 'Payload' });
    expect(within(tree).getByText('"duration_ms"')).toHaveClass('text-primary');
    expect(within(tree).getByText('"vid_1"')).toHaveClass('text-code-string');
    expect(within(tree).getByText('30000')).toHaveClass('text-code-number');
    expect(within(tree).getByText('true')).toHaveClass('text-code-keyword');
    expect(within(tree).getByText('null')).toHaveClass('text-subtle-foreground', 'italic');
    expect(within(tree).getAllByText(',')[0]).toHaveClass('text-subtle-foreground');
  });

  it('opens the first two levels and folds deeper ones to a count', () => {
    renderWithMotion(<JsonViewer value={payload} label="Payload" />);
    expect(item('Payload, 3 keys')).toHaveAttribute('aria-expanded', 'true');
    expect(item('data, 5 keys')).toHaveAttribute('aria-expanded', 'true');
    const renditions = item('renditions, 4 items');
    expect(renditions).toHaveAttribute('aria-expanded', 'false');
    expect(renditions).toHaveAttribute('aria-level', '3');
    expect(renditions).toHaveTextContent('"renditions": [4 items]');
    expect(screen.queryByText('1080')).not.toBeInTheDocument();
  });

  it('says 1 key and 1 item in the singular', () => {
    renderWithMotion(
      <JsonViewer value={{ a: { b: { c: 1 } }, l: { m: { n: [1] } } }} label="Payload" />,
    );
    expect(item('b, 1 key')).toHaveTextContent('{1 key}');
    expect(item('m, 1 key')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens and closes a node with its caret', async () => {
    renderWithMotion(<JsonViewer value={payload} label="Payload" />);
    const renditions = item('renditions, 4 items');
    await userEvent.click(renditions.querySelector('button')!);
    expect(renditions).toHaveAttribute('aria-expanded', 'true');
    // its items sit deeper than the open levels, so they start folded
    expect(item('Item 1, 1 key')).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(renditions);
    await userEvent.click(renditions.querySelector('button')!);
    expect(renditions).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'Item 1, 1 key' })).not.toBeInTheDocument();
  });

  it('is one tab stop, moved and folded with the arrow keys', async () => {
    renderWithMotion(<JsonViewer value={payload} label="Payload" />);
    const tree = screen.getByRole('tree');
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .filter((el) => el.tabIndex === 0),
    ).toEqual([item('Payload, 3 keys')]);
    await userEvent.tab(); // expand all
    await userEvent.tab(); // copy
    await userEvent.tab();
    expect(document.activeElement).toBe(item('Payload, 3 keys'));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(item('id: evt_1'));
    await userEvent.keyboard('{End}');
    const renditions = item('renditions, 4 items');
    expect(document.activeElement).toBe(renditions);
    await userEvent.keyboard('{ArrowRight}');
    expect(renditions).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(item('Item 1, 1 key'));
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(renditions);
    await userEvent.keyboard('{ArrowLeft}');
    expect(renditions).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(item('data, 5 keys'));
    await userEvent.keyboard('{Enter}');
    expect(item('data, 5 keys')).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard(' ');
    expect(item('data, 5 keys')).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(item('Payload, 3 keys'));
    expect(item('Payload, 3 keys')).toHaveAttribute('tabindex', '0');
    expect(item('data, 5 keys')).toHaveAttribute('tabindex', '-1');
  });

  it('expands everything, then collapses all but the root', async () => {
    renderWithMotion(<JsonViewer value={payload} label="Payload" />);
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.queryAllByRole('treeitem', { expanded: false })).toHaveLength(0);
    expect(screen.getByText('360')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(item('Payload, 3 keys')).toHaveAttribute('aria-expanded', 'true');
    expect(item('data, 5 keys')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('"vid_1"')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();
  });

  it('gives the tab stop back to the root when its branch closes', async () => {
    renderWithMotion(<JsonViewer value={payload} label="Payload" />);
    await userEvent.click(item('id: vid_1'));
    expect(item('id: vid_1')).toHaveAttribute('tabindex', '0');
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(item('Payload, 3 keys')).toHaveAttribute('tabindex', '0');
  });

  it('copies the whole document as indented JSON', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithMotion(<JsonViewer value={payload} label="Payload" name="asset.ready payload" />);
    await act(async () =>
      screen.getByRole('button', { name: 'Copy JSON of asset.ready payload' }).click(),
    );
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
  });

  it('shows the label and the size of the JSON in the header', () => {
    renderWithMotion(<JsonViewer text={'{"a": 1}'} label="Response body" />);
    expect(screen.getByText('Response body · 8 bytes')).toBeInTheDocument();
    expect(screen.getByRole('tree', { name: 'Response body' })).toBeInTheDocument();
  });

  it('parses raw text and shows escapes as JSON writes them', () => {
    renderWithMotion(<JsonViewer text={'{"note":"two\\nlines","list":[]}'} label="Body" />);
    expect(screen.getByText('"two\\nlines"')).toHaveClass('text-code-string');
    expect(item('list: empty list')).not.toHaveAttribute('aria-expanded');
    expect(item('list: empty list')).toHaveTextContent('"list": []');
  });

  it('shows text that is not JSON as it came, and says so', () => {
    renderWithMotion(<JsonViewer text="<html>Bad gateway</html>" label="response" />);
    expect(screen.getByText('Not valid JSON, shown as text.')).toBeInTheDocument();
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'response code' })).toHaveTextContent(
      '<html>Bad gateway</html>',
    );
  });

  it('leaves out what JSON cannot carry, as JSON.stringify would send it', () => {
    renderWithMotion(<JsonViewer value={{ kept: 1, dropped: undefined }} label="Payload" />);
    expect(item('Payload, 1 key')).toBeInTheDocument();
    expect(screen.queryByText('"dropped"')).not.toBeInTheDocument();
  });

  it('draws a long list in chunks and shows more on request', async () => {
    const big = Array.from({ length: JSON_CHUNK * 2 + 5 }, (_, i) => i);
    renderWithMotion(<JsonViewer value={big} label="Numbers" />);
    const root = item(`Numbers, ${big.length} items`);
    expect(within(root).getAllByRole('treeitem')).toHaveLength(JSON_CHUNK + 1);
    const more = item('Show 100 more, 105 left');
    await userEvent.click(within(more).getByText('Show 100 more'));
    expect(document.activeElement).toBe(item(`Item ${JSON_CHUNK + 1}: ${JSON_CHUNK}`));
    expect(item('Show 5 more, 5 left')).toBeInTheDocument();
    await userEvent.keyboard('{End}{Enter}');
    expect(screen.queryByRole('treeitem', { name: /^Show/ })).not.toBeInTheDocument();
    expect(within(root).getAllByRole('treeitem')).toHaveLength(big.length);
    expect(document.activeElement).toBe(item(`Item ${big.length - 4}: ${big.length - 5}`));
  });

  it('starts a large object closed below the root, so a big answer stays quick', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    renderWithMotion(<JsonViewer value={{ data }} label="Response body" />);
    expect(item('data, 50 items')).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts over when the document changes', async () => {
    const { rerender } = renderWithMotion(<JsonViewer text={'{"a":{"b":{"c":1}}}'} label="Body" />);
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(item('b, 1 key')).toHaveAttribute('aria-expanded', 'true');
    rerender(<JsonViewer text={'{"a":{"b":{"c":2}}}'} label="Body" />);
    expect(item('b, 1 key')).toHaveAttribute('aria-expanded', 'false');
  });
});
