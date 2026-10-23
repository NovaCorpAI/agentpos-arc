import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@stellar/stellar-sdk";
import {
  AgentPOSError,
  buildRouteConfig,
  createWalletChallenge,
  requireChainProfile,
  resolveConfig,
  usdc,
  verifyWalletProof,
} from "@agentpos/core";
import {
  ARC_MAINNET,
  ARC_TESTNET,
  ARC_USDC,
  arcAccept,
  arcResourceExtension,
  createArcWalletProofVerifier,
  isValidArcAddress,
  registerArcWalletProof,
} from "./index.js";

const account = privateKeyToAccount(generatePrivateKey());
const now = new Date("2026-10-23T12:00:00.000Z");

async function codeOf(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return err instanceof AgentPOSError ? err.code : "NOT_AGENTPOS_ERROR";
  }
  return undefined;
}

describe("Arc networks", () => {
  it("registers mainnet and testnet with 6-decimal USDC on import", () => {
    expect(requireChainProfile(ARC_MAINNET).usdcDecimals).toBe(6);
    expect(requireChainProfile(ARC_TESTNET).testnet).toBe(true);
    expect(requireChainProfile(ARC_TESTNET).explorerTxUrl?.("0xabc")).toBe(
      "https://explorer.testnet.arc.io/tx/0xabc",
    );
  });

  it("accepts real addresses and refuses typos, the zero address and Stellar keys", () => {
    expect(isValidArcAddress(account.address)).toBe(true); // checksummed
    expect(isValidArcAddress(account.address.toLowerCase())).toBe(true);
    const broken = account.address.slice(0, -1) + (account.address.endsWith("a") ? "B" : "a");
    const hasMixedCase = /[a-f]/.test(broken.slice(2)) && /[A-F]/.test(broken.slice(2));
    if (hasMixedCase) expect(isValidArcAddress(broken)).toBe(false); // bad checksum
    expect(isValidArcAddress("0x" + "0".repeat(40))).toBe(false);
    expect(isValidArcAddress(Keypair.random().publicKey())).toBe(false);
  });
});

describe("pricing on Arc", () => {
  it("converts a catalog price exactly to Arc's USDC unit", () => {
    const accept = arcAccept(ARC_TESTNET, account.address, usdc("2.5"));
    expect(accept).toMatchObject({ network: ARC_TESTNET, asset: ARC_USDC });
    expect(accept.amount).toEqual({ minor: 2_500_000n, currency: "USDC", decimals: 6 });
  });

  it("refuses to round a price Arc cannot represent", async () => {
    expect(await codeOf(() => arcAccept(ARC_TESTNET, account.address, usdc("1.2345678")))).toBe(
      "INVALID_AMOUNT",
    );
  });

  it("refuses a non-Arc network or a Stellar address", async () => {
    expect(await codeOf(() => arcAccept("eip155:8453", account.address, usdc("1")))).toBe(
      "CHAIN_UNKNOWN",
    );
    expect(
      await codeOf(() => arcAccept(ARC_TESTNET, Keypair.random().publicKey(), usdc("1"))),
    ).toBe("ADDRESS_INVALID");
  });

  it("makes one store route payable on Stellar and on Arc", () => {
    const cfg = resolveConfig();
    const stellarPayTo = Keypair.random().publicKey();
    const route = buildRouteConfig(cfg, { payTo: stellarPayTo, amount: usdc("2.5") }, [
      arcAccept(ARC_TESTNET, account.address, usdc("2.5")),
    ]);
    const accepts = route.accepts as Array<{
      network: string;
      payTo: string;
      price: { amount: string };
    }>;
    expect(accepts.map((a) => [a.network, a.price.amount])).toEqual([
      ["stellar:testnet", "25000000"],
      [ARC_TESTNET, "2500000"],
    ]);
    expect(accepts[1]?.payTo).toBe(account.address);
  });
});

describe("Circle facilitator wiring", () => {
  it("builds the resource extension with an authenticated facilitator", async () => {
    const ext = arcResourceExtension(ARC_TESTNET, {
      url: "https://facilitator.example/",
      apiKey: "test-key",
    });
    expect(ext.network).toBe(ARC_TESTNET);
    const fac = ext.facilitator as {
      url: string;
      createAuthHeaders: () => Promise<Record<string, Record<string, string>>>;
    };
    expect(fac.url).toBe("https://facilitator.example");
    expect((await fac.createAuthHeaders()).settle?.Authorization).toBe("Bearer test-key");
  });

  it("refuses plain http, a missing key and non-Arc networks", async () => {
    expect(
      await codeOf(() => arcResourceExtension(ARC_TESTNET, { url: "http://x", apiKey: "k" })),
    ).toBe("CONFIG_INVALID");
    expect(
      await codeOf(() => arcResourceExtension(ARC_TESTNET, { url: "https://x", apiKey: "" })),
    ).toBe("CONFIG_INVALID");
    expect(
      await codeOf(() => arcResourceExtension("stellar:pubnet", { url: "https://x", apiKey: "k" })),
    ).toBe("CHAIN_UNKNOWN");
  });
});

describe("linking a merchant's Arc wallet", () => {
  it("accepts the wallet's own EIP-191 signature and rejects anyone else's", async () => {
    registerArcWalletProof();
    const challenge = createWalletChallenge({
      caip2: ARC_TESTNET,
      address: account.address,
      domain: "shop.cl",
      now,
    });
    const good = await account.signMessage({ message: challenge.message });
    expect((await verifyWalletProof(challenge, good, { now })).address).toBe(account.address);

    const other = privateKeyToAccount(generatePrivateKey());
    const bad = await other.signMessage({ message: challenge.message });
    expect(await codeOf(() => verifyWalletProof(challenge, bad, { now }))).toBe(
      "WALLET_PROOF_INVALID",
    );
  });

  it("treats garbage as a wrong proof, not a crash", async () => {
    const verify = createArcWalletProofVerifier();
    expect(
      await verify({
        caip2: ARC_TESTNET,
        address: account.address,
        message: "x",
        signature: "0x1234",
      }),
    ).toBe(false);
    expect(
      await verify({
        caip2: ARC_TESTNET,
        address: account.address,
        message: "x",
        signature: "nope",
      }),
    ).toBe(false);
  });
});
