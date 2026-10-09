import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { EventsEditor } from './EventsEditor';

function Harness({ initial }: { initial: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <EventsEditor
        value={value}
        onChange={setValue}
        error={value.length ? null : 'Choose at least one event.'}
      />
      <output>{value.join(',')}</output>
    </>
  );
}

describe('EventsEditor', () => {
  it('keeps events in the order they happen, however they were ticked', async () => {
    renderWithMotion(<Harness initial={['asset.ready']} />);
    await userEvent.click(screen.getByLabelText('upload.started'));
    expect(screen.getByRole('status')).toHaveTextContent('upload.started,asset.ready');
  });

  it('stacks the api name over what it means, and ties the error to the group (VIS-05)', async () => {
    renderWithMotion(<Harness initial={['asset.ready']} />);
    expect(screen.getByLabelText('processing.started')).toHaveAccessibleDescription(
      'Processing started',
    );
    await userEvent.click(screen.getByLabelText('asset.ready'));
    const group = screen.getByRole('group', { name: 'Events' });
    expect(group).toHaveAccessibleDescription('Choose at least one event.');
  });
});
