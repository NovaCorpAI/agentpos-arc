# CLAUDE.md - AgentPOS on Arc

Repo delgado del "camino C" (decisión del founder 2026-10-23): el núcleo neutral vive en
`NovaCorpAI/agentpos` (carpeta `agentpos-public`); aquí vive SOLO lo propio de Arc y de Circle:
el riel `@agentpos/rail-arc`, la tienda demo en Arc y lo que se presente al Circle Developer
Grants. Lo que sirva a cualquier cadena se hace en el núcleo, no aquí.

## Guardrails (heredados del núcleo, sin excepción)

1. Cero custodia: solo direcciones públicas; la billetera del comercio se vincula por firma de
   un challenge (EIP-191 / ERC-1271). Nunca se guarda una llave privada.
2. Testnet (`eip155:5042002`) hasta que el founder confirme mainnet en el chat.
3. Contacto con x402 solo en `packages/rail-arc/src/x402.ts`, con el paquete oficial
   `@x402/evm` (verify/settle nunca se reimplementan). Versiones `@x402/*` fijadas exactas e
   iguales a las del núcleo.
4. Dinero en enteros. USDC en Arc tiene 6 decimales en su interfaz ERC-20 (el gas nativo usa
   18: nunca se usa esa unidad). Convertir desde el catálogo (7) solo con `usdcOnChain`; jamás
   redondear.
5. Orden solo tras settle exitoso del facilitador, idempotente por tx hash.
6. El comercio es merchant of record: sin comisión, sin intermediar fondos.
7. Sin secretos en el repo: llaves de Circle solo en `.env` (ver `.env.example`).
8. Ningún entregable de este repo se compromete también con otro fondo (SCF, Celo, etc.).

## Stack

TypeScript strict, Node >= 22.5, pnpm. vitest. viem para EVM. Facilitador: Circle Facilitator
Service (API key de console.circle.com, una por red). Fuentes verificadas el 2026-10-23:
docs.arc.io, developers.circle.com/facilitator-service, `@x402/evm` 2.28.0.

## Convenciones

Conventional commits. Código y comentarios en inglés; en textos en español, sin guiones largos.
Errores siempre `AgentPOSError { code, message, hint }`.

## Checklist antes de Arc mainnet (no saltarse)

- [ ] En Circle: activar 2FA y registrar un medio de pago (sin eso el permiso "Facilitator"
      no se desbloquea en mainnet). La llave de mainnet Standard sin IP se revocó el 2026-10-23.
- [ ] Llave de mainnet **Restricted** con solo "Facilitator: Read & Write", y
      **restringida por IP** a la IP fija del servidor
      donde corre la tienda (la de testnet quedó sin restricción a propósito: IP dinámica y CI).
- [ ] Gate propio de Arc verde en testnet y confirmación del founder en el chat; recién ahí
      `eip155:5042` entra a `MAINNET_READY_NETWORKS` en el núcleo.
- [ ] Precio del facilitador confirmado y medido.
- [ ] Conciliación de pagos de Arc leyendo la cadena.
