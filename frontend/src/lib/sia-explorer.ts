// links to on-chain entities on siascan.
//
// the explorer follows the network the backend reports (SIA_NETWORK): zen and
// testnet use zen siascan, anything else mainnet siascan. VITE_SIA_EXPLORER_URL
// overrides both, e.g. for a self-hosted explorer.
//
// sia object ids are app-layer hashes minted by the indexer, not consensus
// entities, so they never appear on an explorer and are not linked. hosts,
// contracts and addresses are.

// compose passes the build argument as an empty string when it is unset,
// which must not count as an override: it made every link relative to the
// studio's own origin
const OVERRIDE =
  (import.meta.env.VITE_SIA_EXPLORER_URL as string | undefined)?.trim().replace(/\/$/, '') ||
  undefined;

export interface Explorer {
  base: string;
  label: string;
  host: (publicKey: string) => string;
  contract: (id: string) => string;
  address: (address: string) => string;
}

export function explorerFor(network: string | undefined): Explorer {
  const n = (network ?? '').toLowerCase();
  const testnet = n === 'zen' || n === 'testnet';
  const base = OVERRIDE ?? (testnet ? 'https://zen.siascan.com' : 'https://siascan.com');
  const label = OVERRIDE ? 'Sia explorer' : testnet ? 'Zen Siascan' : 'Siascan';
  const enc = encodeURIComponent;
  return {
    base,
    label,
    // siascan takes the key with its ed25519: prefix as is
    host: (publicKey) => `${base}/host/${enc(publicKey).replace(/%3A/gi, ':')}`,
    contract: (id) => `${base}/contract/${enc(id)}`,
    address: (address) => `${base}/address/${enc(address)}`,
  };
}

/** Props for an external explorer link: new tab, no referrer or opener. */
export const EXTERNAL_LINK_PROPS = {
  target: '_blank' as const,
  rel: 'noopener noreferrer' as const,
};
