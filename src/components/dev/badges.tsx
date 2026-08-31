import { Badge } from "@/components/ui/badge";
import {
  LAYER_LABEL,
  OWNER_LABEL,
  type Layer,
  type Owner,
  type Status,
} from "@/lib/dev-spec/types";

/** Confirmed = a settled rule; Open = awaiting an owner (a flag/param, not a guess). */
export function StatusBadge({ status, owner }: { status: Status; owner?: Owner }) {
  if (status === "confirmed") return <Badge variant="muted">Confirmed</Badge>;
  return <Badge variant="dashed">Open{owner ? ` · ${OWNER_LABEL[owner]}` : ""}</Badge>;
}

/** Which layer produces a value: the AI reader vs the deterministic engine. */
export function LayerBadge({ layer }: { layer: Layer }) {
  const short: Record<Layer, string> = {
    llm: "AI reads",
    engine: "Engine",
    both: "AI → Engine",
  };
  return (
    <Badge variant="outline" className="whitespace-nowrap" >
      <span title={LAYER_LABEL[layer]}>{short[layer]}</span>
    </Badge>
  );
}

/** A small hairline chip for an owner (used in the open-questions filters). */
export function OwnerChip({ owner }: { owner: Owner }) {
  return <Badge variant="outline">{OWNER_LABEL[owner]}</Badge>;
}
