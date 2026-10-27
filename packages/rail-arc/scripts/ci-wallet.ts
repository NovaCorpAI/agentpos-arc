/**
 * Balance of the CI buyer wallet on Arc testnet (risk E4), checked before the e2e spends from it.
 * Below ARC_CI_WARN_USDC (default 5) it warns; below ARC_CI_MIN_USDC (default 1) it stops the job
 * before any payment, naming the address to refill at faucet.circle.com. Read-only: it derives
 * the address from the key and never prints the key.
 */
import fs from "node:fs";
import { createPublicClient, erc20Abi, http } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { formatUsdc, rescaleMinor, usdc, USDC_DECIMALS, usdcFromMinor } from "@agentpos/core";
import { ARC_RPC_URLS, ARC_TESTNET, ARC_USDC, ARC_USDC_DECIMALS } from "../src/index.js";
import { env, need } from "./env.js";

// Thresholds are written in USDC and compared in Arc's unit, converted exactly (never rounded).
const toArcMinor = (decimal: string): bigint =>
  rescaleMinor(usdc(decimal), USDC_DECIMALS, ARC_USDC_DECIMALS);

async function main() {
  const address = privateKeyToAccount(need("ARC_TESTNET_BUYER_PRIVATE_KEY") as Hex).address;
  const warnBelow = toArcMinor(env.ARC_CI_WARN_USDC ?? "5");
  const stopBelow = toArcMinor(env.ARC_CI_MIN_USDC ?? "1");
  const client = createPublicClient({ transport: http(ARC_RPC_URLS[ARC_TESTNET]) });
  const balance = await client.readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
  const shown = `${formatUsdc(usdcFromMinor(rescaleMinor(balance, ARC_USDC_DECIMALS, USDC_DECIMALS)))} USDC`;
  const line = `CI buyer wallet ${address} on Arc testnet: ${shown}`;
  console.log(line);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n\n`);
  const refill = `Refill ${address} with test USDC on Arc testnet at https://faucet.circle.com`;
  if (balance < stopBelow) {
    console.log(`::error title=Arc CI wallet empty::${shown} left, below the minimum. ${refill}`);
    process.exit(1);
  }
  if (balance < warnBelow) {
    console.log(`::warning title=Arc CI wallet low::${shown} left. ${refill}`);
  }
}

main().catch((err) => {
  console.error(`balance check failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
