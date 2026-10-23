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

| Piece                                                                         | State                             |
| ----------------------------------------------------------------------------- | --------------------------------- |
| `@agentpos/rail-arc`: Arc networks, exact pricing, x402 wiring, wallet proof  | Built, unit-tested                |
| Store checkout offering Arc next to its current network                       | Next: wiring in the store sidecar |
| End-to-end purchase on Arc testnet through the Circle Facilitator             | Next                              |
| Mainnet demo store on Arc                                                     | After testnet                     |
| Usage-based pricing (`upto`) and Circle agent wallets for the reference buyer | Planned                           |

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

Until `@agentpos/core` 0.2.0 is published, this repo links the core from a checkout of
`NovaCorpAI/agentpos` (branch `feat/multi-network-core`) next to it; see `pnpm-workspace.yaml`.

## License

Apache-2.0. Built by NovaCorpAI SpA, Santiago, Chile.
