import { useMemo } from 'react';
import { CopyButton } from '@/components/shared/CopyButton';
import { tokenize, type CodeLanguage, type TokenType } from '@/lib/highlight';
import { cn } from '@/lib/utils';

// the same token colors as shared/CodeBlock, so a snippet reads the same here
// and on the video's share panel
const TOKEN_CLASS: Record<TokenType, string | undefined> = {
  comment: 'text-muted-foreground italic',
  string: 'text-code-string',
  keyword: 'text-code-keyword',
  number: 'text-code-number',
  variable: 'text-code-number',
  fn: 'text-code-fn',
  tag: 'text-code-keyword',
  plain: undefined,
};

/**
 * One snippet as a file: a header bar with its file name and Copy, over the
 * highlighted code. The quickstart's code block from the components board;
 * shared/CodeBlock has no file name header in this tree yet.
 */
export function SnippetBlock({
  filename,
  code,
  language,
  label,
  className,
}: {
  /** shown in the header, such as App.tsx */
  filename: string;
  code: string;
  language: CodeLanguage;
  /** names the snippet for the copy button and the scroll region: "Play in React snippet" */
  label: string;
  className?: string;
}) {
  const tokens = useMemo(() => tokenize(code, language), [code, language]);
  return (
    <div
      data-slot="snippet-block"
      className={cn('min-w-0 overflow-hidden rounded-[10px] border', className)}
    >
      <div className="flex min-h-10 items-center gap-2 border-b bg-background py-1.5 pr-1.5 pl-3.5 text-xs text-muted-foreground">
        <span className="min-w-0 truncate font-mono">{filename}</span>
        <CopyButton
          value={code}
          label={`Copy ${label}`}
          withText
          variant="outline"
          className="ml-auto h-7 px-2.5 text-xs"
        />
      </div>
      {/* focusable and named, so a keyboard can scroll a wide snippet in every
          browser; no ligatures, so copied code shows => and !== as typed */}
      <pre
        tabIndex={0}
        role="region"
        aria-label={label}
        className="m-0 overflow-x-auto bg-card p-4 font-mono text-[13px] leading-[1.7] text-foreground [font-variant-ligatures:none] outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <code>
          {tokens.map((t, i) =>
            TOKEN_CLASS[t.type] ? (
              <span key={i} className={TOKEN_CLASS[t.type]}>
                {t.text}
              </span>
            ) : (
              t.text
            ),
          )}
        </code>
      </pre>
    </div>
  );
}
