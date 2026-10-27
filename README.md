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

### The buyer's side: an agent paying on Arc under its mandate

`arcBuyerNetwork(network, signer)` gives the AgentPOS buyer (`@agentpos/mcp-buyer`) the buyer's
own Arc wallet as one more network. The human's mandate decides: Arc is paid on only when the
mandate lists it in `allowedNetworks`, each payment is capped at the cart total converted exactly
to 6 decimals, and the period limit adds up what the agent spent on every network.

```ts
import { BuyerService } from "@agentpos/mcp-buyer";
import { ARC_TESTNET, arcBuyerNetwork } from "@agentpos/rail-arc";

// mandate: { "maxPerTx": "15", "maxTotal": "20", "allowedNetworks": ["eip155:5042002"] }
const buyer = new BuyerService({ profile, networks: [arcBuyerNetwork(ARC_TESTNET, account)] });
```

The MCP server takes the same through `buildBuyerServer({ depsOverrides: { networks } })`.

Checked live on Arc testnet (2026-10-27, `pnpm --filter @agentpos/rail-arc e2e:arc-buyer`): a
buyer whose mandate allows only Arc found a "Sticker Pack" in the WooCommerce demo store and paid
3 USDC on Arc
([`0x2acb363f…e4b5`](https://explorer.testnet.arc.io/tx/0x2acb363ff7ddced3174e4b16c0fcfeb6cd42157d3c2f4a00619e8fead022e4b5)),
order #26 paid, the spending log counted it in the catalog's unit, and the store's reconciliation
came back clean.

### Money with no order (reconciliation)

`arcStoreNetwork` also brings a payment watcher (`createArcPaymentWatcher`): it reads the USDC
that reached the merchant's Arc wallet, read-only and without a key. The AgentPOS sidecar compares
it every 5 minutes with the payments the store recorded, and a payment with no order raises a
critical `PAYMENT_WITHOUT_ORDER` alert listing the pending orders of the same amount. It never
creates an order or moves funds. Pass `false` as the fourth argument to leave it out.

Checked live on Arc testnet (2026-10-27): the WooCommerce e2e bought a "Sticker Pack" for 3 USDC
([`0x70491c8b…0b8d`](https://explorer.testnet.arc.io/tx/0x70491c8bec315720c6d7cfa4701be3c1cf7a77627336e7cb9e7ff9b3ef770b8d),
order #23) and the reconciliation that followed reported no payment without an order.

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

The core comes from npm (`@agentpos/core`, `@agentpos/site` and friends, published with
provenance from [NovaCorpAI/agentpos](https://github.com/NovaCorpAI/agentpos)).

## License

Apache-2.0. Built by NovaCorpAI SpA, Santiago, Chile.
