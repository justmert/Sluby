import { createOpenAPI } from 'fumadocs-openapi/server';

// backend/scripts/export-openapi.ts writes this file, keep the path in sync
export const openapi = createOpenAPI({
  input: ['./public/openapi.json'],
});
