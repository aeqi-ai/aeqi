/**
 * Curated Blueprint slugs surfaced as the "Recommended" row in
 * `BlueprintLaunchPicker` (`+ New agent` modal) and the launch defaults.
 * Order matters — first slug is the most-promoted. Edit this list to
 * change what users see at the top of the picker; the catalog itself
 * is the source of truth, so unknown slugs are silently skipped.
 */
export const RECOMMENDED_BLUEPRINTS: readonly string[] = [
  "aeqi",
  "solo-founder",
  "tech-studio",
  "community",
];
