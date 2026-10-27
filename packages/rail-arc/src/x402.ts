/**
 * x402 on Arc. This is the rail's protocol contact (guardrail 3, as amended 2026-10-23): it
 * uses the official `@x402/evm` "exact" scheme (EIP-3009 transferWithAuthorization on USDC)
 * and hands it to the core, which adds Arc to the store's 402 next to Stellar.
 *
 * Settlement goes through the Circle Facilitator Service, which pays the gas and moves the USDC
 * from the buyer's wallet straight to the merchant's. AgentPOS never holds the funds and charges
 * no commission (guardrails 1 and 7).
 */
import { ExactEvmScheme as ExactEvmServerScheme } from "@x402/evm/exact/server";
import type {
  BuyerNetworkExtension,
  ExtraAccept,
  FacilitatorConfig,
  MinorAmount,
  SchemeNetworkClient,
  UsdcMinor,
  X402NetworkExtension,
} from "@agentpos/core";
import { AgentPOSError, assertAddressFor, usdcOnChain } from "@agentpos/core";
import { ARC_USDC, ARC_USDC_EIP712, isArcNetwork, registerArcNetworks } from "./networks.js";
import type { ArcNetwork } from "./networks.js";
import { createArcPaymentWatcher } from "./reconcile.js";
import type { ArcPaymentWatcherOptions } from "./reconcile.js";

/** Reverse-DNS id of this rail, like `org.x402.stellar` for the core's Stellar rail. */
export const X402_ARC_RAIL_ID = "org.x402.arc" as const;

export interface CircleFacilitatorOptions {
  /** Facilitator base URL from Circle's docs. No default: Circle publishes it per account. */
  url: string;
  /** API key from console.circle.com for THIS network (testnet and mainnet keys differ). */
  apiKey: string;
}

/** A facilitator config that authenticates every call with the Circle API key. */
export function circleFacilitator(options: CircleFacilitatorOptions): FacilitatorConfig {
  if (!/^https:\/\//.test(options.url)) {
    throw new AgentPOSError("CONFIG_INVALID", "The Circle facilitator URL must be https", {
      hint: "Copy the facilitator base URL from developers.circle.com/facilitator-service.",
      details: { url: options.url },
    });
  }
  if (!options.apiKey) {
    throw new AgentPOSError("CONFIG_INVALID", "The Circle facilitator needs an API key", {
      hint: "Create one at console.circle.com; use the testnet key for Arc testnet.",
    });
  }
  const headers = { Authorization: `Bearer ${options.apiKey}` };
  return {
    url: options.url.replace(/\/+$/, ""),
    createAuthHeaders: async () => ({ verify: headers, settle: headers, supported: headers }),
  };
}

function requireArc(network: string): ArcNetwork {
  if (!isArcNetwork(network)) {
    throw new AgentPOSError("CHAIN_UNKNOWN", `'${network}' is not an Arc network`, {
      hint: "Use eip155:5042 (Arc mainnet) or eip155:5042002 (Arc testnet).",
      details: { network },
    });
  }
  return network;
}

/**
 * The seller side: what a store passes to `createResourceServer` so its 402 also offers Arc.
 * Registers the Arc networks with the core as a side effect.
 */
export function arcResourceExtension(
  network: string,
  facilitator: CircleFacilitatorOptions,
): X402NetworkExtension {
  registerArcNetworks();
  return {
    network: requireArc(network),
    server: new ExactEvmServerScheme(),
    facilitator: circleFacilitator(facilitator),
  };
}

/**
 * The same route, payable on Arc: the catalog price converted EXACTLY to Arc's 6-decimal USDC
 * (a price with a 7th decimal is refused, never rounded) and the merchant's own Arc address.
 */
export function arcAccept(network: string, payTo: string, price: UsdcMinor): ExtraAccept {
  registerArcNetworks();
  const arc = requireArc(network);
  return {
    network: arc,
    payTo: assertAddressFor(arc, payTo),
    asset: ARC_USDC,
    amount: usdcOnChain(price, arc),
    extra: { ...ARC_USDC_EIP712 },
  };
}

/**
 * What a store passes to the AgentPOS sidecar (`x402Networks`) to take payments on Arc: the
 * resource extension, the merchant's own Arc address, the USDC asset with its EIP-712 domain,
 * and a payment watcher so the sidecar reconciles the merchant's wallet against its orders (D3).
 * Pass `reconcile: false` to leave the watcher out, or watcher options to tune it.
 */
export function arcStoreNetwork(
  network: string,
  merchantAddress: string,
  facilitator: CircleFacilitatorOptions,
  reconcile: Omit<ArcPaymentWatcherOptions, "network" | "merchant"> | false = {},
): {
  extension: X402NetworkExtension;
  payTo: string;
  asset: string;
  extra: Record<string, unknown>;
  watcher?: ReturnType<typeof createArcPaymentWatcher>;
} {
  const extension = arcResourceExtension(network, facilitator);
  const payTo = assertAddressFor(extension.network, merchantAddress);
  return {
    extension,
    payTo,
    asset: ARC_USDC,
    extra: { ...ARC_USDC_EIP712 },
    ...(reconcile === false
      ? {}
      : {
          watcher: createArcPaymentWatcher({
            ...reconcile,
            network: extension.network,
            merchant: payTo,
          }),
        }),
  };
}

/**
 * The buyer side: lets an agent pay on Arc within a per-payment ceiling. `client` is the
 * official `ExactEvmScheme` client from `@x402/evm/exact/client`, built by the caller around
 * the buyer's own signer (a viem account or a Circle agent wallet); this package never sees
 * the key.
 */
export function arcBuyerExtension(
  network: string,
  client: SchemeNetworkClient,
  maxPerPayment: UsdcMinor,
): BuyerNetworkExtension {
  registerArcNetworks();
  const arc = requireArc(network);
  const ceiling: MinorAmount = usdcOnChain(maxPerPayment, arc);
  return { network: arc, client, asset: ARC_USDC, maxPerPayment: ceiling };
}
