import { describe, expect, it } from 'vitest';
import { needsConfirm, pathProblem } from './explorer-templates';

describe('needsConfirm (FLW-18)', () => {
  it.each([
    ['DELETE', '/api/v1/anything', true],
    ['PATCH', '/api/v1/assets/a1', true],
    ['POST', '/api/v1/keys/k1/rotate', true],
    ['POST', '/api/v1/webhooks', true],
    ['POST', '/api/v1/uploads', false],
    ['GET', '/api/v1/assets/a1', false],
    ['PATCH', '/api/v1/assetsx', false],
  ] as const)('%s %s', (method, path, expected) => {
    expect(needsConfirm(method, path)).toBe(expected);
  });
});

describe('pathProblem (FLW-54)', () => {
  it('asks for a leading slash, refuses another origin and an unfilled id', () => {
    expect(pathProblem('api/v1/assets')).toBe('Start the path with /, for example /api/v1/assets.');
    expect(pathProblem('//evil.example')).toBe(
      'Start the path with /, for example /api/v1/assets.',
    );
    expect(pathProblem('/api/v1/assets/{id}')).toBe('Replace {id} with a real ID first.');
    expect(pathProblem('/api/v1/assets')).toBeNull();
  });
});
