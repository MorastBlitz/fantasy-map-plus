import { MarkdownRenderChild, setIcon } from "obsidian";
import type FantasyMapPlugin from "src/main";
import type { MapConfig, MapFeature } from "src/types";
import { DEFAULT_MARKER_COLOR } from "src/config";
import { resolveFeatureId, resolveMap } from "src/links";
import { getImageDimensions, loadImageAsBlobUrl } from "src/map/image";

interface PreviewOptions {
  map?: string;
  feature?: string;
  height?: number;
  view?: string;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseOptions(source: string): PreviewOptions {
  const opts: PreviewOptions = {};
  for (const line of source.split("\n")) {
    const match = /^\s*(\w+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (!key || !value) continue;
    if (key === "map" || key === "feature" || key === "view") opts[key] = value;
    else if (key === "height" && Number(value) > 0) opts.height = Number(value);
  }
  return opts;
}

/** Feature geometry as image pixel coordinates (origin top-left). */
function toPixels(feature: MapFeature, imageHeight: number): [number, number][] {
  const toPx = ([x, y]: number[]): [number, number] => [
    x ?? 0,
    imageHeight - (y ?? 0),
  ];
  if (feature.geometry.type === "Point") {
    return [toPx(feature.geometry.coordinates)];
  }
  return (feature.geometry.coordinates[0] ?? []).map(toPx);
}

/** A crop around the given points, clamped to the image. */
function cropAround(
  points: [number, number][],
  width: number,
  height: number,
): ViewBox {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // At least 40% of the image, or the feature's extent plus padding
  const w = Math.min(width, Math.max(width * 0.4, (maxX - minX) * 2));
  const h = Math.min(height, Math.max(height * 0.4, (maxY - minY) * 2));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    x: Math.min(Math.max(cx - w / 2, 0), width - w),
    y: Math.min(Math.max(cy - h / 2, 0), height - h),
    w,
    h,
  };
}

class MapPreview extends MarkdownRenderChild {
  private imageUrl: string | null = null;

  constructor(
    containerEl: HTMLElement,
    private plugin: FantasyMapPlugin,
    private opts: PreviewOptions,
  ) {
    super(containerEl);
  }

  onload(): void {
    void this.render();
  }

  onunload(): void {
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
  }

  private showError(message: string): void {
    this.containerEl.empty();
    this.containerEl.createEl("p", { text: message, cls: "fantasy-map-error" });
  }

  private async render(): Promise<void> {
    const { opts, plugin } = this;
    if (!opts.map) {
      this.showError("Map preview: missing \"map:\" line");
      return;
    }
    const config = resolveMap(plugin.settings.maps, opts.map);
    if (!config) {
      this.showError(`Map preview: map "${opts.map}" not found`);
      return;
    }
    const feature = opts.feature ? this.findFeature(config, opts.feature) : undefined;
    if (opts.feature && !feature) {
      this.showError(`Map preview: feature "${opts.feature}" not found`);
      return;
    }

    try {
      this.imageUrl = await loadImageAsBlobUrl(plugin.app, config.mapImagePath);
      const { width, height } = await getImageDimensions(this.imageUrl);
      this.draw(config, feature, width, height);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.showError(`Map preview: ${message}`);
    }
  }

  private findFeature(config: MapConfig, query: string): MapFeature | undefined {
    const id = resolveFeatureId(config, query);
    return config.layers
      .flatMap((l) => l.features as MapFeature[])
      .find((f) => f.properties.id === id);
  }

  private draw(
    config: MapConfig,
    feature: MapFeature | undefined,
    width: number,
    height: number,
  ): void {
    const el = this.containerEl;
    el.empty();
    el.addClass("fantasy-map-preview");
    el.setAttr("role", "link");
    el.setAttr("tabindex", "0");
    el.setAttr("aria-label", `Open ${feature?.properties.name ?? config.name}`);

    const open = (): void => {
      void this.plugin.openMap(config.id, feature?.properties.id);
    };
    this.registerDomEvent(el, "click", open);
    this.registerDomEvent(el, "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    const points = feature ? toPixels(feature, height) : [];
    const box: ViewBox =
      feature && this.opts.view !== "full"
        ? cropAround(points, width, height)
        : { x: 0, y: 0, w: width, h: height };

    const svg = el.createSvg("svg", {
      cls: "fantasy-map-preview-image",
      attr: {
        viewBox: `${String(box.x)} ${String(box.y)} ${String(box.w)} ${String(box.h)}`,
        preserveAspectRatio: "xMidYMid slice",
        height: String(this.opts.height ?? this.plugin.settings.previewHeight),
      },
    });
    svg.createSvg("image", {
      attr: { href: this.imageUrl ?? "", width, height },
    });

    if (feature) {
      const color = feature.properties.color || DEFAULT_MARKER_COLOR;
      const unit = Math.max(box.w, box.h) / 100;
      if (feature.geometry.type === "Point") {
        const [cx, cy] = points[0] ?? [0, 0];
        svg.createSvg("circle", {
          cls: "fantasy-map-preview-marker",
          attr: { cx, cy, r: unit * 1.6, fill: color, "stroke-width": unit * 0.6 },
        });
      } else {
        svg.createSvg("polygon", {
          cls: "fantasy-map-preview-region",
          attr: {
            points: points.map((p) => p.join(",")).join(" "),
            fill: color,
            stroke: color,
            "stroke-width": unit * 0.4,
          },
        });
      }
    }

    const caption = el.createDiv({ cls: "fantasy-map-preview-caption" });
    setIcon(caption.createSpan(), feature ? "map-pin" : "map");
    caption.createSpan({
      text: feature
        ? `${feature.properties.name} · ${config.name}`
        : config.name,
    });
  }
}

export function registerMapPreview(plugin: FantasyMapPlugin, language: string): void {
  plugin.registerMarkdownCodeBlockProcessor(language, (source, el, ctx) => {
    ctx.addChild(new MapPreview(el, plugin, parseOptions(source)));
  });
}
