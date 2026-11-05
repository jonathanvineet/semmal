import type { FastifyReply, FastifyRequest } from "fastify";
import type { ArkivRegistry } from "@semmal/arkiv-adapter";

/**
 * Forwards only the read methods the Arkiv SDK 1.0.1 and the guarded wallet flow need
 * (checked in SDK source: arkiv_query, arkiv_getEntity, arkiv_getBlockTiming).
 * Any send/sign method is rejected: signing happens only in the user's wallet, which
 * broadcasts through its own RPC.
 */
export const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_estimateGas",
  "eth_call",
  "eth_getBalance",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "arkiv_query",
  "arkiv_getEntity",
  "arkiv_getBlockTiming",
]);

type RpcCall = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

export function arkivRpcProxy(registry: ArkivRegistry) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as RpcCall | RpcCall[];
    const calls = Array.isArray(body) ? body : [body];
    if (calls.length === 0 || calls.length > 10) return reply.code(400).send({ error: "1 to 10 calls per request" });
    for (const c of calls) {
      if (typeof c?.method !== "string" || !ALLOWED_METHODS.has(c.method))
        return reply.code(403).send({ jsonrpc: "2.0", id: c?.id ?? null, error: { code: -32601, message: "method not allowed by SEMMAL proxy" } });
    }
    const results = await Promise.all(
      calls.map(async (c) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (registry.publicClient as any).request({ method: c.method, params: c.params ?? [] });
          return { jsonrpc: "2.0", id: c.id ?? null, result };
        } catch (e) {
          const err = e as { code?: number; message?: string };
          return { jsonrpc: "2.0", id: c.id ?? null, error: { code: typeof err.code === "number" ? err.code : -32603, message: "upstream error" } };
        }
      }),
    );
    return Array.isArray(body) ? results : results[0];
  };
}
