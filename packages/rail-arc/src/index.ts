/**
 * @agentpos/rail-arc: AgentPOS checkout in USDC on Arc.
 *
 * Importing this package registers both Arc networks with @agentpos/core, so the core can
 * price, validate addresses and link wallets on Arc. Call `registerArcWalletProof()` once at
 * startup to verify merchant wallet links on Arc.
 */
import { registerArcNetworks } from "./networks.js";

registerArcNetworks();

export * from "./networks.js";
export * from "./wallet-proof.js";
export * from "./x402.js";
