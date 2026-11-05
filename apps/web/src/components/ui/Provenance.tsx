import { ARKIV_EXPLORER, shortKey, type Provenance } from "@/lib/api";

/** Where a value came from: an Arkiv entity or a 0G Router response. */
export function ProvenanceBadge({ provenance, entityKey }: { provenance: Provenance; entityKey?: string }) {
  if (provenance === "ARKIV")
    return (
      <span className="badge badge--real" title={entityKey}>
        <span className="badge__dot" aria-hidden="true" />
        Arkiv {entityKey ? <span className="mono">{shortKey(entityKey)}</span> : null}
      </span>
    );
  if (provenance === "ZEROG_ROUTER")
    return (
      <span className="badge badge--real">
        <span className="badge__dot" aria-hidden="true" />
        0G Router
      </span>
    );
  return null;
}

/** Verified link (Arkiv MCP network_status): the Rabdi data explorer. Search the entity key there. */
export const ARKIV_DATA_EXPLORER = `${ARKIV_EXPLORER}/entity-explorer`;
