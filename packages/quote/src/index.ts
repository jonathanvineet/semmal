/**
 * The robot's task quote. Deterministic code, never model output (CLAUDE.md rule 0.7: no AI
 * control over money). A model may help PLAN a task (checkpoints, which specialists); this turns
 * that plan into a price:
 *
 *   cost  = specialists (live Arkiv prices) + 0G inference (live Router token prices x estimated
 *           tokens, converted at a configured 0G->USDC rate) + operating time (per robot type)
 *   quote = cost x (1 + margin), then kept inside the owner's policy:
 *           below minFee -> minFee; above maxQuote -> maxQuote if that still covers cost;
 *           cost above maxQuote, or spend above maxSpendPerTask -> declined.
 *
 * Money is integer micro-USDC (1e-6) and integer neuron (1e-18 0G); no floating-point drift.
 */
export type TrustMode = "private" | "verified" | "standard";

export type Policy = { minFee: string; maxQuote: string; marginPct: number; maxSpendPerTask: string };

export type SpecialistOffer = {
  agentId: string;
  name: string;
  kind: string;
  price: string; // USDC per job
  trustMode: TrustMode | "none";
};

export type TaskPlan = {
  skill: string;
  waypoints: number;
  distanceM: number;
  /** Inference calls the plan needs (e.g. one vision check per waypoint). */
  checkpoints: number;
  privacy: TrustMode;
};

export type InferencePrice = {
  model: string;
  /** neuron per token, as /v1/models returns them */
  promptNeuron: string;
  completionNeuron: string;
};

export type QuoteInput = {
  robotType: string;
  policy: Policy;
  plan: TaskPlan;
  offers: SpecialistOffer[];
  inference: InferencePrice | null;
  /** USDC per 1 0G, from configuration. null when not configured. */
  zerogUsdcRate: string | null;
};

export type Line = { label: string; detail: string; usdc: string; source: "arkiv" | "0g-router" | "estimate" | "policy" };
export type Quote =
  | { status: "ok"; quote: string; cost: string; marginApplied: string; lines: Line[]; hired: SpecialistOffer[]; notes: string[] }
  | { status: "declined"; reason: string; cost?: string; lines: Line[]; hired: SpecialistOffer[]; notes: string[] };

const MICRO = 1_000_000n;
const NEURON_PER_0G = 10n ** 18n;

export function toMicro(amount: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error(`not a decimal amount: ${amount}`);
  const [i, f = ""] = amount.split(".");
  return BigInt(i!) * MICRO + BigInt((f + "000000").slice(0, 6));
}
export function fromMicro(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = `${a / MICRO}.${(a % MICRO).toString().padStart(6, "0")}`.replace(/0{1,4}$/, "");
  return (neg ? "-" : "") + s;
}
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Which specialist each skill needs. Delivery and manipulation run on the robot alone. */
/** Required specialists (`kinds`) and ones the robot hires only if one is on Arkiv (`optional`). */
export const SKILL_NEEDS: Record<string, { kinds: string[]; optional?: string[]; tokensIn: number; tokensOut: number }> = {
  "warehouse.inspection": { kinds: ["vision"], optional: ["inspection"], tokensIn: 1500, tokensOut: 200 },
  "aerial.inspection": { kinds: ["vision"], tokensIn: 1500, tokensOut: 200 },
  "site.inspection": { kinds: ["vision"], tokensIn: 1500, tokensOut: 200 },
  "warehouse.patrol": { kinds: ["vision"], optional: ["navigation"], tokensIn: 1200, tokensOut: 150 },
  "outdoor.patrol": { kinds: ["vision"], optional: ["navigation"], tokensIn: 1200, tokensOut: 150 },
  "home.cleaning": { kinds: ["vision"], optional: ["navigation"], tokensIn: 1300, tokensOut: 180 },
  "aerial.mapping": { kinds: [], tokensIn: 600, tokensOut: 150 },
  "indoor.delivery": { kinds: [], tokensIn: 400, tokensOut: 100 },
  "manipulation.pick-place": { kinds: [], tokensIn: 800, tokensOut: 150 },
  "manipulation.assembly": { kinds: [], tokensIn: 900, tokensOut: 200 },
  "manipulation.machine-tending": { kinds: [], tokensIn: 600, tokensOut: 150 },
  "manipulation.dexterous": { kinds: [], tokensIn: 900, tokensOut: 200 },
  "assist.human": { kinds: [], tokensIn: 600, tokensOut: 200 },
};

/**
 * Operating cost estimate per minute by robot type (energy, wear, supervision), micro-USDC.
 * Engineering estimates for quoting; shown on every quote as an estimate.
 */
export const OPERATING_MICRO_PER_MIN: Record<string, bigint> = {
  "diff-drive-indoor": 40_000n,
  "diff-drive-outdoor": 70_000n,
  "aerial-multirotor": 120_000n,
  "legged-quadruped": 90_000n,
  "fixed-arm": 35_000n,
  "dexterous-hand": 30_000n,
  humanoid: 150_000n,
  "mobile-manipulator": 80_000n,
};
/** Rough travel and work time: 0.5 m/s, plus 1.5 min of work per waypoint. */
export function estimateMinutes(plan: TaskPlan) {
  return Math.max(1, Math.ceil(plan.distanceM / 30 + plan.waypoints * 1.5));
}

/** Tokens one job of each agent kind typically uses (input incl. one image where relevant, output). */
export const AGENT_TOKENS: Record<string, { tokensIn: number; tokensOut: number; needsImage: boolean }> = {
  vision: { tokensIn: 1500, tokensOut: 200, needsImage: true },
  inspection: { tokensIn: 1200, tokensOut: 400, needsImage: false },
  maintenance: { tokensIn: 1000, tokensOut: 400, needsImage: false },
  navigation: { tokensIn: 800, tokensOut: 200, needsImage: false },
  "delivery-verification": { tokensIn: 1500, tokensOut: 150, needsImage: true },
};

/** 0G cost of `calls` inference calls in micro-USDC, rounded up. */
export function inferenceCostMicro(price: { promptNeuron: string; completionNeuron: string }, tokensIn: number, tokensOut: number, calls: number, zerogUsdcRate: string) {
  const neuron = BigInt(calls) * (BigInt(tokensIn) * BigInt(price.promptNeuron) + BigInt(tokensOut) * BigInt(price.completionNeuron));
  return ceilDiv(neuron * toMicro(zerogUsdcRate), NEURON_PER_0G);
}

/** An agent's per-job price: its model's live cost for one job plus the owner's margin (at least 0.01 USDC). */
export function agentJobPrice(kind: string, price: { promptNeuron: string; completionNeuron: string }, zerogUsdcRate: string, marginPct: number) {
  const t = AGENT_TOKENS[kind] ?? { tokensIn: 1000, tokensOut: 300, needsImage: false };
  const cost = inferenceCostMicro(price, t.tokensIn, t.tokensOut, 1, zerogUsdcRate);
  const withMargin = cost + ceilDiv(cost * BigInt(Math.round(marginPct * 100)), 10_000n);
  const floor = 10_000n; // 0.01 USDC
  return { costMicro: cost, priceMicro: withMargin < floor ? floor : withMargin, tokensIn: t.tokensIn, tokensOut: t.tokensOut, cost: fromMicro(cost), price: fromMicro(withMargin < floor ? floor : withMargin) };
}

const strength = { private: 3, verified: 2, standard: 1, none: 0 } as const;

/** The hiring rule (CLAUDE.md 6.3): right kind, trust at least the plan's, then strongest trust, then lowest price. */
export function pickSpecialists(plan: TaskPlan, offers: SpecialistOffer[]) {
  const need = SKILL_NEEDS[plan.skill];
  const hired: SpecialistOffer[] = [];
  const missing: string[] = [];
  const best = (kind: string) =>
    offers
      .filter((o) => o.kind === kind && strength[o.trustMode] >= strength[plan.privacy])
      .sort((a, b) => strength[b.trustMode] - strength[a.trustMode] || Number(toMicro(a.price) - toMicro(b.price)))[0];
  for (const kind of need?.kinds ?? []) {
    const fit = best(kind);
    if (fit) hired.push(fit);
    else missing.push(kind);
  }
  for (const kind of need?.optional ?? []) {
    const fit = best(kind);
    if (fit) hired.push(fit);
  }
  return { hired, missing };
}

export function quoteTask(input: QuoteInput): Quote {
  const { policy, plan } = input;
  const lines: Line[] = [];
  const notes: string[] = [];
  const minFee = toMicro(policy.minFee);
  const maxQuote = toMicro(policy.maxQuote);
  const spendCap = toMicro(policy.maxSpendPerTask);

  // 1. specialists the robot hires itself
  const { hired, missing } = pickSpecialists(plan, input.offers);
  if (missing.length)
    return { status: "declined", reason: `No ${missing.join(" or ")} agent on Arkiv meets ${plan.privacy} trust`, lines, hired, notes };
  let specialists = 0n;
  for (const h of hired) {
    // the robot buys one vision job per stop; planning agents once per task
    const jobs = h.kind === "vision" || h.kind === "delivery-verification" ? Math.max(1, plan.checkpoints) : 1;
    const p = toMicro(h.price) * BigInt(jobs);
    specialists += p;
    lines.push({ label: `${h.name}`, detail: `${h.kind} agent · ${h.trustMode} · ${jobs === 1 ? "1 job" : `${jobs} jobs × ${h.price}`}`, usdc: fromMicro(p), source: "arkiv" });
  }

  // 2. 0G inference: live token prices x estimated tokens, at the configured rate
  const need = SKILL_NEEDS[plan.skill] ?? { tokensIn: 800, tokensOut: 150, kinds: [] };
  let inference = 0n;
  if (plan.checkpoints > 0) {
    if (!input.inference) return { status: "declined", reason: "0G model price not available; the robot will not guess it", lines, hired, notes };
    if (!input.zerogUsdcRate) return { status: "declined", reason: "No 0G to USDC rate configured; the robot will not guess it", lines, hired, notes };
    // neuron -> 0G -> micro-USDC, rounded up so the robot never under-recovers
    inference = inferenceCostMicro(input.inference, need.tokensIn, need.tokensOut, plan.checkpoints, input.zerogUsdcRate);
    lines.push({
      label: "0G private inference",
      detail: `${plan.checkpoints} call${plan.checkpoints === 1 ? "" : "s"} × ~${need.tokensIn + need.tokensOut} tokens · ${input.inference.model} · ${plan.privacy}`,
      usdc: fromMicro(inference),
      source: "0g-router",
    });
    notes.push(`0G cost converted at the configured rate of ${input.zerogUsdcRate} USDC per 0G.`);
  }

  if (specialists + inference > spendCap)
    return {
      status: "declined",
      reason: `Specialists and inference cost ${fromMicro(specialists + inference)} USDC, over the owner's cap of ${policy.maxSpendPerTask}`,
      cost: fromMicro(specialists + inference),
      lines,
      hired,
      notes,
    };

  // 3. the robot's own operating time
  const minutes = estimateMinutes(plan);
  const rate = OPERATING_MICRO_PER_MIN[input.robotType] ?? 60_000n;
  const operating = BigInt(minutes) * rate;
  lines.push({ label: "Operating time", detail: `~${minutes} min · ${plan.distanceM} m · ${plan.waypoints} waypoint${plan.waypoints === 1 ? "" : "s"}`, usdc: fromMicro(operating), source: "estimate" });

  // 4. margin, then the owner's limits
  const cost = specialists + inference + operating;
  const margin = ceilDiv(cost * BigInt(Math.round(policy.marginPct * 100)), 10_000n);
  let quote = cost + margin;
  let marginApplied = margin;
  lines.push({ label: "Margin", detail: `${policy.marginPct}% set by the owner`, usdc: fromMicro(margin), source: "policy" });

  if (cost > maxQuote)
    return { status: "declined", reason: `Cost ${fromMicro(cost)} USDC is above the owner's maximum quote of ${policy.maxQuote}`, cost: fromMicro(cost), lines, hired, notes };
  // every adjustment is its own line, so the lines always add up to the quote
  if (quote > maxQuote) {
    const cut = quote - maxQuote;
    marginApplied = maxQuote - cost;
    quote = maxQuote;
    lines.push({ label: "Capped at maximum quote", detail: `the owner's limit is ${policy.maxQuote} USDC`, usdc: fromMicro(-cut), source: "policy" });
  }
  if (quote < minFee) {
    const topUp = minFee - quote;
    marginApplied += topUp;
    quote = minFee;
    lines.push({ label: "Minimum fee top-up", detail: `the owner's minimum is ${policy.minFee} USDC`, usdc: fromMicro(topUp), source: "policy" });
  }
  return { status: "ok", quote: fromMicro(quote), cost: fromMicro(cost), marginApplied: fromMicro(marginApplied), lines, hired, notes };
}
