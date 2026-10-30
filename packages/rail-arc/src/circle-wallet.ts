/**
 * The buyer's Arc wallet held in Circle Wallets (developer-controlled, EOA): the agent pays
 * without its key ever entering the agent's process. Every EIP-3009 authorization the x402
 * client asks for is signed by Circle through `signTypedData`, then checked here against the
 * wallet's address before it leaves the process.
 *
 * Pass the client from `@circle-fin/developer-controlled-wallets`
 * (`initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })`); this package does not
 * depend on it, so the store side never installs it.
 */
import { recoverTypedDataAddress } from "viem";
import type { Hex, TypedDataDomain } from "viem";
import { AgentPOSError } from "@agentpos/core";
import type { ArcBuyerSigner } from "./buyer.js";

/** The one call this signer needs from Circle's developer-controlled wallets client. */
export interface CircleTypedDataClient {
  signTypedData(input: {
    walletId: string;
    data: string;
    memo?: string;
  }): Promise<{ data?: { signature?: string } }>;
}

export interface CircleWalletRef {
  /** Circle's id for the wallet (`walletId`). */
  walletId: string;
  /** The wallet's address on Arc. Signatures that do not recover to it are refused. */
  address: `0x${string}`;
}

type TypedDataRequest = Parameters<ArcBuyerSigner["signTypedData"]>[0];

const DOMAIN_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["name", "string"],
  ["version", "string"],
  ["chainId", "uint256"],
  ["verifyingContract", "address"],
  ["salt", "bytes32"],
];

/**
 * The EIP-712 JSON Circle's API takes: an explicit `EIP712Domain` type, and every integer
 * (bigints included, `chainId` too) as a decimal string.
 */
export function circleTypedDataJson(request: TypedDataRequest): string {
  const domainType = DOMAIN_FIELDS.filter(([field]) => request.domain[field] !== undefined).map(
    ([name, type]) => ({ name, type }),
  );
  const { EIP712Domain: _ignored, ...types } = request.types as Record<string, unknown>;
  return JSON.stringify(
    {
      types: { EIP712Domain: domainType, ...types },
      primaryType: request.primaryType,
      domain: request.domain,
      message: request.message,
    },
    (_key, value: unknown) =>
      typeof value === "bigint" || typeof value === "number" ? value.toString() : value,
  );
}

/** `0x`-prefixed, with `v` as 27 or 28 (the Circle Facilitator Service refuses 0 or 1). */
function normalizeSignature(raw: string): Hex {
  const hex = (raw.startsWith("0x") ? raw : `0x${raw}`).toLowerCase();
  if (!/^0x[0-9a-f]{130}$/.test(hex)) {
    throw new AgentPOSError(
      "CONFIG_INVALID",
      "Circle Wallets returned a signature that is not a 65-byte ECDSA signature",
      { hint: "Use an EOA wallet on Arc; smart contract account signatures are not accepted here." },
    );
  }
  const v = parseInt(hex.slice(130), 16);
  if (v === 0 || v === 1) return `${hex.slice(0, 130)}${(v + 27).toString(16)}` as Hex;
  return hex as Hex;
}

/**
 * Use as the signer of `arcBuyerNetwork(ARC_TESTNET, circleWalletSigner(client, wallet))`.
 * The mandate still decides what gets signed: this only replaces where the key lives.
 */
export function circleWalletSigner(
  client: CircleTypedDataClient,
  wallet: CircleWalletRef,
): ArcBuyerSigner {
  return {
    address: wallet.address,
    async signTypedData(request) {
      const response = await client.signTypedData({
        walletId: wallet.walletId,
        data: circleTypedDataJson(request),
        memo: "AgentPOS x402 payment",
      });
      const raw = response.data?.signature;
      if (!raw) {
        throw new AgentPOSError("RAIL_UNAVAILABLE", "Circle Wallets returned no signature", {
          hint: "Check the wallet id, the API key and the entity secret, then retry.",
          retryable: true,
        });
      }
      const signature = normalizeSignature(raw);
      const signer = await recoverTypedDataAddress({
        domain: request.domain as TypedDataDomain,
        types: request.types as Record<string, readonly { name: string; type: string }[]>,
        primaryType: request.primaryType,
        message: request.message,
        signature,
      });
      if (signer.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new AgentPOSError(
          "CONFIG_INVALID",
          `Circle Wallets signed with ${signer}, not with the configured ${wallet.address}`,
          { hint: "The walletId and the address must belong to the same Circle wallet." },
        );
      }
      return signature;
    },
  };
}
