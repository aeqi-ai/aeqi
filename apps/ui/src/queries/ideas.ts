import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ideasApi from "@/api/ideas";
import type { Idea } from "@/lib/types";
import { ideaKeys } from "./keys";

const EMPTY_IDEAS: Idea[] = [];

export function useVisibleIdeas(enabled = true) {
  return useQuery({
    queryKey: ideaKeys.visible,
    queryFn: async () => {
      const data = await ideasApi.listIdeas();
      return data.ideas ?? EMPTY_IDEAS;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useAgentIdeas(agentId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ideaKeys.byAgent(agentId ?? ""),
    queryFn: async () => {
      const data = await ideasApi.listIdeas({ agent_id: agentId ?? "" });
      return data.ideas ?? EMPTY_IDEAS;
    },
    enabled: enabled && Boolean(agentId),
    staleTime: 30_000,
  });
}

export function useAgentIdeasCache(agentId: string) {
  const queryClient = useQueryClient();
  const key = useMemo(() => ideaKeys.byAgent(agentId), [agentId]);

  const invalidateIdeas = useCallback(() => {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ideaKeys.visible }),
    ]);
  }, [queryClient, key]);

  const patchIdea = useCallback(
    (id: string, patch: Partial<Idea>) => {
      const applyPatch = (current: Idea[] | undefined) =>
        current?.map((idea) => (idea.id === id ? { ...idea, ...patch } : idea));
      queryClient.setQueryData<Idea[]>(key, applyPatch);
      queryClient.setQueryData<Idea[]>(ideaKeys.visible, applyPatch);
    },
    [queryClient, key],
  );

  const addIdea = useCallback(
    (idea: Idea) => {
      const addToList = (current: Idea[] | undefined) => {
        const existing = current ?? EMPTY_IDEAS;
        if (existing.some((item) => item.id === idea.id)) {
          return existing.map((item) => (item.id === idea.id ? { ...item, ...idea } : item));
        }
        return [idea, ...existing];
      };
      queryClient.setQueryData<Idea[]>(key, addToList);
      queryClient.setQueryData<Idea[]>(ideaKeys.visible, addToList);
    },
    [queryClient, key],
  );

  const removeIdea = useCallback(
    (id: string) => {
      const removeFromList = (current: Idea[] | undefined) =>
        current?.filter((idea) => idea.id !== id);
      queryClient.setQueryData<Idea[]>(key, removeFromList);
      queryClient.setQueryData<Idea[]>(ideaKeys.visible, removeFromList);
    },
    [queryClient, key],
  );

  return { invalidateIdeas, patchIdea, addIdea, removeIdea };
}
