/**
 * Reconciliation on Arc: what the chain says the merchant received, against what the store
 * recorded. It catches the two failures that matter for money (guardrail 6):
 *  - a payment that reached the merchant's wallet but has no order (settled, then the store
 *    crashed before recording it), and
 *  - an order marked paid whose transaction the chain does not show, or shows with a different
 *    amount or recipient.
 *
 * Read-only: it never moves funds and needs no key. On Arc, a USDC payment emits two Transfer
 * logs: the ERC-20 one from the USDC contract (6 decimals), and a mirror of the native balance
 * from a system address (18 decimals). Only the ERC-20 log counts.
 */
import { createPublicClient, http, parseAbiItem } from "viem";
import type { Hex } from "viem";
import type { MinorAmount } from "@agentpos/core";
import { AgentPOSError, rescaleMinor, USDC_DECIMALS } from "@agentpos/core";
import { ARC_RPC_URLS, ARC_USDC, ARC_USDC_DECIMALS, isArcNetwork } from "./networks.js";

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/** The public Arc RPC answers eth_getLogs for at most 10,000 blocks per call. */
const MAX_WINDOW = 9_000n;

export interface ArcTransfer {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  from: string;
  to: string;
  /** USDC in Arc's unit (6 decimals). */
  amount: MinorAmount;
}

export interface FetchTransfersInput {
  network: string;
  merchant: string;
  fromBlock: bigint;
  toBlock?: bigint;
  rpcUrl?: string;
}

/** Every USDC transfer into the merchant's wallet in the block range, in 9,000-block windows. */
export async function fetchArcUsdcTransfers(input: FetchTransfersInput): Promise<ArcTransfer[]> {
  if (!isArcNetwork(input.network)) {
    throw new AgentPOSError("CHAIN_UNKNOWN", `'${input.network}' is not an Arc network`, {
      hint: "Use eip155:5042 or eip155:5042002.",
    });
  }
  const client = createPublicClient({
    transport: http(input.rpcUrl ?? ARC_RPC_URLS[input.network]),
  });
  try {
    // Never ask past the chain's head: the RPC refuses ranges it has not produced yet.
    const head = await client.getBlockNumber();
    const to = input.toBlock !== undefined && input.toBlock < head ? input.toBlock : head;
    const out: ArcTransfer[] = [];
    for (let start = input.fromBlock; start <= to; start += MAX_WINDOW + 1n) {
      const end = start + MAX_WINDOW > to ? to : start + MAX_WINDOW;
      const logs = await client.getLogs({
        address: ARC_USDC,
        event: TRANSFER,
        args: { to: input.merchant as Hex },
        fromBlock: start,
        toBlock: end,
      });
      for (const log of logs) {
        if (!log.transactionHash || log.args.value === undefined) continue;
        out.push({
          txHash: log.transactionHash,
          logIndex: log.logIndex ?? 0,
          blockNumber: log.blockNumber ?? 0n,
          from: log.args.from ?? "",
          to: log.args.to ?? "",
          amount: { minor: log.args.value, currency: "USDC", decimals: ARC_USDC_DECIMALS },
        });
      }
    }
    return out;
  } catch (cause) {
    throw new AgentPOSError("RAIL_UNAVAILABLE", "Could not read Arc transfers from the RPC", {
      hint: "The RPC did not answer this range; retry later or use another Arc RPC (rpcUrl).",
      retryable: true,
      details: { network: input.network, fromBlock: input.fromBlock.toString() },
      cause,
    });
  }
}

/** An order as the store recorded it: amount in the catalog's unit (7 decimals). */
export interface RecordedArcPayment {
  orderId: string;
  txHash: string;
  network: string;
  amountMinor: bigint;
}

export interface ArcReconciliation {
  matched: Array<{ orderId: string; txHash: string }>;
  /** Money in the wallet with no order: create or refund, never ignore. */
  paymentsWithoutOrder: ArcTransfer[];
  /** Orders marked paid that the chain does not confirm as recorded. */
  ordersWithoutPayment: Array<{ orderId: string; txHash: string; reason: string }>;
}

/**
 * Pure comparison, so it is testable without a network. Amounts are compared in the catalog's
 * unit after an exact conversion from Arc's 6 decimals.
 */
export function reconcileArcPayments(
  transfers: ReadonlyArray<ArcTransfer>,
  orders: ReadonlyArray<RecordedArcPayment>,
): ArcReconciliation {
  const byTx = new Map<string, ArcTransfer[]>();
  for (const t of transfers) {
    const key = t.txHash.toLowerCase();
    byTx.set(key, [...(byTx.get(key) ?? []), t]);
  }
  const seen = new Set<string>();
  const result: ArcReconciliation = {
    matched: [],
    paymentsWithoutOrder: [],
    ordersWithoutPayment: [],
  };
  for (const order of orders) {
    if (!isArcNetwork(order.network)) continue;
    const key = order.txHash.toLowerCase();
    const found = byTx.get(key);
    if (!found || found.length === 0) {
      result.ordersWithoutPayment.push({
        orderId: order.orderId,
        txHash: order.txHash,
        reason: "transaction not found as a USDC transfer to the merchant",
      });
      continue;
    }
    const received = found.reduce((sum, t) => sum + t.amount.minor, 0n);
    const receivedCatalog = rescaleMinor(received, ARC_USDC_DECIMALS, USDC_DECIMALS);
    seen.add(key);
    if (receivedCatalog !== order.amountMinor) {
      result.ordersWithoutPayment.push({
        orderId: order.orderId,
        txHash: order.txHash,
        reason: `amount differs: chain ${receivedCatalog}, order ${order.amountMinor} (catalog unit)`,
      });
      continue;
    }
    result.matched.push({ orderId: order.orderId, txHash: order.txHash });
  }
  for (const [key, list] of byTx) if (!seen.has(key)) result.paymentsWithoutOrder.push(...list);
  return result;
}
