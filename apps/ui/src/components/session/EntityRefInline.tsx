import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import { type EntityPrimitive, type EntityRef } from "./types";

const TAB_BY_PRIMITIVE: Record<EntityPrimitive, string> = {
  agent: "agents",
  quest: "quests",
  idea: "ideas",
  event: "events",
};

/**
 * Inline mention for an AEQI primitive. Resolves via backend-supplied
 * entityId first, falling back to daemon-store name lookup for agent/quest.
 * Renders unresolved refs as plain text — no link, no chip.
 */
export default function EntityRefInline({ ref }: { ref: EntityRef }) {
  const { entityId } = useNav();
  const entities = useDaemonStore((s) => s.entities);
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests);

  const resolved = useMemo(() => {
    if (ref.entityId) return ref.entityId;
    const lc = ref.label.trim().toLowerCase();
    if (!lc) return "";
    if (ref.primitive === "agent") {
      return agents.find((a) => (a.name ?? "").toLowerCase() === lc)?.id ?? "";
    }
    if (ref.primitive === "quest") {
      return quests.find((q) => (q.idea?.name ?? "").toLowerCase() === lc)?.id ?? "";
    }
    return "";
  }, [ref.entityId, ref.label, ref.primitive, agents, quests]);

  if (!entityId || !resolved) {
    return <span className="asv-entity-ref asv-entity-ref--unresolved">{ref.label}</span>;
  }

  const href = entityPathFromId(
    entities,
    entityId,
    TAB_BY_PRIMITIVE[ref.primitive],
    encodeURIComponent(resolved),
  );
  const role = ref.primitive[0].toUpperCase() + ref.primitive.slice(1);
  return (
    <Link
      to={href}
      className={`asv-entity-ref asv-entity-ref--${ref.primitive}`}
      title={`${role}: ${ref.label}${ref.status ? ` (${ref.status})` : ""}`}
    >
      {ref.label}
    </Link>
  );
}
