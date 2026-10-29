# @agentpos/rail-arc

AgentPOS payment rail for **Arc**, Circle's L1: x402 checkout in USDC, settled by the **Circle
Facilitator Service** straight to the merchant's own Arc wallet. AgentPOS never holds funds or
keys and takes no commission; the merchant stays the merchant of record.

It plugs into the open-source AgentPOS core
([`@agentpos/core`](https://www.npmjs.com/package/@agentpos/core),
[NovaCorpAI/agentpos](https://github.com/NovaCorpAI/agentpos)), which turns an existing store
(WooCommerce today) into one AI agents can buy from.

> **Testnet only for now.** Arc mainnet (`eip155:5042`) is defined here but stays locked in the
> core until the Arc production gate passes. Use Arc testnet (`eip155:5042002`).

## Install

```bash
npm install @agentpos/core @agentpos/rail-arc
```

Importing the package registers both Arc networks with the core (pricing, address validation,
wallet linking). Node >= 22.5.

## Store side: offer Arc in the 402

```ts
import { createAgentPOSApp } from "@agentpos/site";
import { ARC_TESTNET, arcStoreNetwork } from "@agentpos/rail-arc";

const app = createAgentPOSApp({
  // ...site, core, connector, storage
  x402Networks: [
    arcStoreNetwork(ARC_TESTNET, "0xMerchantArcWallet", {
      url: process.env.AGENTPOS_ARC_FACILITATOR_URL!, // https://api.circle.com/v1/facilitator/x402
      apiKey: process.env.AGENTPOS_ARC_FACILITATOR_API_KEY_TESTNET!, // console.circle.com
    }),
  ],
});
```

The store keeps its own network and adds Arc next to it. The order is created only after the
facilitator settles, idempotent by transaction hash. `arcStoreNetwork` also brings a read-only
payment watcher that alerts on any USDC that reached the merchant's wallet without an order.

## Buyer side: pay on Arc under the human's mandate

```ts
import { BuyerService } from "@agentpos/mcp-buyer";
import { ARC_TESTNET, arcBuyerNetwork } from "@agentpos/rail-arc";

// mandate: { "maxPerTx": "15", "maxTotal": "20", "allowedNetworks": ["eip155:5042002"] }
const buyer = new BuyerService({ profile, networks: [arcBuyerNetwork(ARC_TESTNET, account)] });
```

The agent pays on Arc only when the mandate lists it, each payment is capped at the cart total
converted exactly to Arc's 6-decimal USDC (a price Arc cannot represent is refused, never
rounded), and the period limit adds up spending across every network.

## What else is exported

- `ARC_MAINNET`, `ARC_TESTNET`, `registerArcNetworks()`: the networks and their USDC.
- `registerArcWalletProof()`: lets a merchant link an Arc wallet by signing a challenge
  (EIP-191, ERC-1271 for smart accounts). No key ever reaches AgentPOS.
- `arcResourceExtension`, `arcAccept`: lower-level x402 wiring for a custom server.
- `createArcPaymentWatcher`: the reconciliation reader on its own.

## Evidence

Real purchases on Arc testnet through the Circle Facilitator Service, with the order created in
WooCommerce only after settlement, are listed with their transaction hashes in the
[repository README](https://github.com/NovaCorpAI/agentpos-arc#readme). A purchase also runs
once a day in CI.

## License

Apache-2.0. Built by NovaCorpAI SpA, Santiago, Chile.
