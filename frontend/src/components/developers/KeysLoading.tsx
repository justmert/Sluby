import { CreateKeyButton } from '@/components/layout/page-actions';
import { PAGE_HEADS } from '@/components/layout/page-heads';
import { withCells } from '@/components/shared/column-frames';
import { DataTable } from '@/components/shared/DataTable';
import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { KEY_COLUMNS } from './columns';
import { LoadingHead } from './LoadingHead';
import { KEYS_LEAD } from './keys-copy';

/** "Keys let your server call the API. 2 of 25 used.", with a bar for the count while it loads. */
export function KeysDescription({ used }: { used: string | null }) {
  return (
    <>
      {KEYS_LEAD}{' '}
      {used ?? (
        <Skeleton
          as="span"
          aria-hidden="true"
          className={cn('inline-block h-3.5 w-22 align-middle', lateReveal)}
        />
      )}
    </>
  );
}

/** The keys page as it first draws: its header, the count still loading, and the table's own columns over skeleton rows. */
export function KeysLoading() {
  return (
    <>
      <LoadingHead
        {...PAGE_HEADS.keys}
        description={<KeysDescription used={null} />}
        primaryAction={<CreateKeyButton />}
      />
      <DataTable
        caption=""
        columns={withCells<never>(KEY_COLUMNS, {})}
        rows={undefined}
        getRowId={() => ''}
        getRowLabel={() => ''}
        loadingRows={3}
        rowActions={() => []}
      />
    </>
  );
}
