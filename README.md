# AgentPOS on Arc

**Any online store, buyable by AI agents, paid in USDC on Arc.**

AgentPOS runs next to the store a merchant already has (WooCommerce today, Shopify next). It
publishes the catalog the merchant confirms in the formats agents read (UCP, ACP, MCP), answers
checkout with an x402 payment request, and creates the order only after the payment settles.
This repository makes **Arc**, Circle's L1, a settlement network for that checkout:

- **USDC end to end.** Prices, payments and gas are in USDC. The buyer signs an EIP-3009
  authorization; the **Circle Facilitator Service** settles it and pays the gas.
- **Straight to the merchant.** The USDC moves from the agent's wallet to the merchant's own
  Arc wallet in one transaction. AgentPOS never holds funds and takes no commission; the
  merchant stays the merchant of record.
- **Final in under a second**, with deterministic finality, so the order can be created right
  after settlement.
- **Exact money.** Catalog prices convert to Arc's 6-decimal USDC exactly; a price Arc cannot
  represent is refused, never rounded.
- **Wallets linked, not held.** A merchant proves control of their Arc wallet by signing a
  challenge (EIP-191, with ERC-1271 smart accounts through an RPC). No key reaches AgentPOS.

## Status

| Piece                                                                         | State                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------- |
| `@agentpos/rail-arc`: Arc networks, exact pricing, x402 wiring, wallet proof  | Built, unit-tested                       |
| Store checkout offering Arc next to its current network                       | Built in the AgentPOS sidecar            |
| End-to-end purchase on Arc testnet through the Circle Facilitator             | **Proven** (see below)                   |
| Mainnet demo store on Arc                                                     | After the Arc gate; locked in code today |
| Usage-based pricing (`upto`) and Circle agent wallets for the reference buyer | Planned                                  |

### First purchase on Arc testnet (2026-10-23)

An AgentPOS store offered Stellar and Arc in its 402. A buyer agent, holding its own test wallet
and a 1 USDC per-payment ceiling, chose Arc and signed an EIP-3009 authorization for 0.25 USDC.
The Circle Facilitator Service settled it and paid the gas; the store created the order only
after settlement, with the amount converted exactly to the catalog's unit.

- Transaction: [`0x7f5a1466…b47a`](https://explorer.testnet.arc.io/tx/0x7f5a1466fc430658ddc45f96eea9c345b3685244109ee1e35aa46309b8c3b47a), block 68747728, status success
- USDC moved buyer `0x42Db…0Bf0` to merchant `0x7528…93f8`: 0.25 USDC, straight to the merchant
- Reproduce: `pnpm --filter @agentpos/rail-arc e2e:arc-testnet` (needs `.env`, see `.env.example`)

### Order created in a real WooCommerce store (2026-10-23)

The same flow against the AgentPOS WooCommerce demo store (docker): AgentPOS scanned the store,
the merchant's catalog was confirmed and published, an agent with a 15 USDC per-payment ceiling
bought a "Sticker Pack" for 3 USDC on Arc, the Circle Facilitator Service settled it, and the
paid order appeared in WooCommerce (#21, status `processing`) carrying the Arc transaction as its
`transaction_id`.

- Transaction: [`0x9d79325b…15eb`](https://explorer.testnet.arc.io/tx/0x9d79325bdfe6ca7a6bb4f173a1ae4cdd961f51ea788bc1ecb6e4e1b434d015eb)
- Reproduce: `pnpm demo:up` in the core repo, then `pnpm --filter @agentpos/rail-arc e2e:arc-woo`

AgentPOS already settles real USDC purchases on Stellar mainnet; this repository brings the same
merchant flow to Arc. It builds on the open-source AgentPOS core
([NovaCorpAI/agentpos](https://github.com/NovaCorpAI/agentpos), Apache-2.0).

## Use

```ts
import { createResourceServer, buildRouteConfig, resolveConfig, usdc } from "@agentpos/core";
import { arcResourceExtension, arcAccept, ARC_TESTNET } from "@agentpos/rail-arc";

const cfg = resolveConfig();
const arc = arcResourceExtension(ARC_TESTNET, {
  url: process.env.AGENTPOS_ARC_FACILITATOR_URL!,
  apiKey: process.env.AGENTPOS_ARC_FACILITATOR_API_KEY_TESTNET!,
});
const server = createResourceServer(cfg, undefined, [arc]);

// One route, payable on Arc in the merchant's own wallet.
const route = buildRouteConfig(cfg, { payTo: "G...", amount: usdc("2.5") }, [
  arcAccept(ARC_TESTNET, "0xYourMerchantWallet", usdc("2.5")),
]);
```

## Arc reference

|                           | Mainnet                                      | Testnet                      |
| ------------------------- | -------------------------------------------- | ---------------------------- |
| CAIP-2                    | `eip155:5042`                                | `eip155:5042002`             |
| RPC                       | `https://rpc.mainnet.arc.io`                 | `https://rpc.testnet.arc.io` |
| Explorer                  | explorer.arc.io                              | explorer.testnet.arc.io      |
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` | same                         |
| Test USDC                 |                                              | faucet.circle.com            |

## Develop

```bash
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

Until `@agentpos/core` 0.1.0 is published, this repo links the core from a checkout of
`NovaCorpAI/agentpos` (branch `feat/multi-network-core`) next to it; see `pnpm-workspace.yaml`.

## License

Apache-2.0. Built by NovaCorpAI SpA, Santiago, Chile.
