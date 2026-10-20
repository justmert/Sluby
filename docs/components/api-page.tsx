'use client';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';

// the docs site has no sluby server behind it, so there is nothing for the
// playground to call. each server serves its own interactive reference at
// /api/v1/docs.
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: false },
});
