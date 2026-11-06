/**
 * One-shot guarded Arkiv create, adapted from the Arkiv MCP "guides/quickstart" (SDK 1.0.1, Rabdi)
 * guardedWalletClient + walletSigner (wallet signing mode). Rules kept from the guide:
 *  - exactly one Create operation per adapter instance, never an automatic resend;
 *  - gas >= max(1_000_000, 2 x estimate at latest) and gas <= latest block gasLimit / 2;
 *  - fresh nonce/gasPrice from latest, explicit fee budget, approval before signing;
 *  - the signed tx hash is journaled before broadcast; raw provider errors never leave this file.
 * Signing is done ONLY by the user's own wallet (EIP-1193, e.g. MetaMask). No private key is read,
 * stored or handled anywhere in SEMMAL.
 */
import { createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { custom, decodeFunctionData, getAddress, numberToHex, parseAbi, type Hex } from "viem";

export const RABDI_CHAIN_ID = 7794095;
const REGISTRY = "0x4400000000000000000000000000000000000044";
const executeAbi = parseAbi([
  "function execute((uint8 operation, bytes operationData)[] ops) external returns (bytes32[] keys)",
]);
const readMethods = new Set([
  "eth_blockNumber",
  "eth_chainId",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getBlockByNumber",
]);
const fail = (message: string): never => {
  throw new Error(message);
};

export type Journal = {
  /** Durably record a public tx hash (before broadcast and after). Never key material. */
  record(entry: Record<string, unknown>): Promise<void> | void;
};

export type Approval = (tx: {
  from: string;
  to: string;
  chainId: number;
  gas: bigint;
  gasPrice: bigint;
  nonce: number;
  maximumCostWei: bigint;
}) => Promise<boolean> | boolean;

// viem's public client is typed loosely here on purpose: the Arkiv client decorates it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPublicClient = any;

export type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

/** Wallet mode (from the Arkiv quickstart): the wallet holds the key and shows its own confirmation. */
export function walletSigner(provider: Eip1193, selectedAddress: string) {
  const address = getAddress(selectedAddress);
  return {
    address,
    async verify() {
      const chain = await provider.request({ method: "eth_chainId" });
      const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
      if (Number(chain) !== RABDI_CHAIN_ID || !accounts.some((a) => getAddress(a) === address))
        throw new Error("Connect the selected account to Rabdi before signing");
    },
    async send(tx: Record<string, unknown> & { to: string; data: string; gas: bigint; gasPrice: bigint; nonce: number }) {
      try {
      return (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: tx.to,
            data: tx.data,
            value: "0x0",
            chainId: numberToHex(RABDI_CHAIN_ID),
            type: "0x0",
            gas: numberToHex(tx.gas),
            gasPrice: numberToHex(tx.gasPrice),
            nonce: numberToHex(tx.nonce),
          },
        ],
      })) as string;
      } catch (e) {
        // EIP-1193 4100: this site is not authorized for that account; 4001: the user rejected it
        const code = (e as { code?: number })?.code;
        if (code === 4100) throw new Error(`Your wallet has not authorized this site for ${address}. Open the wallet, connect this site to that account, then publish again`);
        if (code === 4001) throw new Error("You rejected the transaction in your wallet");
        throw e;
      }
    },
  };
}

type Signer = ReturnType<typeof walletSigner>;

export function guardedWalletClient(opts: {
  publicClient: AnyPublicClient;
  signer: Signer;
  accessKey: string;
  maxCostWei: bigint;
  approve: Approval;
  journal: Journal;
}) {
  const { publicClient, signer, accessKey, maxCostWei, approve, journal } = opts;
  if (typeof maxCostWei !== "bigint" || maxCostWei <= 0n) fail("Explicit positive fee budget required");
  const chain = rabdi({ accessKey });
  const address = getAddress(signer.address);
  // lastFailure: the guard's own message (the SDK replaces errors raised in the transport with a generic one)
  const state = { attempted: false, hash: null as string | null, reservedWei: 0n, phase: "ready", lastFailure: null as string | null };
  // the one operation this instance may sign: 1 = Create, 5 = Delete (SDK entity/params.ts OperationType)
  let expectedOp = 0;
  let approved: Record<string, unknown> & { to: string; data: string; gas: bigint; gasPrice: bigint; nonce: number; type: string };
  let explicit: { nonce: number; gas: bigint; gasPrice: bigint };

  const client = createWalletClient({
    chain,
    account: address,
    pollingInterval: 1000,
    transport: custom(
      {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
         try {
          if (readMethods.has(method)) return publicClient.request({ method, params });
          if (method !== "eth_sendTransaction" || state.attempted) fail("Only one create submission is permitted; do not retry");
          state.attempted = true;
          state.phase = "preflight";
          const input = params?.[0] as Record<string, string> | undefined;
          if (
            !input ||
            Object.keys(input).some((k) => !["from", "to", "data", "gas", "gasPrice", "nonce", "type"].includes(k)) ||
            getAddress(input.from!) !== address ||
            input.to?.toLowerCase() !== REGISTRY ||
            typeof input.data !== "string" ||
            BigInt(input.gas ?? 0) !== explicit.gas ||
            BigInt(input.gasPrice ?? 0) !== explicit.gasPrice ||
            Number(input.nonce) !== explicit.nonce ||
            (input.type !== undefined && input.type !== "0x0")
          )
            fail("Unexpected transaction fields");
          const decoded = decodeFunctionData({ abi: executeAbi, data: input!.data as Hex });
          const ops = decoded.args[0] as readonly { operation: number }[];
          if (decoded.functionName !== "execute" || ops.length !== 1 || ops[0]!.operation !== expectedOp)
            fail("Exactly one operation of the approved kind is required");
          if ((await publicClient.getChainId()) !== RABDI_CHAIN_ID) fail("Expected Rabdi RPC");
          await signer.verify();
          const started = Date.now();
          const call = { account: address, to: REGISTRY, data: input!.data, value: 0n };
          // Arkiv charges its fee while the write executes, so an empty wallet fails the dry run with
          // "Execution error without revert data"; say what it really is
          const have: bigint = await publicClient.getBalance({ address, blockTag: "latest" });
          if (have === 0n) fail(`This wallet (${address}) has no tGLM on Rabdi to pay Arkiv's fee. Get some at https://hub.arkiv.network/faucet and try again`);
          try {
            await publicClient.call({ ...call, blockTag: "latest" });
          } catch (e) {
            const m = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e);
            fail(/without revert data/i.test(m) ? `Arkiv rejected the write in a dry run (${m}). Usually this wallet has too little tGLM for the fee: it holds ${have} wei` : m);
          }
          const estimate: bigint = await publicClient.estimateGas({ ...call, blockTag: "latest" });
          if (typeof estimate !== "bigint" || estimate <= 0n) fail("Invalid unsigned gas estimate");
          const floor = 1_000_000n;
          const gas = estimate * 2n > floor ? estimate * 2n : floor;
          const head = await publicClient.getBlock({ blockTag: "latest", includeTransactions: false });
          if (typeof head.gasLimit !== "bigint" || head.gasLimit <= 0n || gas * 2n > head.gasLimit)
            fail("Gas exceeds half the current block limit");
          const { gasPrice, nonce } = explicit;
          const maximum = gas * gasPrice;
          if (maximum > maxCostWei || (await publicClient.getBalance({ address, blockTag: "latest" })) < maximum)
            fail("Fee budget or wallet balance is insufficient");
          approved = Object.freeze({
            from: address,
            to: REGISTRY,
            data: input!.data as string,
            value: 0n,
            chainId: RABDI_CHAIN_ID,
            type: "legacy",
            gas,
            gasPrice,
            nonce,
          });
          state.reservedWei = maximum;
          if ((await approve({ from: address, to: REGISTRY, chainId: RABDI_CHAIN_ID, gas, gasPrice, nonce, maximumCostWei: maximum })) !== true)
            fail("Creation was not approved");
          if (
            Date.now() - started > 60_000 ||
            (await publicClient.getChainId()) !== RABDI_CHAIN_ID ||
            (await publicClient.getTransactionCount({ address, blockTag: "latest" })) !== nonce ||
            (await publicClient.getGasPrice()) !== gasPrice
          )
            fail("Quote, network or nonce changed; a new approval is required");
          const freshEstimate: bigint = await publicClient.estimateGas({ ...call, blockTag: "latest" });
          const freshHead = await publicClient.getBlock({ blockTag: "latest", includeTransactions: false });
          if (
            typeof freshEstimate !== "bigint" ||
            freshEstimate <= 0n ||
            gas < freshEstimate * 2n ||
            typeof freshHead.gasLimit !== "bigint" ||
            gas * 2n > freshHead.gasLimit ||
            (await publicClient.getBalance({ address, blockTag: "latest" })) < maximum ||
            (await publicClient.getTransactionCount({ address, blockTag: "latest" })) !== nonce ||
            (await publicClient.getGasPrice()) !== gasPrice
          )
            fail("Signature bounds or fees changed; reconcile without signing");
          await signer.verify();
          state.phase = "submission_unknown";
          const hash = await signer.send(approved);
          if (!/^0x[0-9a-f]{64}$/i.test(hash)) fail("Invalid submitted hash");
          state.hash = hash;
          state.phase = "submitted";
          await journal.record({ phase: "submitted", txHash: hash });
          return hash;
         } catch (e) {
          state.lastFailure = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e).split("\n")[0]!.slice(0, 200);
          throw e;
         }
        },
      },
      { retryCount: 0 },
    ),
  });

  let invoked = false;

  async function run<T extends { txHash: string }>(op: number, send: (explicitParams: { nonce: number; gas: bigint; gasPrice: bigint }) => Promise<T>): Promise<T> {
    if (invoked) fail("This write adapter is one-shot");
    invoked = true;
    expectedOp = op;
    let failureReason = "verification_failed";
    try {
      explicit = Object.freeze({
        nonce: await publicClient.getTransactionCount({ address, blockTag: "latest" }),
        gas: 1_000_000n,
        gasPrice: await publicClient.getGasPrice(),
      });
      if (!Number.isSafeInteger(explicit.nonce) || explicit.nonce < 0 || explicit.gasPrice <= 0n)
        fail("Invalid explicit transaction parameters");
      const result = await send(explicit);
      if (result.txHash?.toLowerCase() !== state.hash?.toLowerCase()) {
        failureReason = "replacement_receipt";
        fail("Receipt belongs to a replacement");
      }
      const mined = await publicClient.getTransactionReceipt({ hash: state.hash });
      if (mined.status !== "success") fail("Transaction reverted");
      const tx = await publicClient.getTransaction({ hash: state.hash });
      if (
        getAddress(tx.from) !== address ||
        tx.to?.toLowerCase() !== REGISTRY ||
        String(tx.input).toLowerCase() !== approved.data.toLowerCase() ||
        tx.value !== 0n ||
        tx.chainId !== RABDI_CHAIN_ID ||
        tx.type !== approved.type ||
        tx.nonce !== approved.nonce ||
        tx.gas !== approved.gas ||
        tx.gasPrice !== approved.gasPrice
      ) {
        failureReason = "transaction_mismatch";
        fail("Submitted transaction differs from the approved request");
      }
      state.phase = "receipt_verified";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await journal.record({ phase: "receipt_verified", txHash: state.hash, entityKey: (result as any).entityKey });
      return result;
    } catch (e) {
      // keep the real cause: which check failed, or what the wallet/RPC said
      const cause = state.lastFailure ?? String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e).split("\n")[0]!.slice(0, 200);
      await journal.record({ phase: "failed", at: state.phase, reason: failureReason, cause, txHash: state.hash });
      if (!state.hash)
        // nothing was sent: safe to fix the cause and try again
        throw new Error(`Arkiv write not sent: ${cause}`);
      throw new Error(`Arkiv write sent (${state.hash}) but not verified: ${cause}. Check the transaction in the explorer before trying again; do not resend automatically`);
    }
  }

  return {
    getSubmission: () => ({ ...state, reservedWei: state.reservedWei.toString() }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createEntity(schema: any, values: any, options: any): Promise<{ entityKey: string; txHash: string; expiresAt?: bigint }> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return run(1, (p) => (client as any).createEntity(schema, values, options, p));
    },
    /** Delete one entity this wallet owns (only its owner can). */
    deleteEntity(entityKey: string): Promise<{ entityKey: string; txHash: string }> {
      if (!/^0x[0-9a-fA-F]{64}$/.test(entityKey)) fail("Not an entity key");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return run(5, (p) => (client as any).deleteEntity({ entityKey }, p));
    },
  };
}
