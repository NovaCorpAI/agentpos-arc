/**
 * Buy from an AgentPOS store on Arc TESTNET as an agent, over plain HTTP, with your own test
 * wallet. This is how anyone (a grant reviewer included) can try the public demo store:
 *
 *   ARC_TESTNET_BUYER_PRIVATE_KEY=0x... \
 *   STORE_URL=https://arc-demo.agentposhq.com \
 *   pnpm --filter @agentpos/rail-arc buy:arc
 *
 * Fund the wallet with test USDC at https://faucet.circle.com (Arc testnet). The agent searches
 * the store, makes a cart with the cheapest product, and pays on Arc under a mandate that allows
 * only Arc and caps each payment at MAX_USDC (default 5). The store creates the order only after
 * the Circle Facilitator Service settles. Testnet only; the key is read from the environment and
 * never printed.
 *
 * With CIRCLE_BUYER_WALLET_ID set (see circle-wallet:setup) the agent pays from its wallet in
 * Circle Wallets instead, and no private key is read at all.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { createLocalKeypairSigner, resolveConfig } from "@agentpos/core";
import { BuyerService, mandateSchema, SpendingLog } from "@agentpos/mcp-buyer";
import type { Profile } from "@agentpos/mcp-buyer";
import {
  ARC_TESTNET,
  arcBuyerNetwork,
  circleWalletSigner,
  registerArcNetworks,
} from "../src/index.js";
import type { ArcBuyerSigner } from "../src/index.js";
import { env, need } from "./env.js";

const STORE_URL = (process.env.STORE_URL ?? "https://arc-demo.agentposhq.com").replace(/\/$/, "");
const MAX_USDC = process.env.MAX_USDC ?? "5";

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

/** The agent's wallet in Circle Wallets when configured, else a local test key. */
function arcSigner(): ArcBuyerSigner {
  const walletId = env.CIRCLE_BUYER_WALLET_ID;
  if (!walletId) return privateKeyToAccount(need("ARC_TESTNET_BUYER_PRIVATE_KEY") as Hex);
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: need("CIRCLE_WALLETS_API_KEY_TESTNET"),
    entitySecret: need("CIRCLE_ENTITY_SECRET"),
  });
  log(`signing with Circle Wallets (wallet ${walletId}); no private key in this process`);
  return circleWalletSigner(client, {
    walletId,
    address: need("CIRCLE_BUYER_WALLET_ADDRESS") as `0x${string}`,
  });
}

async function main() {
  registerArcNetworks();
  const home = mkdtempSync(join(tmpdir(), "agentpos-buy-on-arc-"));
  process.env.AGENTPOS_HOME = home; // approvals and spending of this run only
  try {
    const core = resolveConfig({
      network: "testnet",
      facilitatorApiKeys: [
        env.AGENTPOS_FACILITATOR_API_KEY_TESTNET ?? env.AGENTPOS_FACILITATOR_API_KEY ?? "",
      ].filter(Boolean),
    });
    if (core.network !== "testnet") throw new Error("testnet only");

    // The mandate leaves Stellar out, so the throwaway Stellar key signs nothing.
    const stellarKey = Keypair.random();
    const profile: Profile = {
      name: "buy-on-arc",
      network: "testnet",
      keyFile: "unused",
      address: stellarKey.publicKey(),
      mandate: mandateSchema.parse({
        maxPerTx: MAX_USDC,
        maxTotal: MAX_USDC,
        allowPhysicalGoods: true,
        allowedNetworks: [ARC_TESTNET],
      }),
      buyer: { email: "agent@example.com", name: "Demo Agent" },
      shipping: {
        name: "Demo Agent",
        line1: "1 Test St",
        city: "Santiago",
        postalCode: "8320000",
        country: "CL",
      },
      sites: [STORE_URL],
      createdAt: new Date().toISOString(),
    };
    const signer = arcSigner();
    log(`buyer wallet on Arc testnet: ${signer.address}`);
    const buyer = new BuyerService({
      profile,
      core,
      spendingLog: new SpendingLog(join(home, "spending.jsonl")),
      signer: createLocalKeypairSigner(stellarKey.secret(), "testnet"),
      networks: [arcBuyerNetwork(ARC_TESTNET, signer)],
      log,
    });

    const offers = await buyer.searchOffers("");
    const pick = [...offers].sort((a, b) =>
      Number(BigInt(a.price.minor) - BigInt(b.price.minor)),
    )[0];
    if (!pick) throw new Error(`no products found at ${STORE_URL}`);
    log(`agent picked "${pick.title}" (${pick.price.minor} minor units, 7 decimals)`);
    const cart = await buyer.createCart(STORE_URL, [{ itemId: pick.id, quantity: 1 }]);
    const result = await buyer.buy(STORE_URL, cart.cartId);
    if (result.receipt.network !== ARC_TESTNET)
      throw new Error(`paid on ${result.receipt.network}, the mandate allows only Arc`);
    log(`settled on Arc: https://explorer.testnet.arc.io/tx/${result.receipt.txHash}`);
    log(`order ${result.orderId} at ${STORE_URL}: status ${JSON.stringify(result.order.status)}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`BUY FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
