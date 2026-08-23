import { describe, it, expect } from 'vitest';
import { collectAssetObjectIds } from '../deletion/collect.js';

describe('collectAssetObjectIds', () => {
  it('merges every source into a deduped set', () => {
    const ids = collectAssetObjectIds({
      artifactObjectIds: ['a', 'b', 'a'],
      manifestObjectId: 'm',
      thumbnailObjectIds: ['t1', 't2'],
      siaObjectIds: ['b', 's1'],
    });
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'm', 't1', 't2', 's1']));
    expect(ids.length).toBe(6);
  });

  it('drops empty and nullish ids', () => {
    const ids = collectAssetObjectIds({
      artifactObjectIds: ['a', '', null, undefined],
      manifestObjectId: null,
      thumbnailObjectIds: [undefined, 't'],
      siaObjectIds: [''],
    });
    expect(ids).toEqual(['a', 't']);
  });

  it('returns an empty list when there is nothing to collect', () => {
    expect(
      collectAssetObjectIds({
        artifactObjectIds: [],
        manifestObjectId: null,
        thumbnailObjectIds: [],
        siaObjectIds: [],
      }),
    ).toEqual([]);
  });
});
