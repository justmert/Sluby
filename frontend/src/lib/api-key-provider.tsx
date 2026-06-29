import { createContext, useContext, useState, type ReactNode } from 'react';

interface ApiKeyContextValue {
  apiKey: string | null;
  setApiKey: (key: string | null) => void;
  maskedKey: string | null;
}

const ApiKeyContext = createContext<ApiKeyContextValue | undefined>(undefined);

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('sluby-api-key');
  });

  const setApiKey = (key: string | null) => {
    setApiKeyState(key);
    if (key) {
      localStorage.setItem('sluby-api-key', key);
    } else {
      localStorage.removeItem('sluby-api-key');
    }
  };

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 8)}${'*'.repeat(Math.max(0, apiKey.length - 12))}${apiKey.slice(-4)}`
    : null;

  return (
    <ApiKeyContext.Provider value={{ apiKey, setApiKey, maskedKey }}>
      {children}
    </ApiKeyContext.Provider>
  );
}

export function useApiKey() {
  const context = useContext(ApiKeyContext);
  if (!context) throw new Error('useApiKey must be used within an ApiKeyProvider');
  return context;
}
