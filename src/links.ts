import type { App } from "obsidian";
import type { LinkStyle, MapConfig, MapFeature } from "src/types";

export const PROTOCOL_ACTION = "fantasy-map";
export const PREVIEW_CODE_BLOCK = "fantasy-map";

/** A concrete link style; "ask" is resolved by prompting the user. */
export type ResolvedLinkStyle = Exclude<LinkStyle, "ask">;

export function buildMapUri(
  app: App,
  mapId: string,
  featureId?: string,
): string {
  const params = new URLSearchParams({
    vault: app.vault.getName(),
    map: mapId,
  });
  if (featureId) params.set("feature", featureId);
  return `obsidian://${PROTOCOL_ACTION}?${params.toString()}`;
}

export function buildMarkdownLink(
  app: App,
  text: string,
  mapId: string,
  featureId?: string,
): string {
  const escaped = text.replace(/([[\]\\])/g, "\\$1");
  return `[${escaped}](${buildMapUri(app, mapId, featureId)})`;
}

export function buildPreviewBlock(mapId: string, featureId?: string): string {
  const lines = ["```" + PREVIEW_CODE_BLOCK, `map: ${mapId}`];
  if (featureId) lines.push(`feature: ${featureId}`);
  lines.push("```");
  return lines.join("\n");
}

export function buildLink(
  app: App,
  style: ResolvedLinkStyle,
  text: string,
  mapId: string,
  featureId?: string,
): string {
  switch (style) {
    case "preview":
      return buildPreviewBlock(mapId, featureId);
    case "icon":
      return buildMarkdownLink(
        app,
        `${featureId ? "📍" : "🗺️"} ${text}`,
        mapId,
        featureId,
      );
    case "text":
      return buildMarkdownLink(app, text, mapId, featureId);
  }
}

/** Find a map by id, falling back to a case-insensitive name match. */
export function resolveMap(
  maps: MapConfig[],
  query: string,
): MapConfig | undefined {
  const lower = query.toLowerCase();
  return (
    maps.find((m) => m.id === query) ??
    maps.find((m) => m.name.toLowerCase() === lower)
  );
}

/** Find a feature by id, falling back to a case-insensitive name match. */
export function resolveFeatureId(
  config: MapConfig,
  query: string,
): string | undefined {
  const features = config.layers.flatMap(
    (l) => l.features as MapFeature[],
  );
  const lower = query.toLowerCase();
  return (
    features.find((f) => f.properties.id === query) ??
    features.find((f) => f.properties.name.toLowerCase() === lower)
  )?.properties.id;
}
