import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { tokenize, type CodeLanguage, type TokenType } from '@/lib/highlight';
import { cn } from '@/lib/utils';
import { CopyButton } from './CopyButton';

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

function Highlighted({ code, language }: { code: string; language: CodeLanguage }) {
  const tokens = useMemo(() => tokenize(code, language), [code, language]);
  return (
    <>
      {tokens.map((t, i) =>
        TOKEN_CLASS[t.type] ? (
          <span key={i} className={TOKEN_CLASS[t.type]}>
            {t.text}
          </span>
        ) : (
          t.text
        ),
      )}
    </>
  );
}

function Pre({
  code,
  language,
  className,
}: {
  code: string;
  language: CodeLanguage;
  className?: string;
}) {
  return (
    // chrome lets a keyboard scroll a wide snippet, so it takes focus
    <pre
      tabIndex={0}
      className={cn(
        'overflow-x-auto rounded-lg p-4 pr-12 font-mono text-xs leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring',
        className,
      )}
    >
      <code>
        <Highlighted code={code} language={language} />
      </code>
    </pre>
  );
}

export interface CodeSample {
  /** the tab label: "JavaScript", "curl", "React" */
  label: string;
  language: CodeLanguage;
  code: string;
}

export interface CodeBlockProps {
  /** a single snippet; use `samples` for several languages */
  code?: string;
  language?: CodeLanguage;
  /** names the snippet for the copy button: "Copy {label}" */
  label: string;
  /** several versions of one snippet, shown as tabs with one copy button */
  samples?: CodeSample[];
  /** the selected tab, for a page that remembers it across snippets */
  value?: string;
  onValueChange?: (label: string) => void;
  className?: string;
  /** goes on the scrolling <pre>, e.g. max-h-96 for a long response */
  preClassName?: string;
}

/**
 * Code with a copy button, colored by a small built-in highlighter
 * (lib/highlight.ts), with tabs when there are several languages.
 *
 *   <CodeBlock code="npm i @sluby/sdk" language="bash" label="install command" />
 *   <CodeBlock label="upload snippet" samples={[
 *     { label: 'JavaScript', language: 'ts', code: js },
 *     { label: 'curl', language: 'bash', code: curl },
 *   ]} />
 */
export function CodeBlock({
  code,
  language = 'text',
  label,
  samples,
  value,
  onValueChange,
  className,
  preClassName,
}: CodeBlockProps) {
  const [own, setOwn] = useState(samples?.[0]?.label ?? '');
  const selected = samples?.find((s) => s.label === (value ?? own)) ?? samples?.[0] ?? undefined;

  if (!samples || samples.length === 0) {
    return (
      <div
        data-slot="code-block"
        className={cn('relative rounded-lg border bg-muted/40', className)}
      >
        <CopyButton value={code ?? ''} label={`Copy ${label}`} className="absolute top-2 right-2" />
        <Pre code={code ?? ''} language={language} className={preClassName} />
      </div>
    );
  }

  return (
    <Tabs
      data-slot="code-block"
      value={selected?.label}
      onValueChange={(next) => {
        setOwn(next);
        onValueChange?.(next);
      }}
      className={cn('gap-0 rounded-lg border bg-muted/40', className)}
    >
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <TabsList variant="line" className="h-7">
          {samples.map((s) => (
            <TabsTrigger key={s.label} value={s.label} className="px-2 text-xs">
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <CopyButton
          value={selected?.code ?? ''}
          label={`Copy ${label}${selected ? ` (${selected.label})` : ''}`}
        />
      </div>
      {samples.map((s) => (
        <TabsContent key={s.label} value={s.label} className="rounded-t-none">
          <Pre code={s.code} language={s.language} className={cn('pr-4', preClassName)} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
