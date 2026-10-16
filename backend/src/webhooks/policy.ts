import { env } from '../config/env.js';
import { parseCidrList, type EgressPolicy } from './egress.js';

/** The deployment's webhook egress policy, from WEBHOOK_ALLOWED_NETWORKS. */
export function webhookEgressPolicy(): EgressPolicy {
  return { allowedNetworks: parseCidrList(env.WEBHOOK_ALLOWED_NETWORKS) };
}
