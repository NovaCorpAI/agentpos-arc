# Changelog

Dates are the day the tag was pushed.

## 0.1.0 (unreleased)

- First npm release of `@agentpos/rail-arc`: Arc networks and USDC (6 decimals, exact
  conversion), x402 checkout settled by the Circle Facilitator Service (`arcStoreNetwork`),
  merchant wallet linking by signed challenge (EIP-191, ERC-1271), read-only reconciliation of
  USDC received with no order, and the buyer's Arc network under the human's mandate
  (`arcBuyerNetwork`). Arc testnet only; Arc mainnet stays locked in the core. Requires
  `@agentpos/*` 0.1.5.
