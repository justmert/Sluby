import { describe, expect, it } from 'vitest';
import { keyCreator } from './key-label';

describe('keyCreator', () => {
  it('names the member who made the key', () => {
    expect(keyCreator({ createdBy: { id: 'u1', name: 'Alice' } })).toEqual({
      text: 'Alice',
      known: true,
    });
  });

  it('says Server for a key made from the command line', () => {
    expect(keyCreator({ createdBy: null })).toEqual({ text: 'Server', known: false });
  });
});
