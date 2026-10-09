import { useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * A create dialog that `?create={value}` opens, for links from the palette
 * and the get started checklist. Closing it drops the param, so a reload or
 * Back does not open it again.
 */
export function useCreateParam(value: string): [boolean, (open: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const [open, setOpenState] = useState(false);
  const fromParam = params.get('create') === value;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next && params.has('create')) {
      setParams(
        (p) => {
          p.delete('create');
          return p;
        },
        { replace: true },
      );
    }
  };
  return [open || fromParam, setOpen];
}
