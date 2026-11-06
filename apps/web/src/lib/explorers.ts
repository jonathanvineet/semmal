/**
 * Block explorer links. Paths read from each explorer's own route table (2026-11-06):
 *  - Arkiv Rabdi: https://rabdi.explorer.arkiv.network  /tx/<hash>  /address/<addr>  /entity/<key>
 *  - 0G Galileo:  https://chainscan-galileo.0g.ai        /tx/<hash>  /address/<addr>
 */
export const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";
export const GALILEO_EXPLORER = "https://chainscan-galileo.0g.ai";
const hex = (v: string | undefined | null, n: number) => Boolean(v && new RegExp(`^0x[0-9a-fA-F]{${n}}$`).test(v));

export const arkivTx = (h?: string | null) => (hex(h, 64) ? `${ARKIV_EXPLORER}/tx/${h}` : null);
export const arkivEntity = (k?: string | null) => (hex(k, 64) ? `${ARKIV_EXPLORER}/entity/${k}` : null);
export const arkivAddress = (a?: string | null) => (hex(a, 40) ? `${ARKIV_EXPLORER}/address/${a}` : null);
export const galileoTx = (h?: string | null) => (hex(h, 64) ? `${GALILEO_EXPLORER}/tx/${h}` : null);
export const galileoAddress = (a?: string | null) => (hex(a, 40) ? `${GALILEO_EXPLORER}/address/${a}` : null);
