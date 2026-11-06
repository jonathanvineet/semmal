/**
 * The robot's task quote. Deterministic code, never model output (CLAUDE.md rule 0.7: no AI
 * control over money). A model may help PLAN a task (checkpoints, which specialists); this turns
 * that plan into a price:
 *
 *   cost  = specialists (live Arkiv prices, per job; each agent's price already includes its own 0G
 *           inference) + operating time (per robot type)
 *   quote = cost x (1 + margin), then kept inside the owner's policy:
 *           below minFee -> minFee; above maxQuote -> maxQuote if that still covers cost;
 *           cost above maxQuote, or spend above maxSpendPerTask -> declined.
 *
 * Everything is priced and paid in the native 0G token. Money is integer micro-0G (1e-6 0G) and
 * integer neuron (1e-18 0G); no floating-point drift. 1 micro-0G = 1e12 neuron (wei).
 */
export type TrustMode = "private" | "verified" | "standard";

export type Policy = { minFee: string; maxQuote: string; marginPct: number; maxSpendPerTask: string };

export type SpecialistOffer = {
  agentId: string;
  name: string;
  kind: string;
  price: string; // 0G per job
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
};

export const TOKEN = "0G";
export type Line = { label: string; detail: string; amount: string; source: "arkiv" | "0g-router" | "estimate" | "policy" };
export type Quote =
  | { status: "ok"; quote: string; cost: string; marginApplied: string; lines: Line[]; hired: SpecialistOffer[]; notes: string[] }
  | { status: "declined"; reason: string; cost?: string; lines: Line[]; hired: SpecialistOffer[]; notes: string[] };

const MICRO = 1_000_000n;
const NEURON_PER_MICRO = 10n ** 12n;
/** micro-0G -> wei (neuron), for transfers. */
export const microToWei = (v: bigint) => v * NEURON_PER_MICRO;
export const toWei = (amount: string) => microToWei(toMicro(amount));
/** wei -> micro-0G, rounded down (what was actually received). */
export const weiToMicro = (wei: bigint) => wei / NEURON_PER_MICRO;

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
  "warehouse.inspection": { kinds: ["vision"], tokensIn: 1500, tokensOut: 800 },
  "aerial.inspection": { kinds: ["vision"], tokensIn: 1500, tokensOut: 800 },
  "site.inspection": { kinds: ["vision"], tokensIn: 1500, tokensOut: 800 },
  "warehouse.patrol": { kinds: ["vision"], optional: ["navigation"], tokensIn: 1200, tokensOut: 800 },
  "outdoor.patrol": { kinds: ["vision"], optional: ["navigation"], tokensIn: 1200, tokensOut: 800 },
  "home.cleaning": { kinds: ["vision"], optional: ["navigation"], tokensIn: 1300, tokensOut: 800 },
  "aerial.mapping": { kinds: [], tokensIn: 600, tokensOut: 150 },
  "indoor.delivery": { kinds: [], tokensIn: 400, tokensOut: 100 },
  "manipulation.pick-place": { kinds: [], tokensIn: 800, tokensOut: 150 },
  "manipulation.assembly": { kinds: [], tokensIn: 900, tokensOut: 200 },
  "manipulation.machine-tending": { kinds: [], tokensIn: 600, tokensOut: 150 },
  "manipulation.dexterous": { kinds: [], tokensIn: 900, tokensOut: 200 },
  "assist.human": { kinds: [], tokensIn: 600, tokensOut: 200 },
};

/**
 * Operating cost estimate per minute by robot type (energy, wear, supervision), micro-0G.
 * Engineering estimates for quoting, sized for testnet amounts; shown on every quote as an estimate.
 */
export const OPERATING_MICRO_PER_MIN: Record<string, bigint> = {
  "diff-drive-indoor": 400n,
  "diff-drive-outdoor": 700n,
  "aerial-multirotor": 1_200n,
  "legged-quadruped": 900n,
  "fixed-arm": 350n,
  "dexterous-hand": 300n,
  humanoid: 1_500n,
  "mobile-manipulator": 800n,
};
/** Rough travel and work time: 0.5 m/s, plus 1.5 min of work per waypoint. */
export function estimateMinutes(plan: TaskPlan) {
  return Math.max(1, Math.ceil(plan.distanceM / 30 + plan.waypoints * 1.5));
}

/** Tokens one job of each agent kind typically uses (input incl. one image where relevant, output). */
export const AGENT_TOKENS: Record<string, { tokensIn: number; tokensOut: number; needsImage: boolean }> = {
  // completion includes the model's hidden reasoning: measured ~480 tokens for one frame on 0gm-1.0-35b-a3b
  vision: { tokensIn: 1500, tokensOut: 800, needsImage: true },
  inspection: { tokensIn: 1200, tokensOut: 400, needsImage: false },
  maintenance: { tokensIn: 1000, tokensOut: 400, needsImage: false },
  navigation: { tokensIn: 800, tokensOut: 200, needsImage: false },
  "delivery-verification": { tokensIn: 1500, tokensOut: 800, needsImage: true },
};

/** 0G cost of `calls` inference calls in micro-0G, rounded up. Exact: no exchange rate. */
export function inferenceCostMicro(price: { promptNeuron: string; completionNeuron: string }, tokensIn: number, tokensOut: number, calls: number) {
  const neuron = BigInt(calls) * (BigInt(tokensIn) * BigInt(price.promptNeuron) + BigInt(tokensOut) * BigInt(price.completionNeuron));
  return ceilDiv(neuron, NEURON_PER_MICRO);
}

/** An agent's per-job price in 0G: its model's live cost for one job plus the owner's margin (at least 0.0001 0G). */
export function agentJobPrice(kind: string, price: { promptNeuron: string; completionNeuron: string }, marginPct: number) {
  const t = AGENT_TOKENS[kind] ?? { tokensIn: 1000, tokensOut: 300, needsImage: false };
  const cost = inferenceCostMicro(price, t.tokensIn, t.tokensOut, 1);
  const withMargin = cost + ceilDiv(cost * BigInt(Math.round(marginPct * 100)), 10_000n);
  const floor = 100n; // 0.0001 0G
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
    lines.push({ label: `${h.name}`, detail: `${h.kind} agent · ${h.trustMode} · ${jobs === 1 ? "1 job" : `${jobs} jobs × ${h.price}`}`, amount: fromMicro(p), source: "arkiv" });
  }

  // 2. 0G inference: the robot calls 0G only through its agents, and each agent's price already covers
  //    its own model cost (agent price = live model cost + its owner's margin). So no separate line:
  //    adding one would charge the customer twice. Shown as a note for transparency.
  const inference = 0n;
  const need = SKILL_NEEDS[plan.skill];
  if (plan.checkpoints > 0 && input.inference && need?.kinds.length) {
    const inside = inferenceCostMicro(input.inference, need.tokensIn, need.tokensOut, plan.checkpoints);
    notes.push(`About ${fromMicro(inside)} 0G of the agents' prices is their own 0G inference (${plan.checkpoints} × ~${need.tokensIn + need.tokensOut} tokens on ${input.inference.model}).`);
  }

  if (specialists + inference > spendCap)
    return {
      status: "declined",
      reason: `Agents cost ${fromMicro(specialists + inference)} 0G, over the owner's cap of ${policy.maxSpendPerTask}`,
      cost: fromMicro(specialists + inference),
      lines,
      hired,
      notes,
    };

  // 3. the robot's own operating time
  const minutes = estimateMinutes(plan);
  const rate = OPERATING_MICRO_PER_MIN[input.robotType] ?? 60_000n;
  const operating = BigInt(minutes) * rate;
  lines.push({ label: "Operating time", detail: `~${minutes} min · ${plan.distanceM} m · ${plan.waypoints} waypoint${plan.waypoints === 1 ? "" : "s"}`, amount: fromMicro(operating), source: "estimate" });

  // 4. margin, then the owner's limits
  const cost = specialists + inference + operating;
  const margin = ceilDiv(cost * BigInt(Math.round(policy.marginPct * 100)), 10_000n);
  let quote = cost + margin;
  let marginApplied = margin;
  lines.push({ label: "Margin", detail: `${policy.marginPct}% set by the owner`, amount: fromMicro(margin), source: "policy" });

  if (cost > maxQuote)
    return { status: "declined", reason: `Cost ${fromMicro(cost)} 0G is above the owner's maximum quote of ${policy.maxQuote}`, cost: fromMicro(cost), lines, hired, notes };
  // every adjustment is its own line, so the lines always add up to the quote
  if (quote > maxQuote) {
    const cut = quote - maxQuote;
    marginApplied = maxQuote - cost;
    quote = maxQuote;
    lines.push({ label: "Capped at maximum quote", detail: `the owner's limit is ${policy.maxQuote} 0G`, amount: fromMicro(-cut), source: "policy" });
  }
  if (quote < minFee) {
    const topUp = minFee - quote;
    marginApplied += topUp;
    quote = minFee;
    lines.push({ label: "Minimum fee top-up", detail: `the owner's minimum is ${policy.minFee} 0G`, amount: fromMicro(topUp), source: "policy" });
  }
  return { status: "ok", quote: fromMicro(quote), cost: fromMicro(cost), marginApplied: fromMicro(marginApplied), lines, hired, notes };
}
