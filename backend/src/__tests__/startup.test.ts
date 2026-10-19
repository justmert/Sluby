import { describe, it, expect } from 'vitest';
import { ignoredSettingWarnings } from '../api/auth/startup.js';

describe('ignoredSettingWarnings', () => {
  it('says nothing when neither old access setting is set', () => {
    expect(ignoredSettingWarnings({ githubAllowedUsers: '', operatorUsers: '' })).toEqual([]);
    expect(ignoredSettingWarnings({ githubAllowedUsers: '  ', operatorUsers: ' ' })).toEqual([]);
  });

  it('names each old access setting that is still set', () => {
    expect(
      ignoredSettingWarnings({ githubAllowedUsers: 'alice', operatorUsers: 'github:alice' }),
    ).toEqual([
      expect.stringContaining('GITHUB_ALLOWED_USERS is set but ignored'),
      expect.stringContaining('OPERATOR_USERS is set but ignored'),
    ]);
    expect(ignoredSettingWarnings({ githubAllowedUsers: '', operatorUsers: 'github:a' })).toEqual([
      expect.stringContaining('OPERATOR_USERS'),
    ]);
  });
});
