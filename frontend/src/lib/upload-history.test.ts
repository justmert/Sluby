import { describe, expect, it, vi } from 'vitest';
import { findUpload, forgetUpload, recordUpload } from './upload-history';

const DAY = 24 * 60 * 60 * 1000;
const rec = { fingerprint: 'f', title: 'Teaser', assetId: 'a1', accountId: 'acc' };

describe('upload history', () => {
  it('finds a file uploaded by the same account within 7 days', () => {
    recordUpload(rec, 1_000);
    expect(findUpload('f', 'acc', 1_000 + 2 * DAY)).toMatchObject({ title: 'Teaser', at: 1_000 });
    expect(findUpload('f', 'other', 1_000)).toBeNull();
    expect(findUpload('g', 'acc', 1_000)).toBeNull();
  });

  it('forgets uploads older than 7 days', () => {
    recordUpload(rec, 0);
    expect(findUpload('f', 'acc', 7 * DAY + 1)).toBeNull();
  });

  it('keeps only the newest upload of a file', () => {
    recordUpload(rec, 0);
    recordUpload({ ...rec, title: 'Teaser v2', assetId: 'a2' }, 10);
    expect(findUpload('f', 'acc', 20)).toMatchObject({ title: 'Teaser v2', assetId: 'a2' });
    expect(JSON.parse(localStorage.getItem('sluby:upload-history')!)).toHaveLength(1);
  });

  it('forgets a deleted video', () => {
    recordUpload(rec, 0);
    forgetUpload('a1');
    expect(findUpload('f', 'acc', 1)).toBeNull();
  });

  it('reads nothing from damaged or blocked storage, without throwing', () => {
    localStorage.setItem('sluby:upload-history', '{not json');
    expect(findUpload('f', 'acc')).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(findUpload('f', 'acc')).toBeNull();
    get.mockRestore();
    warn.mockRestore();
  });
});
