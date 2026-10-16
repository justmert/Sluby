import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApiCors } from '../api/cors.js';

// the tus endpoint answers OPTIONS itself with Tus-Max-Size, which the
// studio reads to warn about a file over the limit before sending it
function app() {
  const a = express();
  a.use('/api', createApiCors({ credentialedOrigins: [], authDisabled: false }));
  a.options('/api/v1/uploads', (_req, res) => {
    res.set('Tus-Max-Size', '10737418240').status(204).end();
  });
  return a;
}

describe('createApiCors', () => {
  it('lets a plain OPTIONS through to the route, as a browser sends it with an Origin', async () => {
    const res = await request(app())
      .options('/api/v1/uploads')
      .set('Origin', 'https://sluby.test')
      .set('Tus-Resumable', '1.0.0');
    expect(res.status).toBe(204);
    expect(res.headers['tus-max-size']).toBe('10737418240');
  });

  it('still answers a preflight itself', async () => {
    const res = await request(app())
      .options('/api/v1/uploads')
      .set('Origin', 'https://elsewhere.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['tus-max-size']).toBeUndefined();
  });
});
