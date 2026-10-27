import { describe, expect, it } from "vitest";
import { usdc } from "@agentpos/core";
import { ARC_TESTNET, createArcPaymentWatcher, reconcileArcPayments } from "./index.js";
import type { ArcTransfer, FetchTransfersInput } from "./index.js";

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

describe("Arc payment watcher (D3)", () => {
  const MERCHANT = "0x75284c0856d11112321014Cd4405dEc5d84393f8";

  it("reads from the lookback on the first pass, then only new blocks, one entry per tx", async () => {
    let head = 100_000n;
    const ranges: Array<[bigint, bigint | undefined]> = [];
    let next: ArcTransfer[] = [transfer("0xAAA", 2_000_000n, 1), transfer("0xaaa", 500_000n, 2)];
    const watcher = createArcPaymentWatcher({
      network: ARC_TESTNET,
      merchant: MERCHANT,
      head: async () => head,
      fetchTransfers: async (input: FetchTransfersInput) => {
        ranges.push([input.fromBlock, input.toBlock]);
        const out = next;
        next = [];
        return out;
      },
    });
    expect(await watcher.recentPayments()).toEqual([
      { txHash: "0xaaa", amountMinor: usdc("2.5"), from: "0xbuyer" },
    ]);
    head = 100_050n;
    expect(await watcher.recentPayments()).toEqual([]);
    expect(ranges).toEqual([
      [80_000n, 100_000n],
      [100_001n, 100_050n],
    ]);
  });

  it("reads a failed window again on the next pass", async () => {
    let fail = true;
    const froms: bigint[] = [];
    const watcher = createArcPaymentWatcher({
      network: ARC_TESTNET,
      merchant: MERCHANT,
      lookbackBlocks: 10n,
      head: async () => 50n,
      fetchTransfers: async (input: FetchTransfersInput) => {
        froms.push(input.fromBlock);
        if (fail) throw new Error("RPC down");
        return [];
      },
    });
    await expect(watcher.recentPayments()).rejects.toThrow("RPC down");
    fail = false;
    await watcher.recentPayments();
    expect(froms).toEqual([40n, 40n]);
  });

  it("refuses a network that is not Arc", () => {
    expect(() =>
      createArcPaymentWatcher({ network: "stellar:testnet", merchant: MERCHANT }),
    ).toThrow(/not an Arc network/);
  });
});
