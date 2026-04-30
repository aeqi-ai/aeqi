import type { Blueprint } from "@/lib/types";

interface BlueprintSeedCountsProps {
  template: Blueprint;
}

/**
 * Compact summary of what a Blueprint seeds — placed directly under the
 * hero so the reader gets information scent before the org chart. Each
 * pill is a count + label. The role count comes from declared
 * `seed_roles` when present (the canonical structure), falling back to
 * `seed_agents` for un-ported blueprints. Default-agent count always
 * reflects the seeded identities (the workforce). 1:1 today with roles;
 * may diverge once multi-instance roles or bench agents land.
 */
export function BlueprintSeedCounts({ template }: BlueprintSeedCountsProps) {
  const declaredRoles = template.seed_roles?.length ?? 0;
  const seedAgents = template.seed_agents?.length ?? 0;
  const pills: Array<[label: string, value: number]> = [
    ["Roles", declaredRoles > 0 ? declaredRoles : seedAgents],
    ["Default agents", seedAgents],
    ["Quests", template.seed_quests?.length ?? 0],
    ["Ideas", template.seed_ideas?.length ?? 0],
    ["Events", template.seed_events?.length ?? 0],
  ];
  return (
    <ul className="bp-summary-pills" role="list" aria-label="What this blueprint seeds">
      {pills.map(([label, value]) => (
        <li key={label} className="bp-summary-pill">
          <span className="bp-summary-pill-value">{value}</span>
          <span className="bp-summary-pill-label">{label}</span>
        </li>
      ))}
    </ul>
  );
}
