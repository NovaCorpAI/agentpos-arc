import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import type { Hex } from "viem";
import { AgentPOSError } from "@agentpos/core";
import { ARC_USDC } from "./index.js";
import { circleTypedDataJson, circleWalletSigner } from "./circle-wallet.js";
import type { CircleTypedDataClient } from "./circle-wallet.js";

const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());

// The EIP-3009 authorization the x402 `exact` client asks a buyer to sign on Arc testnet.
const request = {
  domain: { name: "USDC", version: "2", chainId: 5042002, verifyingContract: ARC_USDC },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization" as const,
  message: {
    from: account.address,
    to: other.address,
    value: 3_000_000n,
    validAfter: 0n,
    validBefore: 1_793_400_000n,
    nonce: `0x${"ab".repeat(32)}`,
  },
};

type Field = { name: string; type: string };

/** Stands in for Circle: parses the JSON it is sent and signs it with a local key. */
function fakeCircle(
  signer = account,
  shape: (sig: Hex) => string = (sig) => sig,
): CircleTypedDataClient & { sent: Array<{ walletId: string; data: string }> } {
  const sent: Array<{ walletId: string; data: string }> = [];
  return {
    sent,
    async signTypedData(input) {
      sent.push(input);
      const parsed = JSON.parse(input.data) as {
        types: Record<string, Field[]>;
        primaryType: string;
        domain: Record<string, unknown>;
        message: Record<string, unknown>;
      };
      const { EIP712Domain: _domain, ...types } = parsed.types;
      const fields = types[parsed.primaryType] ?? [];
      const message = Object.fromEntries(
        Object.entries(parsed.message).map(([k, v]) => {
          const type = fields.find((f) => f.name === k)?.type ?? "";
          return [k, type.startsWith("uint") ? BigInt(v as string) : v];
        }),
      );
      const sig = await signer.signTypedData({
        domain: { ...parsed.domain, chainId: Number(parsed.domain.chainId) },
        types,
        primaryType: parsed.primaryType,
        message,
      });
      return { data: { signature: shape(sig) } };
    },
  };
}

async function codeOf(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return err instanceof AgentPOSError ? err.code : "NOT_AGENTPOS_ERROR";
  }
  return undefined;
}

describe("circleTypedDataJson", () => {
  it("adds the EIP712Domain type and sends every integer as a string", () => {
    const json = JSON.parse(circleTypedDataJson(request)) as {
      types: { EIP712Domain: Field[] };
      domain: { chainId: unknown };
      message: { value: unknown; validAfter: unknown };
    };
    expect(json.types.EIP712Domain.map((f) => f.name)).toEqual([
      "name",
      "version",
      "chainId",
      "verifyingContract",
    ]);
    expect(json.domain.chainId).toBe("5042002");
    expect(json.message.value).toBe("3000000");
    expect(json.message.validAfter).toBe("0");
  });
});

describe("circleWalletSigner", () => {
  const wallet = { walletId: "wallet-1", address: account.address };

  it("returns Circle's signature, which recovers to the buyer's wallet", async () => {
    const client = fakeCircle();
    const signature = await circleWalletSigner(client, wallet).signTypedData(request);
    expect(client.sent[0]?.walletId).toBe("wallet-1");
    const recovered = await recoverTypedDataAddress({ ...request, signature });
    expect(recovered).toBe(account.address);
  });

  it("adds the 0x prefix and turns v 0/1 into 27/28 for the Facilitator Service", async () => {
    const client = fakeCircle(account, (sig) => {
      const v = parseInt(sig.slice(130), 16) - 27;
      return `${sig.slice(2, 130)}0${v}`;
    });
    const signature = await circleWalletSigner(client, wallet).signTypedData(request);
    expect(signature.startsWith("0x")).toBe(true);
    expect(["1b", "1c"]).toContain(signature.slice(130));
  });

  it("refuses a signature made by another wallet", async () => {
    const client = fakeCircle(other);
    expect(await codeOf(() => circleWalletSigner(client, wallet).signTypedData(request))).toBe(
      "CONFIG_INVALID",
    );
  });

  it("refuses a non-ECDSA signature (a smart account's) and a missing one", async () => {
    const sca = fakeCircle(account, (sig) => `${sig}00`);
    expect(await codeOf(() => circleWalletSigner(sca, wallet).signTypedData(request))).toBe(
      "CONFIG_INVALID",
    );
    const empty: CircleTypedDataClient = { signTypedData: async () => ({ data: {} }) };
    expect(await codeOf(() => circleWalletSigner(empty, wallet).signTypedData(request))).toBe(
      "RAIL_UNAVAILABLE",
    );
  });
});
