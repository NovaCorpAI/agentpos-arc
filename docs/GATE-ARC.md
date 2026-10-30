# Gate de Arc mainnet (`eip155:5042`)

Estado: **ABIERTO.** Arc sigue solo en testnet. `eip155:5042` entra a `MAINNET_READY_NETWORKS`
en el núcleo (`packages/core/src/config.ts`, repo `NovaCorpAI/agentpos`) solo cuando todos los
puntos de abajo estén en verde con evidencia y el founder lo confirme en el chat, en un commit
dedicado. Cada despliegue en mainnet sigue exigiendo `AGENTPOS_ALLOW_MAINNET=true` y la llave de
mainnet de Circle.

Arc usa el mismo sidecar que Stellar, así que hereda todos los criterios automáticos del gate G1
del núcleo (`docs/GATE-G1.md` allá: verificación de monto y destino, idempotencia, re-cotización,
caminos tristes, rate limiting, cero custodia, gitleaks, auditoría, carga, salud y trazabilidad).
Aquí va solo lo propio de Arc. Detalle de cada riesgo en el registro multicadena del repo interno
(`docs/RIESGOS-MULTICADENA.md`).

## Lo que ya está verde (evidencia en Arc testnet)

| Criterio | Evidencia |
| --- | --- |
| Montos exactos con 6 decimales; un precio que Arc no puede representar se rechaza, nunca se redondea | Tests de `rescaleMinor` / `usdcOnChain` en el núcleo y en `rail-arc` |
| Orden solo tras `settle` del Facilitator Service, idempotente por `red + hash` | Compras con orden en WooCommerce: `0x9d79325b…15eb` (23 oct), `0xe6d1f1a5…8f76` (29 oct, orden #28) |
| Conciliación leyendo la cadena: pago sin orden levanta `PAYMENT_WITHOUT_ORDER` | `createArcPaymentWatcher` cada 5 min en el sidecar; e2e con conciliación limpia `0x70491c8b…0b8d` (27 oct); `/health` de la tienda pública muestra `paymentsWithoutOrder: 0` |
| Caída del facilitador de Circle: el 402 ofrece solo redes sanas | Probado en vivo, `0x40299579…16ec` (27 oct) |
| Rechazos del facilitador tipados; el agente no reintenta en otra red sin su humano | agentpos PR #16, publicado en 0.1.5 |
| Sin reorgs que deshagan un pago | Arc tiene finalidad determinista |
| Mainnet por accidente imposible | `assertNetworkAllowed` en todos los puntos de entrada; testnet nunca cobra en mainnet |
| Mandato del comprador: red permitida explícita, límite por pago y por período sumando redes | agentpos PR #11; e2e `0x2acb363f…e4b5` |
| Llave del comprador fuera del proceso del agente | Circle Wallets (agentpos-arc PR #14): compra firmada por Circle `0x7af922f6…7a3a` (29 oct) |
| Tienda pública operando | `https://arc-demo.agentposhq.com`, compras `0x027524db…4e9d` y `0xc2d2d418…20d2` (29 oct) |
| Compra diaria en CI | Workflow `E2E Arc testnet`, verde desde el 27 oct |
| Paquete publicado con provenance | `@agentpos/rail-arc` 0.1.1 en npm, trusted publishing (29 oct) |

## Lo que falta antes de mainnet

- [ ] **Cuenta de Circle lista para mainnet** con el Facilitator Service habilitado (lo revisa el
      founder en console.circle.com).
- [ ] **Llave de mainnet Restricted** con solo "Facilitator: Read & Write", **restringida por IP**
      a `2.29.30.222` (riesgo F4). Va solo en el `.env` del VPS, nunca en el repo ni en el chat.
- [ ] **Precio del facilitador** (riesgo F2): confirmado en la documentación o en la facturación de
      Circle, y medido en la primera liquidación de mainnet. En testnet el comercio recibe el monto
      completo (la liquidación `0x7af922f6…7a3a` transfiere los 3 USDC enteros); falta saber si
      Circle cobra aparte a la cuenta.
- [ ] **Billetera de cobro del comercio en hardware** (cero custodia): Trezor Model T del founder,
      firmware oficial, semilla generada por él, dirección confirmada en la pantalla del
      dispositivo y una prueba de retiro pequeña en Arc mainnet antes de recibir cobros.
- [ ] **Saldo del comprador en mainnet**: unos 10 USDC reales en una wallet de Circle Wallets en
      `ARC` (mainnet), para las compras de evidencia.
- [ ] **Confirmación explícita del founder en el chat**, y recién ahí el cambio del núcleo en un
      commit propio y una versión nueva publicada.

## Riesgos que quedan en amarillo, aceptados para la tienda demo

- F3: no hay forma de probar en vivo un rechazo del screening de Circle (Circle no ofrece una
  dirección de prueba que falle). El camino está cubierto con tests y llega tipado al agente.
- N3: sanciones y listas de bloqueo. El comercio es merchant of record; la tienda demo no vende
  bienes reales.
- S1: la prueba de control de la billetera existe en el núcleo y en Arc, pero el CLI todavía no la
  exige al configurar el `payTo`. En la tienda demo el `payTo` lo fija el founder a mano.

## Después del desbloqueo

1. La tienda demo de mainnet (`demo.agentposhq.com`) suma Arc mainnet como segunda red.
2. Tres compras reales en Arc mainnet, cada una con su hash y su orden en WooCommerce.
3. Medir el costo por liquidación y cerrar F2 con el número.
