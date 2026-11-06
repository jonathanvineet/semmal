/**
 * The robot's own device key and everything it is allowed to sign (CLAUDE.md rule 0.11).
 *
 * - The key is generated on this robot PC (`pnpm keygen`), stored at ~/.semmal/robot-key (mode 600),
 *   never logged, never sent anywhere, never shown to an AI.
 * - It signs only: EIP-191 manifest hashes, Arkiv creates of SEMMAL's robot-written schemas
 *   (quote, job claim, episode, incident), 0G Storage uploads, and native 0G payments on Galileo
 *   (agent jobs, the owner's payout, customer refunds) under per-payment and daily caps. Nothing else.
 *   It also signs SEMMAL robot identity messages (a fresh challenge at registration; see identify.ts).
 *   Who may be paid is decided by the mission (agent owners on Arkiv, its own owner, the paying
 *   customer); the device enforces the chain, the caps and exactly-once sending.
 * - Every Arkiv write goes through the one-shot guarded writer (gas bounds, fresh nonce, receipt
 *   check, no automatic resend) and an automatic approval policy: per-write fee cap and daily caps.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { createPublicClient as createViemClient, getAddress, http, keccak256, parseEther, type Hex } from "viem";
import { GALILEO_CHAIN_ID, galileo, memo, verifyTransfer, type PayKind } from "@semmal/zerog-pay";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { identityMessage } from "@semmal/contracts";
import { EpisodeSchema, EpisodeSchemaV2, guardedWalletClient, IncidentSchema, JobClaimSchema, QuoteSchema, RABDI_CHAIN_ID } from "@semmal/arkiv-adapter";
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";

export const ALLOWED_SCHEMAS = [QuoteSchema, JobClaimSchema, EpisodeSchema, EpisodeSchemaV2, IncidentSchema];

/** Create the device key once. Refuses to overwrite an existing key. */
export function generateDeviceKey(path: string) {
  if (existsSync(path)) throw new Error(`A device key already exists at ${path}; refusing to overwrite it`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const pk = generatePrivateKey();
  writeFileSync(path, pk + "\n", { mode: 0o600 });
  return privateKeyToAccount(pk).address;
}

function loadKey(path: string): Hex {
  if (!existsSync(path)) throw new Error(`No device key at ${path}. Run: pnpm keygen`);
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`${path} must be readable by its owner only (chmod 600)`);
  const pk = readFileSync(path, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error(`${path} does not hold a key`);
  return pk as Hex;
}

export type DeviceConfig = {
  keyPath: string;
  dataDir: string;
  arkivAccessKey: string;
  maxArkivFeeWei: bigint; // per write
  maxArkivWritesPerDay: number;
  storageRpc: string;
  storageIndexer: string;
  maxUploadsPerDay: number;
  /** 0G Galileo RPC for payments (same chain as Storage). */
  payRpc: string;
  maxPaymentWei: bigint; // per payment
  maxPaidWeiPerDay: bigint; // all payments in one UTC day
  maxPaymentFeeWei: bigint; // gas x fee for one payment
};

export class Device {
  readonly address: `0x${string}`;
  private account;
  private pk: Hex;
  readonly arkiv;
  private db: DatabaseSync;
  private journalPath: string;

  constructor(private cfg: DeviceConfig) {
    this.pk = loadKey(cfg.keyPath);
    this.account = privateKeyToAccount(this.pk);
    this.address = this.account.address;
    this.arkiv = createPublicClient({ chain: rabdi({ accessKey: cfg.arkivAccessKey }), transport: http(undefined, { timeout: 15_000, retryCount: 0 }) });
    mkdirSync(cfg.dataDir, { recursive: true });
    this.db = new DatabaseSync(`${cfg.dataDir}/robot-master.db`);
    this.db.exec("CREATE TABLE IF NOT EXISTS spend (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, kind))");
    // one row per payment intent: the signed transaction is stored BEFORE it is broadcast, so a
    // restart re-broadcasts the same bytes (same hash, same nonce) and never pays twice
    this.db.exec(`CREATE TABLE IF NOT EXISTS payments (
      pay_id TEXT PRIMARY KEY, day TEXT NOT NULL, to_addr TEXT NOT NULL, wei TEXT NOT NULL,
      raw TEXT NOT NULL, tx_hash TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)`);
    this.journalPath = `${cfg.dataDir}/device-journal.jsonl`;
  }

  /** EIP-191 signature over a manifest hash string (e.g. "sha256:…"). */
  signManifestHash(hash: string) {
    return this.account.signMessage({ message: hash });
  }

  private bump(kind: string, cap: number) {
    const day = new Date().toISOString().slice(0, 10);
    const row = this.db.prepare("SELECT n FROM spend WHERE day = ? AND kind = ?").get(day, kind) as { n: number } | undefined;
    if ((row?.n ?? 0) >= cap) throw new Error(`daily ${kind} cap of ${cap} reached`);
    this.db.prepare("INSERT INTO spend (day, kind, n) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET n = n + 1").run(day, kind);
  }

  private journal(e: Record<string, unknown>) {
    appendFileSync(this.journalPath, JSON.stringify({ at: new Date().toISOString(), ...e }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
  }

  /** One Arkiv create of an allowlisted schema, signed by the device key automatically. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async arkivCreate(key: string, args: { schema: any; values: any; options: any }) {
    if (!ALLOWED_SCHEMAS.includes(args.schema)) throw new Error("schema not allowed for the robot's key");
    this.bump("arkiv", this.cfg.maxArkivWritesPerDay);
    const pub = this.arkiv;
    const account = this.account;
    const signer = {
      address: getAddress(this.address),
      async verify() {
        if ((await pub.getChainId()) !== RABDI_CHAIN_ID) throw new Error("Expected Rabdi RPC");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async send(tx: any) {
        const { from: _f, ...unsigned } = tx;
        const raw = await account.signTransaction(unsigned);
        const hash = keccak256(raw);
        journalRef({ key, phase: "signed", txHash: hash });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sent: string = await (pub as any).sendRawTransaction({ serializedTransaction: raw });
        if (sent.toLowerCase() !== hash.toLowerCase()) throw new Error("RPC returned a different transaction hash");
        return sent;
      },
    };
    const journalRef = (e: Record<string, unknown>) => this.journal(e);
    const cap = this.cfg.maxArkivFeeWei;
    const w = guardedWalletClient({
      publicClient: pub,
      signer,
      accessKey: this.cfg.arkivAccessKey,
      maxCostWei: cap,
      journal: { record: (e) => journalRef({ key, ...e }) },
      approve: (tx) => tx.chainId === RABDI_CHAIN_ID && tx.maximumCostWei <= cap,
    });
    return w.createEntity(args.schema, args.values, args.options);
  }

  /** Upload bytes to 0G Storage (Galileo), signed by the device key. Returns the root and tx hash. */
  async storageUpload(bytes: Uint8Array) {
    this.bump("storage", this.cfg.maxUploadsPerDay);
    const provider = new ethers.JsonRpcProvider(this.cfg.storageRpc);
    const wallet = new ethers.Wallet(this.pk, provider);
    const indexer = new Indexer(this.cfg.storageIndexer);
    const file = new MemData(bytes);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr || !tree) throw new Error(`merkle tree: ${treeErr?.message ?? "failed"}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [res, err] = await indexer.upload(file, this.cfg.storageRpc, wallet as any);
    if (err) throw new Error(`0G Storage upload failed: ${err.message}`);
    if (!("rootHash" in res)) throw new Error("unexpected fragmented upload for a small bundle");
    this.journal({ kind: "storage", rootHash: res.rootHash, txHash: res.txHash });
    return { rootHash: res.rootHash as `0x${string}`, txHash: res.txHash, expectedRoot: tree.rootHash() };
  }

  get payClient() {
    return createViemClient({ chain: galileo, transport: http(this.cfg.payRpc, { timeout: 15_000, retryCount: 1 }) });
  }

  async balanceWei() {
    return this.payClient.getBalance({ address: this.address });
  }

  /** Check a transfer someone made TO this robot (a customer paying a quote). */
  checkIncoming(want: { hash: `0x${string}`; from: string; minWei: bigint; kind: PayKind; id: string }) {
    return verifyTransfer(this.payClient, { hash: want.hash, to: this.address, from: want.from, minWei: want.minWei, memo: memo(want.kind, want.id) });
  }

  /**
   * Send one native 0G payment, exactly once per (kind, id). Caps: per payment, per UTC day, fee.
   * Returns when mined. A second call with the same kind and id returns the first payment's result.
   */
  async pay(p: { to: string; wei: bigint; kind: Exclude<PayKind, "quote">; id: string }): Promise<{ txHash: `0x${string}`; status: "success" | "reverted" | "pending" }> {
    const payId = `${p.kind}:${p.id}`;
    const client = this.payClient;
    const wait = async (hash: `0x${string}`) => {
      const rc = await client.waitForTransactionReceipt({ hash, timeout: 90_000 }).catch(() => null);
      const status = rc ? (rc.status === "success" ? "success" : "reverted") : "pending";
      this.db.prepare("UPDATE payments SET status = ? WHERE pay_id = ?").run(status, payId);
      return { txHash: hash, status } as const;
    };
    const prior = this.db.prepare("SELECT raw, tx_hash, status FROM payments WHERE pay_id = ?").get(payId) as { raw: string; tx_hash: string; status: string } | undefined;
    if (prior) {
      if (prior.status === "success" || prior.status === "reverted") return { txHash: prior.tx_hash as `0x${string}`, status: prior.status };
      await client.sendRawTransaction({ serializedTransaction: prior.raw as Hex }).catch(() => undefined); // same bytes: harmless if already known
      return wait(prior.tx_hash as `0x${string}`);
    }
    if (p.wei <= 0n) throw new Error("payment must be positive");
    if (p.wei > this.cfg.maxPaymentWei) throw new Error(`payment of ${p.wei} wei is over the per-payment cap`);
    const day = new Date().toISOString().slice(0, 10);
    const today = (this.db.prepare("SELECT wei FROM payments WHERE day = ? AND status <> 'reverted'").all(day) as { wei: string }[]).reduce((a, r) => a + BigInt(r.wei), 0n);
    if (today + p.wei > this.cfg.maxPaidWeiPerDay) throw new Error("daily payment cap reached");
    if ((await client.getChainId()) !== GALILEO_CHAIN_ID) throw new Error("payment RPC is not 0G Galileo");
    const to = getAddress(p.to);
    if (to === this.address) throw new Error("refusing to pay itself");
    const req = await client.prepareTransactionRequest({ account: this.account, to, value: p.wei, data: memo(p.kind, p.id), chain: galileo });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = req as any;
    const fee = BigInt(r.gas) * BigInt(r.maxFeePerGas ?? r.gasPrice ?? 0n);
    if (fee > this.cfg.maxPaymentFeeWei) throw new Error(`payment fee ${fee} wei is over the fee cap`);
    const raw = await this.account.signTransaction(r);
    const hash = keccak256(raw);
    this.db
      .prepare("INSERT INTO payments (pay_id, day, to_addr, wei, raw, tx_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'signed', ?)")
      .run(payId, day, to, p.wei.toString(), raw, hash, new Date().toISOString());
    this.journal({ kind: "payment", payId, to, wei: p.wei, txHash: hash });
    const sent = await client.sendRawTransaction({ serializedTransaction: raw });
    if (sent.toLowerCase() !== hash.toLowerCase()) throw new Error("RPC returned a different transaction hash");
    return wait(hash);
  }
}

export const defaultFeeCapWei = parseEther("0.01");

/**
 * Only what registration needs: the address, and an EIP-191 signature over a SEMMAL identity message
 * it builds itself from fixed fields (it never signs caller-supplied text).
 */
export function identitySigner(keyPath: string) {
  const account = privateKeyToAccount(loadKey(keyPath));
  return {
    address: account.address,
    signIdentity: (d: { hardwareModel: string; factsHash: string; nonce: string; issuedAt: string }) =>
      account.signMessage({ message: identityMessage({ wallet: account.address, ...d }) }),
  };
}

