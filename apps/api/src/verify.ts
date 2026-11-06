/**
 * Verify robot evidence: Arkiv record -> 0G Storage bundle (downloaded WITH Merkle proof) ->
 * robot signature (EIP-191 by the robot wallet on its Arkiv profile) -> record/bundle agreement.
 * Episode manifest hashes are recomputed here. Incident manifests are hashed by the robot's Python
 * canonicaliser, whose float text JS cannot reproduce, so for incidents the hash is taken from the
 * signed manifest and the signature, root and Arkiv link are checked.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { verifyMessage } from "viem";

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

export type Checks = { storageProof: boolean; manifestHash: boolean | null; signature: boolean; arkivLink: boolean; detail: string[] };

export async function fetchBundle(indexerUrl: string, root: string, cacheDir: string) {
  mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, `${root}.json`);
  rmSync(path, { force: true }); // always re-download with proof; never trust a cached copy
  const err = await new Indexer(indexerUrl).download(root, path, true);
  if (err) return { ok: false as const, error: err.message };
  return { ok: true as const, text: readFileSync(path, "utf8") };
}

export async function verifyEpisode(bundleText: string, record: { manifestHash: string; robotSignature: string; robotWallet: string }, registeredWallet: string): Promise<Checks> {
  const detail: string[] = [];
  const b = JSON.parse(bundleText);
  const { manifest_hash, robot_signature, ...body } = b;
  const recomputed = `sha256:${createHash("sha256").update(canonical(body)).digest("hex")}`;
  const manifestHash = recomputed === manifest_hash;
  if (!manifestHash) detail.push("bundle content does not match its manifest hash");
  const signature = registeredWallet.toLowerCase() === record.robotWallet.toLowerCase() && (await verifyMessage({ address: registeredWallet as `0x${string}`, message: manifest_hash, signature: robot_signature }).catch(() => false));
  if (!signature) detail.push("signature is not from the robot wallet on its Arkiv profile");
  const arkivLink = record.manifestHash === `0x${String(manifest_hash).replace("sha256:", "")}` && record.robotSignature === robot_signature;
  if (!arkivLink) detail.push("Arkiv record and bundle disagree");
  return { storageProof: true, manifestHash, signature, arkivLink, detail };
}

export async function verifyIncident(bundleText: string, record: { manifestHash: string; robotSignature: string; robotWallet: string }, registeredWallet: string): Promise<Checks> {
  const detail: string[] = ["manifest hash computed by the robot's Python canonicaliser; checked via signature and Arkiv link"];
  const b = JSON.parse(bundleText);
  const m = b.manifest ?? {};
  const signature = registeredWallet.toLowerCase() === record.robotWallet.toLowerCase() && (await verifyMessage({ address: registeredWallet as `0x${string}`, message: m.manifest_hash, signature: m.robot_signature }).catch(() => false));
  if (!signature) detail.push("signature is not from the robot wallet on its Arkiv profile");
  const arkivLink = record.manifestHash === `0x${String(m.manifest_hash).replace("sha256:", "")}` && record.robotSignature === m.robot_signature;
  if (!arkivLink) detail.push("Arkiv record and bundle disagree");
  return { storageProof: true, manifestHash: null, signature, arkivLink, detail };
}
