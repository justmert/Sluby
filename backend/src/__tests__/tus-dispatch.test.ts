import { describe, it, expect } from 'vitest';
import { isTusRequest } from '../upload/tus-dispatch.js';

describe('isTusRequest', () => {
  it('routes any request carrying Tus-Resumable to TUS', () => {
    expect(isTusRequest({ method: 'POST', headers: { 'tus-resumable': '1.0.0' } })).toBe(true);
    expect(isTusRequest({ method: 'DELETE', headers: { 'tus-resumable': '1.0.0' } })).toBe(true);
  });

  it('routes TUS protocol verbs (PATCH/HEAD/OPTIONS) to TUS', () => {
    expect(isTusRequest({ method: 'PATCH', headers: {} })).toBe(true);
    expect(isTusRequest({ method: 'HEAD', headers: {} })).toBe(true);
    expect(isTusRequest({ method: 'OPTIONS', headers: {} })).toBe(true);
  });

  it('falls through to REST for plain JSON verbs without the TUS header', () => {
    // POST /uploads (JSON session creation)
    expect(isTusRequest({ method: 'POST', headers: {} })).toBe(false);
    // GET /uploads/:id (status)
    expect(isTusRequest({ method: 'GET', headers: {} })).toBe(false);
    // DELETE /uploads/:id (cancel)
    expect(isTusRequest({ method: 'DELETE', headers: {} })).toBe(false);
  });
});
