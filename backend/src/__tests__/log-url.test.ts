import { describe, it, expect } from 'vitest';
import { loggableUrl } from '../api/log-url.js';

describe('loggableUrl', () => {
  it('keeps known query values and redacts the rest', () => {
    expect(loggableUrl('/api/v1/assets?limit=5&sig=abc')).toBe(
      '/api/v1/assets?limit=5&sig=[redacted]',
    );
    expect(loggableUrl('/api/v1/auth/github/login?invite=secret-token&next=/studio')).toBe(
      '/api/v1/auth/github/login?invite=[redacted]&next=[redacted]',
    );
  });

  it('redacts the token of an invite or reset link in the path', () => {
    const token = 'A'.repeat(43);
    expect(loggableUrl(`/api/v1/auth/invites/${token}`)).toBe('/api/v1/auth/invites/[redacted]');
    expect(loggableUrl(`/api/v1/auth/invites/${token}/accept?x=1`)).toBe(
      '/api/v1/auth/invites/[redacted]/accept?x=[redacted]',
    );
    expect(loggableUrl('/api/v1/invites/0000-1111')).toBe('/api/v1/invites/0000-1111');
  });
});
