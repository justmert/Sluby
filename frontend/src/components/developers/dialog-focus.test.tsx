import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import { AddWebhookDialog } from './AddWebhookDialog';
import { CreateKeyDialog } from './CreateKeyDialog';
import { emptyKeyForm, emptyWebhookForm } from './forms';

function WebhookHarness() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyWebhookForm);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      <AddWebhookDialog
        open={open}
        onOpenChange={setOpen}
        form={form}
        onFormChange={setForm}
        existingUrls={[]}
        onCreated={() => {}}
      />
    </>
  );
}

function KeyHarness() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyKeyForm);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      <CreateKeyDialog
        open={open}
        onOpenChange={setOpen}
        form={form}
        onFormChange={setForm}
        onIssued={() => {}}
      />
    </>
  );
}

describe.each([
  ['Add webhook', WebhookHarness, 'Endpoint URL'],
  ['Create key', KeyHarness, 'Name'],
])('%s dialog focus', (_name, Harness, field) => {
  it('starts on its first field, keeps focus inside, and gives it back on close', async () => {
    const user = userEvent.setup();
    renderPage(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await user.click(opener);
    const input = await screen.findByLabelText(field);
    await waitFor(() => expect(input).toHaveFocus());
    // safari's default tab order skips buttons, so a tab from the only text
    // field lands on the page behind; the trap must bring it back at once
    opener.focus();
    expect(input).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
