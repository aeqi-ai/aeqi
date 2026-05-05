import type { SingleBlueprint, BlueprintSeedAgent, BlueprintSeedRole } from "@/lib/types";

interface BlueprintTreePreviewProps {
  template: SingleBlueprint;
}

/**
 * Org-chart preview for a Blueprint. Renders as a layered DAG that
 * mirrors the post-spawn shape (`EntityRolesTab`'s chart view) — what
 * the user picks IS what they get. Wrapped in a bordered card with a
 * header so it reads as an intentional product surface, not a sketch.
 *
 * Each card is a ROLE (the structural slot); the occupant line names
 * the default agent that fills it (or "vacant"). Roles are tagged by
 * category (leadership / engineering / ops-support) via a title-keyword
 * heuristic so the user can scan the team's makeup at a glance — the
 * three buckets get distinct visual weights without inventing new
 * tokens (border tone + category eyebrow chip).
 *
 * Reads declared `seed_roles` + `seed_role_edges` when present; falls
 * back to the implicit root → flat seed_agents shape otherwise.
 */
export function BlueprintTreePreview({ template }: BlueprintTreePreviewProps) {
  const rootName = template.root?.name ?? template.name;
  const rootColor = template.root?.color ?? undefined;
  const declared = (template.seed_roles ?? []).length > 0;

  const layers = declared
    ? computeDeclaredLayers(template, rootName)
    : computeImplicitLayers(template.seed_agents ?? [], rootName);

  const seedAgents = template.seed_agents ?? [];
  const agentByName = new Map<string, BlueprintSeedAgent>();
  for (const a of seedAgents) agentByName.set(a.name, a);

  return (
    <section className="bp-orgchart-card" aria-label="Org chart">
      <header className="bp-orgchart-card-head">
        <h2 className="bp-orgchart-card-title">Org chart</h2>
        <p className="bp-orgchart-card-sub">Roles ship pre-filled with default agents.</p>
      </header>
      <div className="bp-orgchart" aria-hidden="true">
        {layers.map((layer, layerIdx) => {
          const showConnector = layerIdx > 0 && layer.length > 0;
          return (
            <div key={layerIdx} className="bp-orgchart-layer">
              {showConnector && <ConnectorRow count={layer.length} />}
              <div className="bp-orgchart-row">
                {layer.map((role, i) => {
                  const isRoot =
                    role.default_occupant_agent === "root" ||
                    role.default_occupant_agent === rootName;
                  const occupantName = role.default_occupant_agent ?? null;
                  const occupantAgent = occupantName ? agentByName.get(occupantName) : undefined;
                  const subtitle = occupantName ? (isRoot ? rootName : occupantName) : "vacant";
                  const category = isRoot ? "leadership" : categorizeRole(role.title);
                  const swatchColor = isRoot ? rootColor : (occupantAgent?.color ?? undefined);
                  return (
                    <article
                      key={role.key}
                      className={`bp-role-card bp-role-card--${category}${
                        isRoot ? " bp-role-card--root" : ""
                      }`}
                      style={{
                        animationDelay: `${50 + (layerIdx * 80 + i * 50)}ms`,
                      }}
                      title={occupantAgent?.system_prompt || occupantAgent?.tagline || role.title}
                    >
                      <span className="bp-role-eyebrow">{categoryLabel(category)}</span>
                      <span className="bp-role-title">{role.title}</span>
                      <span className="bp-role-occupant">
                        {swatchColor && !isRoot && (
                          <span
                            className="bp-role-occupant-dot"
                            style={{ background: swatchColor }}
                            aria-hidden="true"
                          />
                        )}
                        {subtitle}
                      </span>
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** SVG bus connecting one layer's parent area down to N children below.
 *  Centered T-shape: vertical drop from the row above, horizontal
 *  spine across the children's centerline, vertical risers up to each
 *  child. Cheap, layout-agnostic — children sit on a flex row with
 *  even justify-content: space-evenly, so the percentages line up. */
function ConnectorRow({ count }: { count: number }) {
  if (count === 0) return null;
  const positions: number[] = Array.from({ length: count }, (_, i) =>
    count === 1 ? 50 : 8 + (i * 84) / (count - 1),
  );
  const left = positions[0];
  const right = positions[positions.length - 1];
  return (
    <svg
      className="bp-orgchart-connector"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* Vertical drop from above into the spine */}
      <line x1="50" y1="0" x2="50" y2="12" />
      {/* Horizontal spine */}
      <line x1={left} y1="12" x2={right} y2="12" />
      {/* Risers down to each child */}
      {positions.map((x, i) => (
        <line key={i} x1={x} y1="12" x2={x} y2="24" />
      ))}
    </svg>
  );
}

/* ── Layout helpers ──────────────────────────────────── */

function computeDeclaredLayers(template: SingleBlueprint, rootName: string): BlueprintSeedRole[][] {
  const roles = template.seed_roles ?? [];
  const edges = template.seed_role_edges ?? [];
  const incoming = new Map<string, string[]>();
  for (const r of roles) incoming.set(r.key, []);
  for (const e of edges) {
    if (!incoming.has(e.child)) continue;
    incoming.get(e.child)!.push(e.parent);
  }
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = incoming.get(id) ?? [];
    if (parents.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    let d = 0;
    for (const p of parents) d = Math.max(d, visit(p, seen) + 1);
    depth.set(id, d);
    return d;
  };
  for (const r of roles) visit(r.key, new Set());
  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  const layers: BlueprintSeedRole[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const r of roles) layers[depth.get(r.key) ?? 0].push(r);
  void rootName; // referenced by the renderer through props, not here
  return layers;
}

function computeImplicitLayers(
  seeds: BlueprintSeedAgent[],
  rootName: string,
): BlueprintSeedRole[][] {
  const root: BlueprintSeedRole = {
    key: "root",
    title: rootName,
    default_occupant_agent: "root",
  };
  if (seeds.length === 0) return [[root]];
  const children: BlueprintSeedRole[] = seeds.map((seed, i) => ({
    key: `seed-${i}`,
    title: seed.role || seed.name,
    default_occupant_agent: seed.name,
  }));
  return [[root], children];
}

/* ── Category heuristic ──────────────────────────────── */

type RoleCategory = "leadership" | "engineering" | "ops";

const LEADERSHIP_KEYWORDS = [
  "founder",
  "ceo",
  "cto",
  "cfo",
  "coo",
  "chief",
  "head",
  "lead",
  "director",
  "principal",
  "owner",
  "partner",
  "manager",
  "managing",
];

const ENGINEERING_KEYWORDS = ["engineer", "developer", "architect", "dev"];

function categorizeRole(title: string): RoleCategory {
  const t = title.toLowerCase();
  // Engineering matches first — "Designer-Engineer" should hit engineering,
  // not get caught by a "designer" → ops match later if it grows.
  for (const k of ENGINEERING_KEYWORDS) {
    if (t.includes(k)) return "engineering";
  }
  for (const k of LEADERSHIP_KEYWORDS) {
    // word-boundary check so "Operator" doesn't match "lead" via "lEAD"er
    // (substring would match anyway, but anchoring keeps the rule narrow).
    if (new RegExp(`\\b${k}\\b`).test(t)) return "leadership";
  }
  return "ops";
}

function categoryLabel(c: RoleCategory): string {
  if (c === "leadership") return "lead";
  if (c === "engineering") return "eng";
  return "ops";
}
