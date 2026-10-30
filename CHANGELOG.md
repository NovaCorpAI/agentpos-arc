# Changelog

Dates are the day the tag was pushed.

## Unreleased

- `circleWalletSigner`: the buyer agent pays on Arc from a developer-controlled wallet in Circle
  Wallets, signing through `signTypedData` (explicit `EIP712Domain`, integers as strings, `v`
  normalized to 27/28 for the Facilitator Service), and refuses any signature that does not
  recover to the configured address. `buy:arc` uses it when `CIRCLE_BUYER_WALLET_ID` is set;
  `circle-wallet:setup` creates the wallet on Arc testnet.

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
