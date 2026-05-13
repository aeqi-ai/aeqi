import type { BlueprintCategory } from "@/lib/types";

export type Kind = "companies" | "agents" | "events" | "quests" | "ideas";
export type Sort = "recent" | "alpha-asc" | "alpha-desc" | "complexity";
export type View = "grid" | "list";

export const KIND_TABS: { id: Kind; label: string }[] = [
  { id: "companies", label: "Companies" },
  { id: "agents", label: "Agents" },
  { id: "events", label: "Events" },
  { id: "quests", label: "Quests" },
  { id: "ideas", label: "Ideas" },
];
export const KIND_IDS = KIND_TABS.map((t) => t.id);

export const SORT_LABELS: Record<Sort, string> = {
  recent: "Recently added",
  "alpha-asc": "Name (A→Z)",
  "alpha-desc": "Name (Z→A)",
  complexity: "Complexity",
};
export const SORT_ORDER: Sort[] = ["recent", "alpha-asc", "alpha-desc", "complexity"];
export const SORT_VALUES = new Set<Sort>(SORT_ORDER);

export const VIEW_LABELS: Record<View, string> = { grid: "Grid", list: "List" };
export const VIEW_ORDER: View[] = ["grid", "list"];
export const VIEW_VALUES = new Set<View>(VIEW_ORDER);

/** Display order for category sections. Foundation always shown (even empty). */
export const CATEGORY_ORDER: BlueprintCategory[] = ["company", "foundation", "fund"];

export const CATEGORY_LABELS: Record<BlueprintCategory, string> = {
  company: "Company",
  foundation: "Foundation",
  fund: "Fund",
};

export const CATEGORY_DESCRIPTIONS: Record<BlueprintCategory, string> = {
  company: "Smart account with role-based governance",
  foundation: "Public-good org with grant flows",
  fund: "LP cap table for investment vehicles",
};

/** Set of valid category param values. */
export const CATEGORY_VALUES = new Set<BlueprintCategory>(CATEGORY_ORDER);
