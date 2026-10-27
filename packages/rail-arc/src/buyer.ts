/**
 * Arc for the AgentPOS buyer (`@agentpos/mcp-buyer`): the buyer's own Arc wallet as one more
 * network its `BuyerService` can pay on. The mandate still decides: the network is used only
 * when the human lists it in `allowedNetworks`, and every payment is capped at the cart total,
 * converted exactly to Arc's 6 decimals, before anything is signed.
 */
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { BuyerNetworkExtension, UsdcMinor } from "@agentpos/core";
import { arcBuyerExtension } from "./x402.js";

/** The buyer's own signer on Arc: a viem account, or a Circle agent wallet behind one. */
export type ArcBuyerSigner = ConstructorParameters<typeof ExactEvmScheme>[0];

/**
 * Pass to `new BuyerService({ networks: [arcBuyerNetwork(ARC_TESTNET, account)] })`, or to the
 * MCP server through `buildBuyerServer({ depsOverrides: { networks } })`. The key stays with
 * the signer; this package never sees it.
 */
export function arcBuyerNetwork(
  network: string,
  signer: ArcBuyerSigner,
): (maxPerPayment: UsdcMinor) => BuyerNetworkExtension {
  const client = new ExactEvmScheme(signer);
  return (maxPerPayment) => arcBuyerExtension(network, client, maxPerPayment);
}
