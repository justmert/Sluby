import '@/index.css';
import { Pencil } from 'lucide-react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MotionProvider } from '@/components/motion/MotionProvider';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  id: string;
  name: string;
}

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', primary: true, cell: (r) => r.name },
  { id: 'status', header: 'Status', cell: () => 'Ready' },
];

afterEach(() => cleanup());

describe('DataTable as phone cards', () => {
  it('puts a row checkbox at the top left, beside the title, like Select all', () => {
    // narrower than 40rem: the rows are cards
    render(
      <MotionProvider>
        <div style={{ width: 360 }}>
          <DataTable
            caption="Videos"
            columns={columns}
            rows={[{ id: '1', name: 'Product walkthrough' }]}
            getRowId={(r) => r.id}
            getRowLabel={(r) => r.name}
            selected={new Set()}
            onSelectedChange={() => {}}
            rowActions={() => [{ label: 'Open', icon: Pencil, onSelect: () => {} }]}
          />
        </div>
      </MotionProvider>,
    );
    const box = document.querySelector('tbody [role="checkbox"]')!.getBoundingClientRect();
    const title = document.querySelector('tbody td[data-cell="primary"]')!.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(title.left);
    // centred on the title's first 20 px line
    expect(Math.abs(box.top + box.height / 2 - (title.top + 10))).toBeLessThanOrEqual(1);
  });

  it('puts a loading row’s checkbox where the loaded one will be', () => {
    render(
      <MotionProvider>
        <div style={{ width: 360 }}>
          <DataTable
            caption="Videos"
            columns={columns}
            rows={undefined}
            getRowId={(r) => r.id}
            getRowLabel={(r) => r.name}
            selected={new Set()}
            onSelectedChange={() => {}}
            loadingRows={1}
          />
        </div>
      </MotionProvider>,
    );
    const row = document.querySelector('tbody tr')!;
    const [box, title] = [...row.children].map((c) => c.getBoundingClientRect());
    expect(box.right).toBeLessThanOrEqual(title.left);
    expect(box.top).toBe(title.top + 2);
  });
});
