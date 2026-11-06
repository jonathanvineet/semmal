/**
 * The robot's own device key and everything it is allowed to sign (CLAUDE.md rule 0.11).
 *
 * - The key is generated on this robot PC (`pnpm keygen`), stored at ~/.semmal/robot-key (mode 600),
 *   never logged, never sent anywhere, never shown to an AI.
 * - It signs only: EIP-191 manifest hashes, Arkiv creates of SEMMAL's robot-written schemas
 *   (quote, job claim, episode, incident) and 0G Storage uploads. Nothing else.
 * - Every Arkiv write goes through the one-shot guarded writer (gas bounds, fresh nonce, receipt
 *   check, no automatic resend) and an automatic approval policy: per-write fee cap and daily caps.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { getAddress, http, keccak256, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { EpisodeSchema, guardedWalletClient, IncidentSchema, JobClaimSchema, QuoteSchema, RABDI_CHAIN_ID } from "@semmal/arkiv-adapter";
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";

export const ALLOWED_SCHEMAS = [QuoteSchema, JobClaimSchema, EpisodeSchema, IncidentSchema];

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
}

export const defaultFeeCapWei = parseEther("0.01");
