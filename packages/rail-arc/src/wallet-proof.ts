/**
 * Proof that a merchant controls an Arc wallet: EIP-191 `personal_sign` over the challenge text
 * issued by `createWalletChallenge` in @agentpos/core. The merchant signs in their own wallet
 * (MetaMask, Rabby...); no key ever reaches AgentPOS (guardrail 1).
 *
 * Without an RPC the check is offline and covers ordinary wallets (EOAs). With an RPC it also
 * covers smart-contract wallets, which prove control through ERC-1271 / ERC-6492, by asking
 * the chain.
 */
import { createPublicClient, http, verifyMessage } from "viem";
import type { Hex } from "viem";
import type { WalletProofVerifier } from "@agentpos/core";
import { registerWalletProofVerifier } from "@agentpos/core";
import { ARC_RPC_URLS, isArcNetwork } from "./networks.js";

const HEX_SIG = /^0x[0-9a-fA-F]+$/;

export interface ArcWalletProofOptions {
  /**
   * RPC per network for smart-account wallets. Pass `true` to use Arc's public RPCs; omit to
   * verify ordinary wallets offline only.
   */
  rpc?: true | Partial<Record<string, string>>;
}

export function createArcWalletProofVerifier(
  options: ArcWalletProofOptions = {},
): WalletProofVerifier {
  return async ({ caip2, address, message, signature }) => {
    if (!HEX_SIG.test(signature) || !/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
    const rpcUrl =
      options.rpc === true
        ? isArcNetwork(caip2)
          ? ARC_RPC_URLS[caip2]
          : undefined
        : options.rpc?.[caip2];
    try {
      if (rpcUrl) {
        const client = createPublicClient({ transport: http(rpcUrl) });
        return await client.verifyMessage({
          address: address as Hex,
          message,
          signature: signature as Hex,
        });
      }
      return await verifyMessage({ address: address as Hex, message, signature: signature as Hex });
    } catch {
      // Malformed signature bytes: a wrong proof, not an outage.
      return false;
    }
  };
}

/** Registers the EVM verifier with the core for every eip155 network. */
export function registerArcWalletProof(options: ArcWalletProofOptions = {}): void {
  registerWalletProofVerifier("eip155", createArcWalletProofVerifier(options));
}
