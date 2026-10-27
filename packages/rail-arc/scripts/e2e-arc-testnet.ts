/**
 * End to end on Arc TESTNET, with real money of no value:
 *   an AgentPOS store (in memory) offers Stellar and Arc in its 402
 *   -> a buyer agent pays on Arc with its own test wallet (EIP-3009, signed locally)
 *   -> the Circle Facilitator Service settles on Arc testnet
 *   -> the store creates the order with the amount in the catalog's unit.
 *
 * Reads keys from ../../.env (never printed). Testnet only: refuses to run otherwise.
 */
import { Keypair } from "@stellar/stellar-sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { resolveConfig, usdc } from "@agentpos/core";
import type { CatalogItem, OrderConnector, PaidOrderInput } from "@agentpos/core";
import { createAgentPOSApp, parseSiteConfig, SiteStorage } from "@agentpos/site";
import { ARC_TESTNET, arcStoreNetwork, registerArcNetworks } from "../src/index.js";
import { env, need } from "./env.js";

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

async function main() {
  registerArcNetworks();
  const buyer = privateKeyToAccount(need("ARC_TESTNET_BUYER_PRIVATE_KEY") as Hex);
  const merchant = need("ARC_TESTNET_MERCHANT_ADDRESS");
  log(`buyer ${buyer.address} -> merchant ${merchant} on ${ARC_TESTNET}`);

  const core = resolveConfig({
    network: "testnet",
    facilitatorApiKeys: [
      env.AGENTPOS_FACILITATOR_API_KEY_TESTNET ?? env.AGENTPOS_FACILITATOR_API_KEY ?? "",
    ].filter(Boolean),
  });
  if (core.network !== "testnet") throw new Error("testnet only");

  const site = parseSiteConfig({
    siteUrl: "https://arc-e2e.agentpos.local",
    displayName: "AgentPOS Arc e2e",
    payTo: "GDTD355XEM6S5DAZGZUO46I3X6YYB4EBHP2UPKA6F7NVGTRCQ7SZNG5P",
    platform: "generic",
    cartTtlMinutes: 10,
  });
  const storage = new SiteStorage(":memory:");
  const item: CatalogItem = {
    id: "arc-e2e-coffee",
    externalId: "arc-1",
    type: "product",
    title: "AgentPOS on Arc test coffee",
    descriptionAgent: "A test item for the Arc end-to-end purchase.",
    url: "https://arc-e2e.agentpos.local/coffee",
    attributes: {},
    priceUsdc: usdc("0.25"),
    stockMode: "untracked",
    physical: false,
    status: "published",
    sourceEvidence: [{ source: "e2e", locator: "script" }],
  };
  storage.upsertItem(item);
  const created: PaidOrderInput[] = [];
  const connector = {
    platform: "generic",
    getAvailability: async (items: Array<{ itemId: string }>) =>
      items.map((i) => ({ itemId: i.itemId, available: true })),
    createOrder: async (input: PaidOrderInput) => {
      created.push(input);
      return { externalOrderId: `mem-${created.length}` };
    },
  } as unknown as OrderConnector;

  const store = createAgentPOSApp({
    site,
    core,
    connector,
    storage,
    // Ephemeral receipt key held in memory only: an e2e store must never write a key to disk.
    receiptSecret: Keypair.random().secret(),
    x402Networks: [
      arcStoreNetwork(ARC_TESTNET, merchant, {
        url: need("AGENTPOS_ARC_FACILITATOR_URL"),
        apiKey: need("AGENTPOS_ARC_FACILITATOR_API_KEY_TESTNET"),
      }),
    ],
  });
  const storeFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    store.fetch(input instanceof Request ? input : new Request(input, init));

  const cartRes = await storeFetch("https://arc-e2e.agentpos.local/agentpos/cart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [{ itemId: item.id, quantity: 1 }],
      buyer: { email: "agent@example.com" },
    }),
  });
  const cart = (await cartRes.json()) as {
    cartId: string;
    checkout: string;
    quote: { totalMinor: string };
  };
  if (!cart.checkout) throw new Error(`cart failed: ${cartRes.status} ${JSON.stringify(cart)}`);
  log(`cart ${cart.cartId} total ${cart.quote.totalMinor} (catalog unit, 7 decimals)`);

  // The buyer agent: pays only on Arc, only USDC, at most 1 USDC per payment.
  const client = new x402Client((_version, accepts) => {
    const arc = accepts.find((a) => a.network === ARC_TESTNET);
    if (!arc) throw new Error("store does not offer Arc");
    if (BigInt(arc.amount) > 1_000_000n) throw new Error("over the per-payment ceiling");
    return arc;
  });
  registerExactEvmScheme(client, { signer: buyer });
  const pay = wrapFetchWithPayment(storeFetch as typeof fetch, new x402HTTPClient(client));

  const paid = await pay(cart.checkout, { method: "POST" });
  const body = await paid.text();
  log(`checkout -> HTTP ${paid.status}`);
  if (paid.status !== 200) throw new Error(`payment failed: ${body.slice(0, 600)}`);
  const settled = new x402HTTPClient(new x402Client()).getPaymentSettleResponse((n) =>
    paid.headers.get(n),
  );
  log(`settled on ${settled.network}: tx ${settled.transaction}`);
  log(`  https://explorer.testnet.arc.io/tx/${settled.transaction}`);

  const order = created[0];
  if (!order) throw new Error("no order created after settlement");
  log(
    `order ${order.orderId} -> ${order.payment.network}, amount ${order.payment.amountMinor} (catalog unit)`,
  );
  if (order.payment.amountMinor !== usdc("0.25")) throw new Error("amount mismatch");
  log(`E2E OK: agent paid 0.25 USDC on Arc testnet, Circle settled, order created`);
}

main().catch((err) => {
  console.error(`E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
