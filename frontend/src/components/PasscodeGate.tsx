import { useState, useCallback, type ReactNode, type FormEvent } from 'react';

const PASSCODE = 'yklabs.sia';
const STORAGE_KEY = 'ws_unlocked';

export function PasscodeGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(STORAGE_KEY) === '1',
  );
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (value === PASSCODE) {
        sessionStorage.setItem(STORAGE_KEY, '1');
        setUnlocked(true);
      } else {
        setError(true);
        setTimeout(() => setError(false), 1500);
      }
    },
    [value],
  );

  if (unlocked) return <>{children}</>;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-base">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col items-center gap-6 w-full max-w-sm px-6"
      >
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
            SiaStream
          </h1>
          <p className="text-sm text-text-secondary">
            Enter passcode to continue
          </p>
        </div>

        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Passcode"
          autoFocus
          className={`
            w-full rounded-lg border bg-surface-1 px-4 py-3 text-sm text-text-primary
            placeholder:text-text-placeholder outline-none transition-colors
            ${error
              ? 'border-red-500/60 shake'
              : 'border-border-default focus:border-border-focus'
            }
          `}
        />

        <button
          type="submit"
          className="w-full rounded-lg bg-accent-primary px-4 py-3 text-sm font-medium text-white
                     transition-colors hover:bg-accent-primary-hover"
        >
          Enter
        </button>

        {error && (
          <p className="text-sm text-red-400">Incorrect passcode</p>
        )}
      </form>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        .shake { animation: shake 0.3s ease-in-out; }
      `}</style>
    </div>
  );
}
