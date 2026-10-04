import { App, PluginSettingTab, Setting } from "obsidian";
import type FantasyMapPlugin from "src/main";
import type { LinkStyle } from "src/types";

const LINK_STYLE_OPTIONS: Record<LinkStyle, string> = {
  ask: "Ask each time",
  text: "Text link",
  icon: "Text link with icon",
  preview: "Map preview",
};

export class FantasyMapSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: FantasyMapPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Link style")
      .setDesc("How links to maps and features are inserted into notes.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(LINK_STYLE_OPTIONS)
          .setValue(this.plugin.settings.linkStyle)
          .onChange(async (value) => {
            this.plugin.settings.linkStyle = value as LinkStyle;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Preview height")
      .setDesc(
        "Default height of map previews in pixels. Override per preview with a \"height:\" line.",
      )
      .addText((text) =>
        text
          .setPlaceholder("300")
          .setValue(String(this.plugin.settings.previewHeight))
          .onChange(async (value) => {
            const height = Number(value);
            if (!Number.isFinite(height) || height <= 0) return;
            this.plugin.settings.previewHeight = height;
            await this.plugin.saveSettings();
          }),
      );
  }
}
