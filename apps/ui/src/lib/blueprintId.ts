import type { Blueprint } from "@/lib/types";

export function blueprintId(blueprint: Blueprint): string {
  if ("id" in blueprint && blueprint.id) return blueprint.id;
  if ("slug" in blueprint && blueprint.slug) return blueprint.slug;
  return "";
}
