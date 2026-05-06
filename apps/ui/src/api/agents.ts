import { apiRequest } from "@/api/client";
import type { Agent } from "@/lib/types";

export interface AgentsResponse {
  agents?: Agent[];
}

export function listScopedAgents(params?: { root?: boolean }): Promise<AgentsResponse> {
  return apiRequest<AgentsResponse>(params?.root ? "/agents?root=true" : "/agents");
}

export function buildAgentDirectory(
  _entitiesData: unknown,
  agentsData: AgentsResponse | null | undefined,
): Agent[] {
  const agents = Array.isArray(agentsData?.agents) ? agentsData.agents : [];
  const byId = new Map<string, Agent>();
  for (const agent of agents) {
    if (agent.id) byId.set(agent.id, agent);
  }
  return Array.from(byId.values());
}

export async function listAgentDirectory(): Promise<Agent[]> {
  const agentsData = await listScopedAgents().catch(() => null);
  return buildAgentDirectory(null, agentsData);
}
