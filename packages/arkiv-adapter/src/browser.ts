/** Browser entry: no node:* imports, no keys. Signing is done by the user's wallet. */
export * from "./schemas";
export * from "./encode";
export { guardedWalletClient, walletSigner, RABDI_CHAIN_ID, type Eip1193, type Journal, type Approval } from "./guarded-writer";
