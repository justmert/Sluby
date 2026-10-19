import { describe, expect, it } from 'vitest';
import { NO_VALUE } from '@/lib/formatters';
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

  it('claims nobody when the field never arrived', () => {
    expect(keyCreator({})).toEqual({ text: NO_VALUE, known: false });
  });
});
