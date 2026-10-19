import { CopyField } from '@/components/shared/CopyField';

/**
 * A sign-in link the server shows only once: the link to copy and what it
 * lets its holder do until when.
 */
export function LinkReveal({
  url,
  label,
  children,
}: {
  url: string;
  /** names the link for the copy button: "invite link" */
  label: string;
  /** who the link is for and until when, as full sentences */
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <CopyField label={label} value={url} className="h-9" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
