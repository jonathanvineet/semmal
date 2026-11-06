/**
 * Payments in the native 0G token on 0G Galileo testnet (docs/FACT_CHECK.md: chain 16602).
 * No keys here: this builds and checks plain value transfers. Whoever pays signs in their own wallet
 * (customer, owner) or with the robot's device key under its caps (services/robot-master/device.ts).
 *
 * Every SEMMAL payment carries a memo in its calldata, `semmal:<kind>:<id>`, so one transfer can be
 * matched to exactly one quote, job, payout or refund and never counted twice.
 */
import { createPublicClient, defineChain, fromHex, getAddress, http, isHex, toHex, type Hash, type PublicClient } from "viem";

export const GALILEO_CHAIN_ID = 16602;
export const GALILEO_RPC = "https://evmrpc-testnet.0g.ai";
export const GALILEO_EXPLORER = "https://chainscan-galileo.0g.ai";

export const galileo = defineChain({
  id: GALILEO_CHAIN_ID,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [GALILEO_RPC] } },
  blockExplorers: { default: { name: "0G Chain Explorer", url: GALILEO_EXPLORER } },
  testnet: true,
});

export const galileoClient = (rpc = GALILEO_RPC): PublicClient =>
  createPublicClient({ chain: galileo, transport: http(rpc, { timeout: 15_000, retryCount: 1 }) }) as PublicClient;

export type PayKind = "quote" | "job" | "payout" | "refund";
const ID = /^[A-Za-z0-9-]{3,64}$/;

/** Calldata memo for one payment. */
export function memo(kind: PayKind, id: string): `0x${string}` {
  if (!ID.test(id)) throw new Error(`bad payment id ${id}`);
  return toHex(`semmal:${kind}:${id}`);
}
export function readMemo(data: string | undefined): { kind: PayKind; id: string } | null {
  if (!data || !isHex(data) || data === "0x") return null;
  let s: string;
  try {
    s = fromHex(data, "string");
  } catch {
    return null;
  }
  const m = /^semmal:(quote|job|payout|refund):([A-Za-z0-9-]{3,64})$/.exec(s);
  return m ? { kind: m[1] as PayKind, id: m[2]! } : null;
}

export type TransferCheck =
  | { ok: true; from: `0x${string}`; to: `0x${string}`; valueWei: bigint; blockNumber: bigint; confirmations: bigint }
  | { ok: false; reason: string };

/**
 * Check one transfer on chain: mined and successful, to the right address, carrying the right memo,
 * worth at least `minWei`, optionally from a given payer, with enough confirmations.
 */
export async function verifyTransfer(
  client: Pick<PublicClient, "getTransaction" | "getTransactionReceipt" | "getBlockNumber" | "getChainId">,
  want: { hash: Hash; to: string; minWei: bigint; memo: `0x${string}`; from?: string; minConfirmations?: number },
): Promise<TransferCheck> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(want.hash)) return { ok: false, reason: "not a transaction hash" };
  if ((await client.getChainId()) !== GALILEO_CHAIN_ID) return { ok: false, reason: "RPC is not 0G Galileo" };
  const tx = await client.getTransaction({ hash: want.hash }).catch(() => null);
  if (!tx) return { ok: false, reason: "transaction not found" };
  const rc = await client.getTransactionReceipt({ hash: want.hash }).catch(() => null);
  if (!rc) return { ok: false, reason: "transaction not mined yet" };
  if (rc.status !== "success") return { ok: false, reason: "transaction failed on chain" };
  if (!tx.to || getAddress(tx.to) !== getAddress(want.to)) return { ok: false, reason: "paid to a different address" };
  if (want.from && getAddress(tx.from) !== getAddress(want.from)) return { ok: false, reason: "paid from a different wallet" };
  if ((tx.input ?? "0x").toLowerCase() !== want.memo.toLowerCase()) return { ok: false, reason: "payment memo does not match" };
  if (tx.value < want.minWei) return { ok: false, reason: `paid ${tx.value} wei, needed ${want.minWei}` };
  const confirmations = (await client.getBlockNumber()) - rc.blockNumber + 1n;
  if (confirmations < BigInt(want.minConfirmations ?? 1)) return { ok: false, reason: "not confirmed yet" };
  return { ok: true, from: getAddress(tx.from), to: getAddress(tx.to), valueWei: tx.value, blockNumber: rc.blockNumber, confirmations };
}

/** 0G amount for display: wei -> "0.012345". */
export function formatOg(wei: bigint, decimals = 6) {
  const s = wei.toString().padStart(19, "0");
  const whole = s.slice(0, -18).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-18, -18 + decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
