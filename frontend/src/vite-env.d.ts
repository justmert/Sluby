/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SLUBY_SIA_INDEXER_URL?: string;
  readonly VITE_SLUBY_SIA_APP_ID?: string;
  readonly VITE_SLUBY_SIA_APP_KEY?: string;
  readonly VITE_SIA_EXPLORER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
