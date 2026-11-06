/**
 * Ownership and admin roles, held in data/admin.json (git-ignored), never in .env.
 *
 * Bootstrap: while no owner exists, the API prints a one-time setup code in its own terminal.
 * The first wallet that signs in AND enters that code becomes the owner. After that the code is
 * gone and only the owner can add admins or trusted publishers.
 *
 * Sign-in is Sign-In With Ethereum (EIP-4361): the wallet signs a text message. No transaction,
 * no fee, and no private key ever reaches SEMMAL.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getAddress, isAddress, verifyMessage } from "viem";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";

export type Role = "owner" | "admin" | "none";

export type AdminState = {
  version: 1;
  owner: string | null;
  admins: string[];
  trustedPublishers: string[];
  updatedAt: string;
  audit: { at: string; by: string; action: string; target?: string }[];
};

const empty = (): AdminState => ({ version: 1, owner: null, admins: [], trustedPublishers: [], updatedAt: new Date().toISOString(), audit: [] });

export class AdminStore {
  private state: AdminState;
  private setupCode: string | null = null;

  constructor(private path: string) {
    this.state = existsSync(path) ? { ...empty(), ...JSON.parse(readFileSync(path, "utf8")) } : empty();
  }

  /** Returns a fresh one-time code if no owner exists yet (print it to the server terminal only). */
  bootstrapCode(): string | null {
    if (this.state.owner) return null;
    if (!this.setupCode) this.setupCode = randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-");
    return this.setupCode;
  }

  get snapshot(): AdminState {
    return structuredClone(this.state);
  }

  roleOf(address: string): Role {
    const a = getAddress(address);
    if (this.state.owner && a === this.state.owner) return "owner";
    if (this.state.admins.includes(a)) return "admin";
    return "none";
  }

  /** Owner, admins and listed publishers: the only creators whose Arkiv entities are shown. */
  trustedPublishers(): string[] {
    return [...new Set([this.state.owner, ...this.state.admins, ...this.state.trustedPublishers].filter((x): x is string => Boolean(x)))];
  }

  claimOwnership(address: string, code: string) {
    if (this.state.owner) throw new Error("This SEMMAL instance already has an owner");
    if (!this.setupCode || code.trim().toUpperCase() !== this.setupCode) throw new Error("Setup code is wrong");
    this.state.owner = getAddress(address);
    this.setupCode = null;
    this.save(address, "claim_ownership", this.state.owner);
  }

  update(by: string, action: "add_admin" | "remove_admin" | "add_publisher" | "remove_publisher" | "transfer_owner", target: string) {
    if (!isAddress(target)) throw new Error("Not a valid wallet address");
    const t = getAddress(target);
    const role = this.roleOf(by);
    const ownerOnly = action === "add_admin" || action === "remove_admin" || action === "transfer_owner";
    if (role === "none" || (ownerOnly && role !== "owner")) throw new Error("Not allowed for your role");
    const s = this.state;
    if (action === "add_admin" && !s.admins.includes(t) && t !== s.owner) s.admins.push(t);
    if (action === "remove_admin") s.admins = s.admins.filter((x) => x !== t);
    if (action === "add_publisher" && !s.trustedPublishers.includes(t)) s.trustedPublishers.push(t);
    if (action === "remove_publisher") s.trustedPublishers = s.trustedPublishers.filter((x) => x !== t);
    if (action === "transfer_owner") {
      s.admins = s.admins.filter((x) => x !== t);
      s.owner = t;
    }
    this.save(by, action, t);
  }

  private save(by: string, action: string, target?: string) {
    const s = this.state;
    s.updatedAt = new Date().toISOString();
    s.audit = [...s.audit, { at: s.updatedAt, by: getAddress(by), action, target }].slice(-200);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2));
    const fd = openSync(tmp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.path); // atomic replace
  }
}

/** In-memory nonces and sessions. A restart signs everyone out, which is fine for an admin tool. */
export class WalletAuth {
  private nonces = new Map<string, number>();
  private sessions = new Map<string, { address: string; exp: number }>();

  /** `domains`: the hosts the site is served from (sign-in messages must name one of them). */
  private domains: string[];
  constructor(domains: string | string[], private sessionMs = 8 * 60 * 60 * 1000) {
    this.domains = Array.isArray(domains) ? domains : [domains];
  }

  issueNonce() {
    const nonce = generateSiweNonce();
    this.nonces.set(nonce, Date.now() + 5 * 60 * 1000);
    return nonce;
  }

  async verify(message: string, signature: `0x${string}`) {
    const fields = parseSiweMessage(message);
    const nonce = fields.nonce;
    const exp = nonce ? this.nonces.get(nonce) : undefined;
    if (!nonce || !exp || exp < Date.now()) throw new Error("Sign-in request expired; try again");
    this.nonces.delete(nonce); // one use only: replayed signatures fail
    if (!fields.address || !this.domains.some((domain) => validateSiweMessage({ message: fields, domain, nonce, time: new Date() })))
      throw new Error("Sign-in message is not for this site");
    const ok = await verifyMessage({ address: fields.address, message, signature });
    if (!ok) throw new Error("Signature does not match the wallet");
    const sid = randomUUID();
    const address = getAddress(fields.address);
    this.sessions.set(sid, { address, exp: Date.now() + this.sessionMs });
    return { sid, address };
  }

  addressFor(sid: string | undefined) {
    if (!sid) return null;
    const s = this.sessions.get(sid);
    if (!s || s.exp < Date.now()) {
      if (s) this.sessions.delete(sid);
      return null;
    }
    return s.address;
  }

  end(sid: string | undefined) {
    if (sid) this.sessions.delete(sid);
  }
}

export function readCookie(header: string | undefined, name: string) {
  return header
    ?.split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === name)?.[1];
}
