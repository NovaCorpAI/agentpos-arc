/**
 * Arc, Circle's L1, as AgentPOS sees it: two networks, USDC with 6 decimals in its ERC-20
 * interface, EVM addresses with EIP-55 checksums.
 *
 * Sources (checked 2026-10-23): docs.arc.io/arc/references/connect-to-arc and
 * contract-addresses; @x402/evm 2.28.0 default asset table (USDC "USDC" version "2", EIP-3009).
 * Arc pays gas in USDC; the native balance has 18 decimals, but payments always use the
 * ERC-20 interface at the address below, which has 6. AgentPOS never touches the native unit.
 */
import { getAddress, isAddress } from "viem";
import type { ChainProfile } from "@agentpos/core";
import { registerChainProfile } from "@agentpos/core";

export const ARC_MAINNET = "eip155:5042" as const;
export const ARC_TESTNET = "eip155:5042002" as const;
export type ArcNetwork = typeof ARC_MAINNET | typeof ARC_TESTNET;

/** USDC on Arc, same address on mainnet and testnet. ERC-20 interface, 6 decimals. */
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
export const ARC_USDC_DECIMALS = 6;
/**
 * EIP-712 domain of USDC on Arc, which the exact scheme needs in every 402 so the buyer can sign
 * the EIP-3009 authorization. Confirmed by the Circle facilitator's /supported on 2026-10-23.
 */
export const ARC_USDC_EIP712 = { name: "USDC", version: "2" } as const;

export const ARC_RPC_URLS: Record<ArcNetwork, string> = {
  [ARC_MAINNET]: "https://rpc.mainnet.arc.io",
  [ARC_TESTNET]: "https://rpc.testnet.arc.io",
};

const EXPLORERS: Record<ArcNetwork, string> = {
  [ARC_MAINNET]: "https://explorer.arc.io",
  [ARC_TESTNET]: "https://explorer.testnet.arc.io",
};

/**
 * Strict EVM receiving address: well formed, not the zero address, and when it is written in
 * mixed case its EIP-55 checksum must be right (a wrong checksum is a typo, and a typo in a
 * payTo sends a merchant's money nowhere).
 */
export function isValidArcAddress(address: string): boolean {
  if (!isAddress(address, { strict: false })) return false;
  if (/^0x0{40}$/i.test(address)) return false;
  const hex = address.slice(2);
  const mixedCase = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
  return mixedCase ? getAddress(address) === address : true;
}

const profile = (caip2: ArcNetwork, testnet: boolean): ChainProfile => ({
  caip2,
  family: "eip155",
  label: testnet ? "Arc testnet" : "Arc",
  testnet,
  usdcDecimals: ARC_USDC_DECIMALS,
  isValidAddress: isValidArcAddress,
  explorerTxUrl: (tx) => `${EXPLORERS[caip2]}/tx/${encodeURIComponent(tx)}`,
});

export const ARC_CHAIN_PROFILES: readonly ChainProfile[] = [
  profile(ARC_MAINNET, false),
  profile(ARC_TESTNET, true),
];

/** Registers both Arc networks with the core. Safe to call more than once. */
export function registerArcNetworks(): void {
  for (const p of ARC_CHAIN_PROFILES) registerChainProfile(p);
}

export function isArcNetwork(value: string): value is ArcNetwork {
  return value === ARC_MAINNET || value === ARC_TESTNET;
}
