import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MotionProvider } from '@/components/motion/MotionProvider';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  id: string;
  name: string;
}

// a skeleton with a real height, since this suite loads no tailwind css
const columns: DataTableColumn<Row>[] = [
  {
    id: 'name',
    header: 'Name',
    primary: true,
    cell: (r) => r.name,
    skeleton: <div style={{ height: 30 }} />,
  },
];

function Table({ rows }: { rows: Row[] | undefined }) {
  return (
    <MotionProvider>
      <DataTable
        caption="Keys"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
        loadingRows={3}
        animateRows
      />
    </MotionProvider>
  );
}

const lift = (el: Element) => {
  const t = getComputedStyle(el).transform;
  return t === 'none' ? 0 : Math.abs(new DOMMatrix(t).m42);
};

// the skeleton rows sat inside the rows' presence and stayed one commit
// after the data came, so the first real rows were laid out under them and
// slid up by the skeleton's height (105 px on the API keys page)
describe('DataTable rows arriving after the skeleton, in a real browser', () => {
  it('fade in where they belong instead of sliding up from under the skeleton', async () => {
    const view = render(<Table rows={undefined} />);
    await new Promise((r) => setTimeout(r, 100));
    view.rerender(
      <Table
        rows={[
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ]}
      />,
    );
    let most = 0;
    const end = performance.now() + 800;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      for (const tr of document.querySelectorAll('tbody tr[data-row-id]'))
        most = Math.max(most, lift(tr));
    }
    // the fade lifts a row by 6 px at most (listItem)
    expect(most).toBeLessThanOrEqual(6.5);
    view.unmount();
  });
});
