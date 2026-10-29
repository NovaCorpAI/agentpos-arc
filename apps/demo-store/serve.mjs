/**
 * The public AgentPOS demo store on Arc TESTNET: the AgentPOS sidecar in front of its own
 * WooCommerce, offering the store's own network (Stellar testnet) and Arc testnet in every 402.
 * Payments on Arc are settled by the Circle Facilitator Service straight to the merchant's Arc
 * wallet; the order is created in WooCommerce only after settlement.
 *
 * Reads agentpos.config.json and the data dir from /data (or AGENTPOS_DATA_DIR), the Stellar
 * side from the usual AGENTPOS_* env, and the Arc side from:
 *   ARC_TESTNET_MERCHANT_ADDRESS, AGENTPOS_ARC_FACILITATOR_URL,
 *   AGENTPOS_ARC_FACILITATOR_API_KEY_TESTNET
 *
 * Testnet only: it refuses to start if the core resolves to mainnet.
 */
import { createAgentPOS } from "@agentpos/site";
import { configFromEnv, createLogger } from "@agentpos/core";
import { ARC_TESTNET, arcStoreNetwork } from "@agentpos/rail-arc";

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const core = configFromEnv(process.env);
if (core.network !== "testnet") throw new Error("the Arc demo store is testnet only");

const gate = await createAgentPOS({
  cwd: process.env.AGENTPOS_DATA_DIR ?? "/data",
  core,
  logger: createLogger({ format: "json" }),
  x402Networks: [
    arcStoreNetwork(ARC_TESTNET, need("ARC_TESTNET_MERCHANT_ADDRESS"), {
      url: need("AGENTPOS_ARC_FACILITATOR_URL"),
      apiKey: need("AGENTPOS_ARC_FACILITATOR_API_KEY_TESTNET"),
    }),
  ],
});
const { port } = await gate.serve(Number(process.env.PORT ?? 8402));
console.log(
  JSON.stringify({
    msg: "arc-demo-store listening",
    port,
    networks: ["stellar:testnet", ARC_TESTNET],
  }),
);
