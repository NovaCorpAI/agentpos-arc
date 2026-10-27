import { describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { usdc } from "@agentpos/core";
import { ARC_TESTNET, ARC_USDC, arcBuyerNetwork } from "./index.js";

describe("arcBuyerNetwork", () => {
  const network = arcBuyerNetwork(ARC_TESTNET, privateKeyToAccount(generatePrivateKey()));

  it("caps each payment at the cart total, converted exactly to Arc's 6 decimals", () => {
    const ext = network(usdc("2.5"));
    expect(ext.network).toBe(ARC_TESTNET);
    expect(ext.asset).toBe(ARC_USDC);
    expect(ext.maxPerPayment).toEqual({ minor: 2_500_000n, currency: "USDC", decimals: 6 });
  });

  it("refuses a ceiling Arc cannot represent instead of rounding it", () => {
    expect(() => network(usdc("0.0000001"))).toThrow();
  });
});
