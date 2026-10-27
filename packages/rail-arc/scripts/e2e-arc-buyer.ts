/**
 * End to end on Arc TESTNET through the AgentPOS buyer and its mandate (M2, M3), against the
 * AgentPOS demo WooCommerce store (`pnpm demo:up` in the core repo, http://localhost:8080):
 *   the store offers Stellar and Arc -> a BuyerService whose mandate allows only Arc finds a
 *   product, makes a cart and buys it -> the mandate caps the payment at the cart total, on Arc
 *   only -> the Circle Facilitator Service settles -> the order is paid in WooCommerce, the
 *   spending log counts it in the catalog's unit, and the store's reconciliation comes back clean.
 *
 * Testnet only. Keys come from ../../.env and are never printed. The buyer's Stellar side gets a
 * throwaway keypair: the mandate leaves Stellar out, so its ceiling is zero and it signs nothing.
 */
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createBuyerClient, createLocalKeypairSigner, resolveConfig, usdc } from "@agentpos/core";
import { WooCommerceConnector } from "@agentpos/connectors";
import { BuyerService, mandateSchema, SpendingLog } from "@agentpos/mcp-buyer";
import type { Profile } from "@agentpos/mcp-buyer";
import { scanSite } from "@agentpos/scanner";
import { CatalogService, createAgentPOSApp, parseSiteConfig, SiteStorage } from "@agentpos/site";
import {
  ARC_TESTNET,
  arcBuyerNetwork,
  arcStoreNetwork,
  registerArcNetworks,
} from "../src/index.js";

const WOO_URL = process.env.DEMO_STORE_URL ?? "http://localhost:8080";
const WOO_CK = "ck_agentposdemo0000000000000000000000000000"; // public demo key, docker only
const WOO_CS = "cs_agentposdemo0000000000000000000000000000";

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[2]) out[m[1] as string] = m[2].trim();
  }
  return out;
}
const env = { ...loadEnv("../../.env"), ...loadEnv("../../../agentgate/.env") };
const need = (k: string): string => {
  const v = env[k];
  if (!v) throw new Error(`missing ${k} in .env`);
  return v;
};
const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

async function main() {
  registerArcNetworks();
  const home = mkdtempSync(join(tmpdir(), "agentpos-arc-buyer-"));
  process.env.AGENTPOS_HOME = home; // approvals and profiles of this run only
  try {
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
    log(`scanned ${scan.drafts.length} products, published ${catalog.publishAll().length}`);
    const store = createAgentPOSApp({
      site: parseSiteConfig({
        siteUrl: WOO_URL,
        displayName: "AgentPOS Demo Store (Arc)",
        payTo: "GDTD355XEM6S5DAZGZUO46I3X6YYB4EBHP2UPKA6F7NVGTRCQ7SZNG5P",
        platform: "woocommerce",
        woocommerce: { baseUrl: WOO_URL, allowInsecureHttp: true },
      }),
      core,
      connector,
      storage,
      receiptSecret: Keypair.random().secret(),
      x402Networks: [
        arcStoreNetwork(ARC_TESTNET, need("ARC_TESTNET_MERCHANT_ADDRESS"), {
          url: need("AGENTPOS_ARC_FACILITATOR_URL"),
          apiKey: need("AGENTPOS_ARC_FACILITATOR_API_KEY_TESTNET"),
        }),
      ],
    });
    const storeFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      store.fetch(input instanceof Request ? input : new Request(input, init))) as typeof fetch;

    // ---- buyer side: the human's mandate allows Arc only, 15 USDC per payment ----
    const stellarKey = Keypair.random();
    const profile: Profile = {
      name: "arc-e2e",
      network: "testnet",
      keyFile: "unused",
      address: stellarKey.publicKey(),
      mandate: mandateSchema.parse({
        maxPerTx: "15",
        maxTotal: "20",
        allowPhysicalGoods: true,
        allowedNetworks: [ARC_TESTNET],
      }),
      buyer: { email: "agent@example.com", name: "Agent Smith" },
      shipping: {
        name: "Agent Smith",
        line1: "1 Loop St",
        city: "Santiago",
        postalCode: "8320000",
        country: "CL",
      },
      sites: [WOO_URL],
      createdAt: new Date().toISOString(),
    };
    const spending = new SpendingLog(join(home, "spending.jsonl"));
    const buyer = new BuyerService({
      profile,
      core,
      fetchImpl: storeFetch,
      spendingLog: spending,
      signer: createLocalKeypairSigner(stellarKey.secret(), "testnet"),
      networks: [
        arcBuyerNetwork(
          ARC_TESTNET,
          privateKeyToAccount(need("ARC_TESTNET_BUYER_PRIVATE_KEY") as Hex),
        ),
      ],
      // The real x402 client and spend controls, pointed at the in-process store.
      payFetchFactory: (c, signer, limits, extensions) =>
        wrapFetchWithPayment(storeFetch, createBuyerClient(c, signer, limits, extensions)),
      log,
    });

    const offers = (await buyer.searchOffers("sticker")).filter(
      (o) => BigInt(o.price.minor) <= usdc("15"),
    );
    const pick = offers[0];
    if (!pick) throw new Error("no affordable sticker in the catalog");
    log(`agent found "${pick.title}" at ${pick.price.minor} minor units (7 decimals)`);
    const cart = await buyer.createCart(WOO_URL, [{ itemId: pick.id, quantity: 1 }]);
    const result = await buyer.buy(WOO_URL, cart.cartId);
    if (result.receipt.network !== ARC_TESTNET)
      throw new Error(`paid on ${result.receipt.network}, the mandate allows only Arc`);
    log(
      `settled on ${result.receipt.network}: https://explorer.testnet.arc.io/tx/${result.receipt.txHash}`,
    );

    const [entry] = spending.entries();
    if (!entry || entry.network !== ARC_TESTNET)
      throw new Error(`spending log: ${JSON.stringify(entry)}`);
    log(`spending log: ${entry.amountMinor} (catalog unit) on ${entry.network}`);

    const order = storage.getOrderByCart(cart.cartId);
    if (!order?.externalOrderId) throw new Error(`order not created: ${JSON.stringify(order)}`);
    const woo = (await (
      await fetch(
        `${WOO_URL}/wp-json/wc/v3/orders/${order.externalOrderId}?consumer_key=${WOO_CK}&consumer_secret=${WOO_CS}`,
      )
    ).json()) as { status: string; transaction_id: string };
    if (woo.transaction_id !== result.receipt.txHash)
      throw new Error("WooCommerce order does not carry the Arc tx hash");
    log(`WooCommerce #${order.externalOrderId}: status=${woo.status}`);

    const [rec] = (await store.reconciler?.run()) ?? [];
    if (!rec || rec.error || rec.paymentsWithoutOrder !== 0)
      throw new Error(`reconciliation did not come back clean: ${JSON.stringify(rec)}`);
    log(`reconciliation on ${rec.network}: 0 payments without an order`);
    log(
      `E2E OK: the buyer's mandate paid "${pick.title}" on Arc only, WooCommerce order #${order.externalOrderId} paid`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
