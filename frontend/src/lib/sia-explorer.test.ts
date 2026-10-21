import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'ed25519:065f05580cd47040a7dbdc56580b0821942864b7d5ece3ac50c97d0c8ac2c2e1';

async function explorer(override: string | undefined, network = 'mainnet') {
  vi.resetModules();
  vi.stubEnv('VITE_SIA_EXPLORER_URL', override as string);
  return (await import('./sia-explorer')).explorerFor(network);
}

afterEach(() => vi.unstubAllEnvs());

describe('explorerFor', () => {
  it('links hosts, contracts and addresses on siascan, keeping the key prefix', async () => {
    const e = await explorer(undefined);
    expect(e.label).toBe('Siascan');
    expect(e.host(KEY)).toBe(`https://siascan.com/host/${KEY}`);
    expect(e.contract('51fa04e0')).toBe('https://siascan.com/contract/51fa04e0');
    expect(e.address('e011db8b')).toBe('https://siascan.com/address/e011db8b');
  });

  it('uses zen siascan on the testnet', async () => {
    expect((await explorer(undefined, 'zen')).host(KEY)).toBe(
      `https://zen.siascan.com/host/${KEY}`,
    );
  });

  it('ignores an empty override, as compose passes an unset build argument', async () => {
    for (const empty of ['', '   ']) {
      const e = await explorer(empty);
      expect(e.host(KEY)).toBe(`https://siascan.com/host/${KEY}`);
      expect(e.label).toBe('Siascan');
    }
  });

  it('uses a set override without its trailing slash', async () => {
    const e = await explorer('https://explorer.example.com/');
    expect(e.host(KEY)).toBe(`https://explorer.example.com/host/${KEY}`);
    expect(e.label).toBe('Sia explorer');
  });
});
