import { apiRequest } from "@/api/client";
import type { Idea, ScopeValue } from "@/lib/types";

export interface IdeasResponse {
  ideas: Idea[];
}

export interface StoreIdeaRequest {
  name: string;
  content: string;
  tags?: string[];
  agent_id?: string;
  scope?: ScopeValue;
  links?: string[];
  // Tables-in-Ideas Phase 2.
  parent_idea_id?: string | null;
  properties?: Record<string, unknown> | null;
}

export function listIdeas(params?: {
  root?: string;
  query?: string;
  limit?: number;
  agent_id?: string;
}): Promise<IdeasResponse> {
  const q = new URLSearchParams();
  if (params?.root) q.set("root", params.root);
  if (params?.query) q.set("query", params.query);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.agent_id) q.set("agent_id", params.agent_id);
  const qs = q.toString();
  return apiRequest<IdeasResponse>(`/ideas${qs ? `?${qs}` : ""}`);
}

export function storeIdea(data: StoreIdeaRequest): Promise<{ ok: boolean; id: string }> {
  return apiRequest<{ ok: boolean; id: string }>("/ideas", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateIdea(
  id: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(`/ideas/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteIdea(
  id: string,
): Promise<{ ok: boolean; error?: string; quest_ids?: string[] }> {
  return apiRequest<{ ok: boolean; error?: string; quest_ids?: string[] }>(
    `/ideas/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

// ── Tables-in-Ideas Phase 2 ────────────────────────────────────────────

/** Direct children of an Idea, newest first. */
export function listIdeaChildren(id: string): Promise<IdeasResponse> {
  return apiRequest<IdeasResponse>(`/ideas/${encodeURIComponent(id)}/children`);
}

/**
 * Deep-merge a JSON patch into an Idea's `properties` column.
 * Keys set in `patch` overwrite; keys absent are preserved; explicit
 * `null` removes a key.
 */
export function setIdeaProperties(
  id: string,
  properties: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  return apiRequest<{ ok: boolean; error?: string }>(
    `/ideas/${encodeURIComponent(id)}/properties`,
    {
      method: "PUT",
      body: JSON.stringify(properties),
    },
  );
}
