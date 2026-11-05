/**
 * SEMMAL's first-party specialist agent listings, offered as drafts on /publish. They appear in
 * the marketplace only after their owner publishes them to Arkiv with a wallet.
 */
import type { AgentListing, RobotProfile } from "@semmal/contracts";

export const DRAFT_OWNER = "0x0000000000000000000000000000000000000001";
const VISION_MODEL = process.env.ZEROG_VISION_MODEL || "0gm-1.0-35b-a3b";
const TEXT_MODEL = process.env.ZEROG_DEFAULT_MODEL || "0gm-1.0-35b-a3b";

const diffDrive = ["diff-drive-indoor"] as const;

export function agentFixtures(owner = DRAFT_OWNER): AgentListing[] {
  const cap = (capabilityId: string, tasks: string[]) => ({
    capabilityId,
    inputSchemaVersion: "1.0",
    outputSchemaVersion: "1.0",
    supportedRobotTypes: [...diffDrive],
    supportedTaskTypes: tasks,
  });
  return [
    {
      schemaVersion: "1.0",
      agentId: "agent-vision-lumen",
      ownerWallet: owner,
      displayName: "Lumen Vision",
      kind: "vision",
      summary: "Reads one camera keyframe and reports obstructions on machine panels, in private mode.",
      endpoint: "http://localhost:4101/v1/jobs",
      capabilities: [cap("vision.panel-inspection", ["warehouse.inspection"])],
      price: { amount: "0.40", token: "USDC", unit: "job" },
      inference: { model: VISION_MODEL, trustMode: "private" },
      delegation: { allowed: false, maxBudgetShare: 0 },
      serviceVersion: "0.1.0",
    },
    {
      schemaVersion: "1.0",
      agentId: "agent-vision-kestrel",
      ownerWallet: owner,
      displayName: "Kestrel Vision",
      kind: "vision",
      summary: "Faster, cheaper keyframe checks for aisle obstructions. Verified mode, not private.",
      endpoint: "http://localhost:4102/v1/jobs",
      capabilities: [cap("vision.aisle-obstruction", ["warehouse.inspection", "warehouse.patrol"])],
      price: { amount: "0.25", token: "USDC", unit: "job" },
      inference: { model: VISION_MODEL, trustMode: "verified" },
      delegation: { allowed: false, maxBudgetShare: 0 },
      serviceVersion: "0.1.0",
    },
    {
      schemaVersion: "1.0",
      agentId: "agent-inspect-ostra",
      ownerWallet: owner,
      displayName: "Ostra Inspection",
      kind: "inspection",
      summary: "Plans a panel inspection and may hire one vision specialist within 40% of its budget.",
      endpoint: "http://localhost:4103/v1/jobs",
      capabilities: [cap("inspection.panel-survey", ["warehouse.inspection"])],
      price: { amount: "1.10", token: "USDC", unit: "job" },
      inference: { model: TEXT_MODEL, trustMode: "private" },
      delegation: { allowed: true, maxBudgetShare: 0.4 },
      serviceVersion: "0.1.0",
    },
    {
      schemaVersion: "1.0",
      agentId: "agent-maint-torque",
      ownerWallet: owner,
      displayName: "Torque Maintenance",
      kind: "maintenance",
      summary: "Reads minimised motor diagnostics after a stop and suggests a cause. Advisory only.",
      endpoint: "http://localhost:4104/v1/jobs",
      capabilities: [cap("maintenance.motor-diagnosis", ["warehouse.inspection", "warehouse.patrol", "indoor.delivery"])],
      price: { amount: "0.80", token: "USDC", unit: "job" },
      inference: { model: TEXT_MODEL, trustMode: "private" },
      delegation: { allowed: false, maxBudgetShare: 0 },
      serviceVersion: "0.1.0",
    },
  ];
}
