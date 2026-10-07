import { Menu, Notice, Plugin, TAbstractFile } from "obsidian";
import type { Editor } from "obsidian";
import * as v from "valibot";
import { FantasyMapView, FANTASY_MAP_VIEW } from "./map/FantasyMapView";
import {
  MapPickerModal,
  CreateMapModal,
  DeleteConfirmModal,
  FeatureSuggestModal,
  LinkStyleModal,
} from "./modals";
import { DEFAULT_SETTINGS } from "./types";
import type {
  FantasyMapSettings,
  MapConfig,
  MapFeature,
  ObsidianApp,
} from "./types";
import { FantasyMapSettingsSchema } from "./schemas";
import {
  PREVIEW_CODE_BLOCK,
  PROTOCOL_ACTION,
  buildLink,
  resolveFeatureId,
  resolveMap,
} from "./links";
import type { ResolvedLinkStyle } from "./links";
import { mapLinkClickHandler } from "./editorLinks";
import { registerMapPreview } from "./preview";
import { FantasyMapSettingTab } from "./settings";

export default class FantasyMapPlugin extends Plugin {
  settings: FantasyMapSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      FANTASY_MAP_VIEW,
      (leaf) => new FantasyMapView(leaf, this),
    );

    this.addSettingTab(new FantasyMapSettingTab(this.app, this));
    registerMapPreview(this, PREVIEW_CODE_BLOCK);

    this.addRibbonIcon("map", "Fantasy map", (evt) => {
      this.showRibbonMenu(evt);
    });

    this.addCommand({
      id: "open-map",
      name: "Open map",
      callback: () => {
        this.openMapPicker();
      },
    });

    this.addCommand({
      id: "create-new-map",
      name: "Create new map",
      callback: () => {
        this.openCreateMapModal();
      },
    });

    this.addCommand({
      id: "delete-map",
      name: "Delete map",
      callback: () => {
        this.openDeleteMapPicker();
      },
    });

    this.addCommand({
      id: "insert-map-link",
      name: "Insert link to map",
      editorCallback: (editor) => {
        this.openInsertLinkPicker(editor);
      },
    });

    this.addCommand({
      id: "copy-map-link",
      name: "Copy link to current map",
      checkCallback: (checking) => {
        const config = this.getCurrentMapConfig();
        if (!config) return false;
        if (!checking) {
          this.copyLink(config.name || config.id, config.id);
        }
        return true;
      },
    });

    this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (params) => {
      this.handleProtocolLink(params);
    });
    this.registerEditorExtension(
      mapLinkClickHandler(this.app, (params) => {
        this.handleProtocolLink(params);
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.handleVaultRename(file, oldPath);
      }),
    );
  }

  private showRibbonMenu(evt: MouseEvent): void {
    const editor = this.app.workspace.activeEditor?.editor;
    const current = this.getCurrentMapConfig();
    const hasMaps = this.settings.maps.length > 0;

    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Open map")
        .setIcon("map")
        .onClick(() => this.openMapPicker()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Create new map")
        .setIcon("plus")
        .onClick(() => this.openCreateMapModal()),
    );
    menu.addItem((item) =>
      item
        .setTitle("Delete map")
        .setIcon("trash-2")
        .setDisabled(!hasMaps)
        .onClick(() => this.openDeleteMapPicker()),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Insert link to map")
        .setIcon("link")
        .setDisabled(!editor || !hasMaps)
        .onClick(() => {
          if (editor) this.openInsertLinkPicker(editor);
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle(
          current
            ? `Copy link to "${current.name || current.id}"`
            : "Copy link to current map",
        )
        .setIcon("copy")
        .setDisabled(!current)
        .onClick(() => {
          if (current) this.copyLink(current.name || current.id, current.id);
        }),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Settings")
        .setIcon("settings")
        .onClick(() => this.openSettings()),
    );
    menu.showAtMouseEvent(evt);
  }

  private openSettings(): void {
    const setting = (this.app as ObsidianApp).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  /** The map in the active view, or else the most recently used map view. */
  private getCurrentMapConfig(): MapConfig | undefined {
    const view =
      this.app.workspace.getActiveViewOfType(FantasyMapView) ??
      (this.app.workspace.getLeavesOfType(FANTASY_MAP_VIEW)[0]?.view as
        | FantasyMapView
        | undefined);
    return this.settings.maps.find((m) => m.id === view?.mapId);
  }

  private handleProtocolLink(params: Record<string, string>): void {
    const mapQuery = params.map;
    if (!mapQuery) {
      new Notice("Map link is missing a map parameter");
      return;
    }
    const config = resolveMap(this.settings.maps, mapQuery);
    if (!config) {
      new Notice(`Map "${mapQuery}" not found`);
      return;
    }
    let featureId: string | undefined;
    if (params.feature) {
      featureId = resolveFeatureId(config, params.feature);
      if (!featureId) {
        new Notice(`Feature "${params.feature}" not found`);
      }
    }
    void this.openMap(config.id, featureId);
  }

  /** Resolve the configured link style, prompting when set to "ask". */
  private withLinkStyle(cb: (style: ResolvedLinkStyle) => void): void {
    const style = this.settings.linkStyle;
    if (style === "ask") new LinkStyleModal(this.app, cb).open();
    else cb(style);
  }

  copyLink(text: string, mapId: string, featureId?: string): void {
    this.withLinkStyle((style) => {
      void navigator.clipboard
        .writeText(buildLink(this.app, style, text, mapId, featureId))
        .then(() => new Notice("Map link copied to clipboard"));
    });
  }

  private openInsertLinkPicker(editor: Editor): void {
    const selection = editor.getSelection();
    new MapPickerModal(this.app, this.settings.maps, (map) => {
      const features = map.layers
        .flatMap((l) => l.features as MapFeature[])
        .map((f) => ({ id: f.properties.id, name: f.properties.name }));
      const insert = (text: string, featureId?: string): void => {
        this.withLinkStyle((style) => {
          let link = buildLink(
            this.app,
            style,
            selection || text,
            map.id,
            featureId,
          );
          // A preview is a code block and must sit on its own lines
          if (style === "preview") {
            const prefix = editor.getCursor("from").ch > 0 ? "\n" : "";
            link = `${prefix}${link}\n`;
          }
          editor.replaceSelection(link);
        });
      };
      if (!features.length) {
        insert(map.name || map.id);
        return;
      }
      new FeatureSuggestModal(
        this.app,
        [{ id: "", name: `Whole map: ${map.name || map.id}` }, ...features],
        (feature) => {
          if (feature.id) insert(feature.name, feature.id);
          else insert(map.name || map.id);
        },
      ).open();
    }).open();
  }

  private handleVaultRename(file: TAbstractFile, oldPath: string): void {
    const newPath = file.path;
    if (!oldPath || newPath === oldPath) return;

    const stripMd = (p: string): string =>
      p.endsWith(".md") ? p.slice(0, -3) : p;
    const oldNote = stripMd(oldPath);
    const newNote = stripMd(newPath);

    const rename = (path: string, oldP: string, newP: string): string => {
      if (path === oldP) return newP;
      if (path.startsWith(oldP + "/")) return newP + path.slice(oldP.length);
      return path;
    };

    let changed = false;
    for (const map of this.settings.maps) {
      const newImg = rename(map.mapImagePath, oldPath, newPath);
      if (newImg !== map.mapImagePath) {
        map.mapImagePath = newImg;
        changed = true;
      }
      for (const layer of map.layers) {
        for (const feature of layer.features) {
          const props = feature.properties;
          if (props.note) {
            const nn = rename(props.note, oldNote, newNote);
            if (nn !== props.note) {
              props.note = nn;
              changed = true;
            }
          }
          if (props.notes) {
            for (let i = 0; i < props.notes.length; i++) {
              const cur = props.notes[i];
              if (!cur) continue;
              const nn = rename(cur, oldNote, newNote);
              if (nn !== cur) {
                props.notes[i] = nn;
                changed = true;
              }
            }
          }
        }
      }
    }

    if (changed) void this.saveSettings();
  }

  private openCreateMapModal(): void {
    new CreateMapModal(this.app, (name: string, imagePath: string) => {
      const newMap = {
        id: window.crypto.randomUUID(),
        name,
        mapImagePath: imagePath,
        layers: [],
      };
      this.settings.maps.push(newMap);
      void this.saveSettings().then(() => this.openMap(newMap.id));
    }).open();
  }

  private openDeleteMapPicker(): void {
    const { maps } = this.settings;
    if (!maps.length) return;

    const parentMap = new Map(maps.map((m) => [m.id, m.name || m.id]));
    const displayMaps = maps.map((m) => ({
      ...m,
      displayName: m.parentMapId
        ? `↳ ${m.name || m.id} (in ${parentMap.get(m.parentMapId) ?? m.parentMapId})`
        : m.name || m.id,
    }));

    new MapPickerModal(this.app, displayMaps, (map) => {
      const childCount = maps.filter((m) => m.parentMapId === map.id).length;
      const description =
        childCount > 0
          ? `This will also delete ${String(childCount)} linked local map${childCount > 1 ? "s" : ""}. This cannot be undone.`
          : "This cannot be undone.";

      new DeleteConfirmModal(
        this.app,
        `Delete "${map.name || map.id}"?`,
        description,
        () => {
          void this.deleteMap(map.id);
        },
      ).open();
    }).open();
  }

  private async deleteMap(mapId: string): Promise<void> {
    const idsToRemove = new Set<string>();
    idsToRemove.add(mapId);
    // Collect all descendants
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of this.settings.maps) {
        if (
          m.parentMapId &&
          idsToRemove.has(m.parentMapId) &&
          !idsToRemove.has(m.id)
        ) {
          idsToRemove.add(m.id);
          changed = true;
        }
      }
    }

    this.settings.maps = this.settings.maps.filter(
      (m) => !idsToRemove.has(m.id),
    );
    await this.saveSettings();

    // Close the view if it's showing a deleted map
    for (const leaf of this.app.workspace.getLeavesOfType(FANTASY_MAP_VIEW)) {
      const view = leaf.view as FantasyMapView;
      if (view.mapId && idsToRemove.has(view.mapId)) {
        leaf.detach();
      }
    }
  }

  private openMapPicker(): void {
    const { maps } = this.settings;

    // Build display list: local maps shown with parent context
    const parentMap = new Map(maps.map((m) => [m.id, m.name || m.id]));
    const displayMaps = maps.map((m) => ({
      ...m,
      displayName: m.parentMapId
        ? `↳ ${m.name || m.id} (in ${parentMap.get(m.parentMapId) ?? m.parentMapId})`
        : m.name || m.id,
    }));

    new MapPickerModal(
      this.app,
      displayMaps,
      (map) => {
        void this.openMap(map.id);
      },
      () => {
        this.openCreateMapModal();
      },
    ).open();
  }

  async openMap(mapId: string, featureId?: string): Promise<void> {
    const { workspace } = this.app;

    // Reuse existing fantasy map leaf, or create one if none exists
    const leaves = workspace.getLeavesOfType(FANTASY_MAP_VIEW);
    const leaf = leaves[0] ?? workspace.getLeaf("tab");

    // Same map already loaded: just bring it forward, keeping zoom/position
    const view = leaf.view instanceof FantasyMapView ? leaf.view : null;
    if (view?.isShowing(mapId)) {
      await workspace.revealLeaf(leaf);
      if (featureId) view.focusFeature(featureId);
      return;
    }

    // Reveal before loading so Leaflet measures a visible container
    await workspace.revealLeaf(leaf);
    await leaf.setViewState({
      type: FANTASY_MAP_VIEW,
      active: true,
      state: { mapId, featureId },
    });
  }

  async loadSettings(): Promise<void> {
    const data: unknown = await this.loadData();
    if (!data) return;

    const result = v.safeParse(FantasyMapSettingsSchema, data);
    if (result.success) {
      this.settings = result.output;
    } else {
      console.warn(
        "Fantasy Map: Invalid settings data, using defaults",
        result.issues,
      );
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
