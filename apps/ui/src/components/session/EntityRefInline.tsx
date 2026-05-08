import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import { type EntityRef } from "./types";

/**
 * Inline mention for an AEQI primitive (agent / quest / idea / event).
 *
 * Resolution order:
 *  1. Backend-supplied `entityId` — preferred; renders as a Link.
 *  2. Daemon-store name lookup by `label` for agent / quest. Idea + event
 *     resolution by name only fires when the canonical surface for that
 *     primitive is loaded; otherwise we fall through to plain text.
 *  3. No match — falls back to plain label text (no link, no chip).
 *
 * Visual treatment is intentionally light: a subtle inline link with the
 * primitive's role conveyed via title attribute. No chips, no badges,
 * no decorative chrome — those can be layered later via the same data.
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
  }, [ref, agents, quests]);

  const tab =
    ref.primitive === "agent"
      ? "agents"
      : ref.primitive === "quest"
        ? "quests"
        : ref.primitive === "idea"
          ? "ideas"
          : "events";

  if (!entityId || !resolved) {
    return <span className="asv-entity-ref asv-entity-ref--unresolved">{ref.label}</span>;
  }

  const href = entityPathFromId(entities, entityId, tab, encodeURIComponent(resolved));
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
