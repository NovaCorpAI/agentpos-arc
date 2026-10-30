/**
 * Once: create the buyer agent's wallet on Arc TESTNET in Circle Wallets (developer-controlled,
 * EOA), or show the one already configured.
 *
 *   pnpm --filter @agentpos/rail-arc circle-wallet:setup
 *
 * Needs in .env: CIRCLE_WALLETS_API_KEY_TESTNET (console.circle.com, testnet) and
 * CIRCLE_ENTITY_SECRET (registered in the console). Prints only the wallet id and its public
 * address; put both in .env as CIRCLE_BUYER_WALLET_ID / CIRCLE_BUYER_WALLET_ADDRESS and fund the
 * address with test USDC at https://faucet.circle.com (Arc testnet).
 */
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { env, need } from "./env.js";

async function main() {
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: env.CIRCLE_WALLETS_API_KEY_TESTNET ?? need("AGENTPOS_ARC_FACILITATOR_API_KEY_TESTNET"),
    entitySecret: need("CIRCLE_ENTITY_SECRET"),
  });

  const existing = env.CIRCLE_BUYER_WALLET_ID;
  if (existing) {
    const wallet = (await client.getWallet({ id: existing })).data?.wallet;
    if (!wallet) throw new Error(`no Circle wallet with id ${existing}`);
    console.log(`configured: ${wallet.id} ${wallet.address} on ${wallet.blockchain} (${wallet.accountType})`);
    return;
  }

  const walletSet = (await client.createWalletSet({ name: "agentpos-buyer" })).data?.walletSet;
  if (!walletSet) throw new Error("Circle did not return a wallet set");
  const wallet = (
    await client.createWallets({
      walletSetId: walletSet.id,
      blockchains: ["ARC-TESTNET"],
      count: 1,
      accountType: "EOA",
    })
  ).data?.wallets?.[0];
  if (!wallet) throw new Error("Circle did not return a wallet");
  console.log("created the buyer wallet on Arc testnet. Add to .env:");
  console.log(`  CIRCLE_BUYER_WALLET_ID=${wallet.id}`);
  console.log(`  CIRCLE_BUYER_WALLET_ADDRESS=${wallet.address}`);
  console.log("then fund it with test USDC at https://faucet.circle.com (Arc testnet).");
}

main().catch((err) => {
  console.error(`SETUP FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
