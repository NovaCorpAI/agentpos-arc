import { describe, expect, it } from "vitest";
import { usdc } from "@agentpos/core";
import { ARC_TESTNET, reconcileArcPayments } from "./index.js";
import type { ArcTransfer } from "./index.js";

const transfer = (txHash: string, minor: bigint, logIndex = 3): ArcTransfer => ({
  txHash,
  logIndex,
  blockNumber: 1n,
  from: "0xbuyer",
  to: "0xmerchant",
  amount: { minor, currency: "USDC", decimals: 6 },
});

describe("reconciliation on Arc", () => {
  it("matches an order to its transfer, comparing in the catalog's unit", () => {
    const r = reconcileArcPayments(
      [transfer("0xAAA", 3_000_000n)],
      [{ orderId: "ord_1", txHash: "0xaaa", network: ARC_TESTNET, amountMinor: usdc("3") }],
    );
    expect(r.matched).toEqual([{ orderId: "ord_1", txHash: "0xaaa" }]);
    expect(r.paymentsWithoutOrder).toEqual([]);
    expect(r.ordersWithoutPayment).toEqual([]);
  });

  it("flags money in the wallet that no order explains", () => {
    const r = reconcileArcPayments([transfer("0xbbb", 250_000n)], []);
    expect(r.paymentsWithoutOrder.map((t) => t.txHash)).toEqual(["0xbbb"]);
  });

  it("flags an order whose transaction the chain does not show, or shows for another amount", () => {
    const r = reconcileArcPayments(
      [transfer("0xccc", 1_000_000n)],
      [
        { orderId: "ord_missing", txHash: "0xddd", network: ARC_TESTNET, amountMinor: usdc("1") },
        { orderId: "ord_short", txHash: "0xccc", network: ARC_TESTNET, amountMinor: usdc("2") },
      ],
    );
    expect(r.ordersWithoutPayment.map((o) => o.orderId)).toEqual(["ord_missing", "ord_short"]);
    expect(r.ordersWithoutPayment[1]?.reason).toContain("amount differs");
    expect(r.matched).toEqual([]);
  });

  it("ignores orders paid on other networks", () => {
    const r = reconcileArcPayments(
      [],
      [{ orderId: "ord_stellar", txHash: "abc", network: "stellar:testnet", amountMinor: 1n }],
    );
    expect(r).toEqual({ matched: [], paymentsWithoutOrder: [], ordersWithoutPayment: [] });
  });
});
