/**
 * 0G Compute Router adapter (OpenAI-compatible). Facts verified 2026-11-05 from
 * docs.0g.ai/developer-hub/building-on-0g/compute-network/router/* (see docs/FACT_CHECK.md):
 *  - POST {base}/chat/completions, Authorization: Bearer sk-...
 *  - X-0G-Provider-Trust-Mode: standard | verified | private ; 503 no_provider_for_trust_mode, no silent fallback
 *  - body.x_0g_trace.{request_id, provider, billing{input_cost,output_cost,total_cost}} (neuron)
 *  - optional body flag verify_tee:true -> x_0g_trace.tee_verified
 *  - response header ZG-Res-Key = chat ID for TEE verification
 *  - GET {base}/models needs no auth; private-capable models have verifiability == "TeeML"
 * The API key is read server-side only. Prompts and images are never logged or persisted here.
 */
import type { InferenceRequest, InferenceResult, TrustMode } from "@semmal/contracts";

export type ZeroGConfig = {
  baseUrl: string; // e.g. https://router-api.0g.ai/v1
  apiKey: string;
  defaultModel: string;
  requiredTrustMode: TrustMode;
  timeoutMs: number;
};

export function zeroGConfigFromEnv(env = process.env): ZeroGConfig {
  return {
    baseUrl: (env.ZEROG_ROUTER_BASE_URL ?? "").replace(/\/$/, ""),
    apiKey: env.ZEROG_ROUTER_API_KEY ?? "",
    defaultModel: env.ZEROG_DEFAULT_MODEL ?? "",
    requiredTrustMode: (env.ZEROG_REQUIRED_TRUST_MODE as TrustMode) || "private",
    timeoutMs: Number(env.ZEROG_REQUEST_TIMEOUT_MS || 30_000),
  };
}

export class ZeroGError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus?: number,
    readonly providerRequestId?: string,
  ) {
    super(message);
  }
}

export type RouterModel = {
  id: string;
  name?: string;
  verifiability?: string | null;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
};

/** Trust mode -> the verifiability a model must advertise to be able to serve it. */
function modelCanServe(model: RouterModel, mode: TrustMode) {
  if (mode === "standard") return true;
  if (mode === "private") return model.verifiability === "TeeML";
  return model.verifiability === "TeeML" || model.verifiability === "TeeTLS";
}

export class ZeroGRouter {
  constructor(readonly config: ZeroGConfig) {}

  get configured() {
    return Boolean(this.config.baseUrl && this.config.apiKey);
  }

  async listModels(): Promise<RouterModel[]> {
    if (!this.config.baseUrl) throw new ZeroGError("ZEROG_ROUTER_BASE_URL is not set", "not_configured");
    const res = await fetch(`${this.config.baseUrl}/models`, { signal: AbortSignal.timeout(this.config.timeoutMs) });
    if (!res.ok) throw new ZeroGError(`Router /models returned ${res.status}`, "models_failed", res.status);
    const body = (await res.json()) as { data?: RouterModel[] };
    return body.data ?? [];
  }

  /**
   * Checks the public catalog. Observed 2026-11-05: different gateway instances return different
   * catalogs (124 models with `verifiability` vs 79 without it). So a missing model or field is
   * "unconfirmed", not proof either way. Enforcement still happens per request: the Router
   * returns 503 no_provider_for_trust_mode instead of downgrading.
   */
  async checkModel(modelId: string, mode: TrustMode, needsImage: boolean) {
    let model: RouterModel | undefined;
    for (let attempt = 0; attempt < 2 && !model; attempt++) model = (await this.listModels()).find((m) => m.id === modelId);
    if (!model) return { ok: null, status: "unconfirmed" as const, reason: `model ${modelId} not listed by this Router gateway instance` };
    if (needsImage && model.architecture?.input_modalities && !model.architecture.input_modalities.includes("image"))
      return { ok: false, status: "fail" as const, reason: `model ${modelId} does not accept images`, model };
    if (model.verifiability === undefined || model.verifiability === null)
      return { ok: null, status: "unconfirmed" as const, reason: `catalog gave no verifiability for ${modelId}; the Router enforces ${mode} per request`, model };
    if (!modelCanServe(model, mode))
      return { ok: false, status: "fail" as const, reason: `model ${modelId} advertises verifiability=${model.verifiability}; cannot serve ${mode}`, model };
    return { ok: true, status: "ok" as const, model };
  }

  async chat(req: InferenceRequest): Promise<InferenceResult> {
    if (!this.configured) throw new ZeroGError("0G Router is not configured; refusing to fabricate a result", "not_configured");
    const started = performance.now();
    const deadline = req.deadlineMs ?? this.config.timeoutMs;
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(deadline),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "X-0G-Provider-Trust-Mode": req.trustRequirement,
          "X-Correlation-Id": req.correlationId,
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          max_tokens: req.maxTokens ?? 400,
          temperature: 0,
          ...(req.responseFormat ? { response_format: { type: req.responseFormat } } : {}),
          ...(req.verifyTee ? { verify_tee: true } : {}),
        }),
      });
    } catch (e) {
      const timeout = (e as Error)?.name === "TimeoutError";
      throw new ZeroGError(timeout ? `0G Router timed out after ${deadline} ms` : "0G Router unreachable", timeout ? "timeout" : "unreachable");
    }
    const latencyMs = Math.round(performance.now() - started);
    const chatId = res.headers.get("ZG-Res-Key") ?? undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new ZeroGError(`0G Router returned ${res.status} with a non-JSON body`, "bad_response", res.status);
    }
    if (!res.ok) {
      const code = String(body?.error?.code ?? "http_error");
      throw new ZeroGError(`0G Router ${res.status} ${code}`, code, res.status, body?.request_id ?? body?.x_0g_trace?.request_id);
    }
    const trace = body?.x_0g_trace ?? {};
    const output = body?.choices?.[0]?.message?.content;
    if (typeof output !== "string") throw new ZeroGError("0G Router response had no message content", "empty_output", res.status, trace.request_id);
    const teeVerified = trace.tee_verified;
    return {
      correlationId: req.correlationId,
      provenance: "ZEROG_ROUTER",
      providerRequestId: typeof trace.request_id === "string" ? trace.request_id : undefined,
      chatId: chatId ?? (typeof body.id === "string" ? body.id : undefined),
      providerAddress: typeof trace.provider === "string" ? trace.provider : undefined,
      model: typeof body.model === "string" ? body.model : req.model,
      requestedTrustMode: req.trustRequirement,
      trustEvidence: teeVerified === true ? "tee_verified" : teeVerified === false ? "tee_verification_failed" : "requested_header_enforced_by_router",
      output,
      latencyMs,
      billing: trace.billing
        ? { inputCost: trace.billing.input_cost, outputCost: trace.billing.output_cost, totalCost: trace.billing.total_cost, unit: "neuron" }
        : undefined,
      usage: body.usage
        ? { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens, totalTokens: body.usage.total_tokens }
        : undefined,
    };
  }
}
