/**
 * End to end on Arc TESTNET against a real WooCommerce store (the AgentPOS demo store in docker,
 * `pnpm demo:up` in the core repo, http://localhost:8080):
 *   scan the store -> confirm and publish the catalog -> the sidecar offers Stellar and Arc
 *   -> a buyer agent pays on Arc with its own test wallet (per-payment ceiling)
 *   -> the Circle Facilitator Service settles -> the paid order is created in WooCommerce.
 *
 * Testnet only. Keys come from ../../.env and are never printed. The store's receipt key lives
 * in memory only.
 */
import { Keypair } from "@stellar/stellar-sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { resolveConfig, rescaleMinor, USDC_DECIMALS } from "@agentpos/core";
import { WooCommerceConnector } from "@agentpos/connectors";
import { scanSite } from "@agentpos/scanner";
import { CatalogService, createAgentPOSApp, parseSiteConfig, SiteStorage } from "@agentpos/site";
import { ARC_TESTNET, ARC_USDC, arcStoreNetwork, registerArcNetworks } from "../src/index.js";
import { env, need } from "./env.js";

const WOO_URL = process.env.DEMO_STORE_URL ?? "http://localhost:8080";
const WOO_CK = "ck_agentposdemo0000000000000000000000000000"; // public demo key, docker only
const WOO_CS = "cs_agentposdemo0000000000000000000000000000";
const CEILING_ARC_MINOR = 15_000_000n; // the buyer's per-payment ceiling: 15 USDC (6 decimals)

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

async function main() {
  registerArcNetworks();
  const buyer = privateKeyToAccount(need("ARC_TESTNET_BUYER_PRIVATE_KEY") as Hex);
  const merchant = need("ARC_TESTNET_MERCHANT_ADDRESS");
  const core = resolveConfig({
    network: "testnet",
    facilitatorApiKeys: [
      env.AGENTPOS_FACILITATOR_API_KEY_TESTNET ?? env.AGENTPOS_FACILITATOR_API_KEY ?? "",
    ].filter(Boolean),
  });
  if (core.network !== "testnet") throw new Error("testnet only");

  // ---- seller side: the merchant's own WooCommerce, scanned, confirmed, published ----
  const connector = new WooCommerceConnector({
    baseUrl: WOO_URL,
    consumerKey: WOO_CK,
    consumerSecret: WOO_CS,
    allowInsecureHttp: true,
  });
  const storage = new SiteStorage(":memory:");
  const site = parseSiteConfig({
    siteUrl: WOO_URL,
    displayName: "AgentPOS Demo Store (Arc)",
    payTo: "GDTD355XEM6S5DAZGZUO46I3X6YYB4EBHP2UPKA6F7NVGTRCQ7SZNG5P",
    platform: "woocommerce",
    woocommerce: { baseUrl: WOO_URL, allowInsecureHttp: true },
  });
  const scan = await scanSite({
    baseUrl: WOO_URL,
    connector,
    fetcher: { minIntervalMs: 0 },
    maxPages: 20,
  });
  storage.replaceDrafts(scan.drafts);
  const catalog = new CatalogService(storage);
  for (const d of scan.drafts)
    if (d.priceUsdcSuggested !== undefined) catalog.confirm(d, d.priceUsdcSuggested);
  const published = catalog.publishAll();
  log(`scanned ${scan.drafts.length} products, published ${published.length}`);

  const store = createAgentPOSApp({
    site,
    core,
    connector,
    storage,
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

  // ---- buyer side: an agent picks the cheapest physical product it can afford ----
  const listing = (await (await storeFetch(`${WOO_URL}/agentpos/catalog`)).json()) as {
    items: Array<{ id: string; title: string; price: { minor: string }; physical?: boolean }>;
  };
  const affordable = listing.items
    .filter((i) => rescaleMinor(BigInt(i.price.minor), USDC_DECIMALS, 6) <= CEILING_ARC_MINOR)
    .sort((a, b) => (BigInt(a.price.minor) < BigInt(b.price.minor) ? -1 : 1));
  const pick = affordable[0];
  if (!pick) throw new Error("nothing affordable in the catalog");
  log(`agent picks "${pick.title}" (${pick.price.minor} minor units, 7 decimals)`);

  const cartRes = await storeFetch(`${WOO_URL}/agentpos/cart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [{ itemId: pick.id, quantity: 1 }],
      buyer: { email: "agent@example.com", name: "Agent Smith" },
      shipping: {
        name: "Agent Smith",
        line1: "1 Loop St",
        city: "Santiago",
        postalCode: "8320000",
        country: "CL",
      },
    }),
  });
  const cart = (await cartRes.json()) as {
    cartId: string;
    checkout: string;
    quote: { total: string };
  };
  if (!cart.checkout) throw new Error(`cart failed: ${cartRes.status} ${JSON.stringify(cart)}`);
  log(`cart ${cart.cartId}: ${cart.quote.total} USDC`);

  // Only Arc, only USDC, at most the ceiling per payment: enforced by the SDK before signing.
  const client = x402Client.fromConfig({
    schemes: [{ network: ARC_TESTNET, client: new ExactEvmScheme(buyer) }],
    spendControls: {
      maxAmountPerPayment: false,
      allowedAssets: [
        {
          network: ARC_TESTNET,
          asset: ARC_USDC,
          maxAmountPerPayment: CEILING_ARC_MINOR.toString(),
        },
      ],
    },
  });
  const pay = wrapFetchWithPayment(storeFetch as typeof fetch, new x402HTTPClient(client));
  const paid = await pay(cart.checkout, { method: "POST" });
  const body = (await paid.json().catch(() => ({}))) as {
    order?: { id?: string; externalOrderId?: string; status?: string };
  };
  log(`checkout -> HTTP ${paid.status}`);
  if (paid.status !== 200) throw new Error(`payment failed: ${JSON.stringify(body).slice(0, 600)}`);
  const settled = new x402HTTPClient(new x402Client()).getPaymentSettleResponse((n) =>
    paid.headers.get(n),
  );
  log(`settled on ${settled.network}: https://explorer.testnet.arc.io/tx/${settled.transaction}`);

  const order = storage.getOrderByCart(cart.cartId);
  if (!order?.externalOrderId)
    throw new Error(`order not created in WooCommerce: ${JSON.stringify(order)}`);
  log(`order ${order.id} -> WooCommerce #${order.externalOrderId} (${order.status})`);
  const woo = (await (
    await fetch(
      `${WOO_URL}/wp-json/wc/v3/orders/${order.externalOrderId}?consumer_key=${WOO_CK}&consumer_secret=${WOO_CS}`,
    )
  ).json()) as {
    status: string;
    transaction_id: string;
    total: string;
    meta_data?: Array<{ key: string; value: unknown }>;
  };
  log(
    `WooCommerce #${order.externalOrderId}: status=${woo.status} transaction_id=${woo.transaction_id}`,
  );
  if (woo.transaction_id !== settled.transaction)
    throw new Error("WooCommerce order does not carry the Arc tx hash");

  // Reconciliation (D3): the sidecar reads the merchant's wallet on Arc and finds this payment
  // already recorded, so nothing is reported as money without an order.
  const [rec] = (await store.reconciler?.run()) ?? [];
  if (!rec || rec.error || rec.paymentsWithoutOrder !== 0)
    throw new Error(`reconciliation did not come back clean: ${JSON.stringify(rec)}`);
  log(`reconciliation on ${rec.network}: 0 payments without an order`);
  log(
    `E2E OK: agent bought "${pick.title}" on Arc testnet, Circle settled, WooCommerce order #${order.externalOrderId} paid`,
  );
}

main().catch((err) => {
  console.error(`E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
