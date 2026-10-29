# Public demo store on Arc testnet (arc-demo.agentposhq.com)

A WooCommerce store with the AgentPOS sidecar in front, offering **Stellar testnet** (the store's
own network) and **Arc testnet** in every 402. An agent paying on Arc signs an EIP-3009
authorization, the **Circle Facilitator Service** settles it straight to the merchant's Arc
wallet, and the order appears in WooCommerce only after settlement, carrying the Arc transaction
as its `transaction_id`. Test money only; nothing ships.

Fully separate from the mainnet demo store (`demo.agentposhq.com`): its own database, volumes,
data dir and sidecar. It runs on the same VPS behind the same Caddy, with memory capped on every
service.

## Try it (as an agent)

1. Make an Arc testnet wallet and get test USDC at https://faucet.circle.com (Arc testnet).
2. From a clone of this repository:

```bash
pnpm install && pnpm build
ARC_TESTNET_BUYER_PRIVATE_KEY=0x... pnpm --filter @agentpos/rail-arc buy:arc
```

The agent searches the store, buys the cheapest product under a mandate that allows only Arc
(5 USDC per payment by default, `MAX_USDC` to change it), and prints the Arc transaction and the
order. `STORE_URL` points it at another AgentPOS store.

Checked on 2026-10-29 against this stack running locally: "Sticker Pack", 3 USDC, settled on Arc
testnet
([`0xe6d1f1a5…8f76`](https://explorer.testnet.arc.io/tx/0xe6d1f1a574c4de2ad36bda270944254eb234a5ed3fb5845ad62914a388108f76)),
WooCommerce order #28 `processing` with that hash as `transaction_id`.

## Deploy (operator)

Same VPS, same `edge` network and Caddy as the core repo's services (see the core repo's
`apps/facilitator/deploy`).

### 0. DNS (once)

In Cloudflare, an `A` record `arc-demo` -> the VPS address, **DNS-only (grey cloud)**, so Caddy
can answer the ACME challenge.

### 1. Ship this repository to the VPS

From the laptop, at this repository's root (`git archive` ships committed files only: no `.env`):

```sh
git archive --format=tar HEAD | ssh root@<vps> 'mkdir -p /opt/agentpos-arc && tar -x -C /opt/agentpos-arc'
```

### 2. Secrets and config (on the VPS, once)

`/root/.agentpos/arc-demo.env`, mode 600. Generate the passwords and the Woo REST pair on the box
(the Woo values must be exactly 43 characters: `ck_` or `cs_` plus 40 hex):

```sh
umask 077
{
  echo "ARC_DEMO_DB_PASSWORD=$(openssl rand -hex 24)"
  echo "ARC_DEMO_DB_ROOT_PASSWORD=$(openssl rand -hex 24)"
  echo "ARC_DEMO_ADMIN_PASSWORD=$(openssl rand -hex 16)"
  echo "ARC_DEMO_WOO_CONSUMER_KEY=ck_$(openssl rand -hex 20)"
  echo "ARC_DEMO_WOO_CONSUMER_SECRET=cs_$(openssl rand -hex 20)"
  echo "ARC_TESTNET_MERCHANT_ADDRESS=0x..."               # the merchant's Arc testnet wallet
  echo "AGENTPOS_FACILITATOR_API_KEY_TESTNET="            # OpenZeppelin testnet key (Stellar)
  echo "AGENTPOS_ARC_FACILITATOR_API_KEY_TESTNET="        # Circle testnet key (Facilitator)
} > /root/.agentpos/arc-demo.env
```

Fill in the last three by hand with an editor (never paste keys into a shell history). Then the
site config:

```sh
mkdir -p /root/.agentpos/arc-demo
cp /opt/agentpos-arc/apps/demo-store/agentpos.config.example.json /root/.agentpos/arc-demo/agentpos.config.json
chown -R 1000:1000 /root/.agentpos/arc-demo   # the sidecar runs as the node user
```

### 3. Build, start, seed

```sh
cd /opt/agentpos-arc
docker network create edge 2>/dev/null || true
C="docker compose -f apps/demo-store/docker-compose.prod.yml --env-file /root/.agentpos/arc-demo.env"
$C up -d --build arc-demo-db arc-demo-wordpress
$C run --rm arc-demo-seed                     # WordPress + WooCommerce + products + REST key
$C up -d --build arc-demo-sidecar
$C run --rm --no-deps --entrypoint node arc-demo-sidecar /app/apps/demo-store/seed-catalog.mjs
```

The last command is the human confirmation the guardrail asks for: it publishes the scanned
catalog at the suggested USDC prices (`PRICE_OVERRIDES_USDC` pins any SKU).

### 4. Caddy

Append `Caddyfile.snippet` to the Caddyfile the core deploy uses, then reload that Caddy:

```sh
grep -q arc-demo.agentposhq.com /opt/agentpos/apps/facilitator/deploy/Caddyfile \
  || cat /opt/agentpos-arc/apps/demo-store/Caddyfile.snippet >> /opt/agentpos/apps/facilitator/deploy/Caddyfile
cd /opt/agentpos && docker compose -f apps/facilitator/deploy/docker-compose.prod.yml \
  --env-file /root/.agentpos/facilitator/mainnet.env up -d caddy
```

Shipping a new core tree to `/opt/agentpos` overwrites that Caddyfile; the `grep -q` guard
above makes re-running this step after any core deploy safe.

### 5. Check

```sh
curl -fsS https://arc-demo.agentposhq.com/agentpos/health   # networks: eip155:5042002 "ok"
docker stats --no-stream | grep arc-demo                     # each under its mem_limit
```

Then a real purchase from the laptop: `STORE_URL=https://arc-demo.agentposhq.com pnpm --filter
@agentpos/rail-arc buy:arc`.

## Updating

Ship the new tree (step 1), then `$C up -d --build arc-demo-sidecar`.
