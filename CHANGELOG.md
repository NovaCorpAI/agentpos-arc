# Changelog

Dates are the day the tag was pushed.

## 0.1.1 (2026-10-29)

- First release published from GitHub Actions through npm trusted publishing, with build
  provenance (0.1.0 was published by hand without it). Ships the Apache-2.0 `LICENSE` inside
  the package. No code changes.

## 0.1.0 (2026-10-29)

- First npm release of `@agentpos/rail-arc`: Arc networks and USDC (6 decimals, exact
  conversion), x402 checkout settled by the Circle Facilitator Service (`arcStoreNetwork`),
  merchant wallet linking by signed challenge (EIP-191, ERC-1271), read-only reconciliation of
  USDC received with no order, and the buyer's Arc network under the human's mandate
  (`arcBuyerNetwork`). Arc testnet only; Arc mainnet stays locked in the core. Requires
  `@agentpos/*` 0.1.5.
