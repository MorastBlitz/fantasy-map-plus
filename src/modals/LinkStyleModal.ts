import { App, SuggestModal } from "obsidian";
import type { ResolvedLinkStyle } from "src/links";

const STYLES: { style: ResolvedLinkStyle; label: string; hint: string }[] = [
  { style: "text", label: "Text link", hint: "[Name](obsidian://…)" },
  { style: "icon", label: "Text link with icon", hint: "[📍 Name](obsidian://…)" },
  { style: "preview", label: "Map preview", hint: "Clickable map excerpt" },
];

export class LinkStyleModal extends SuggestModal<(typeof STYLES)[number]> {
  constructor(
    app: App,
    private onChoose: (style: ResolvedLinkStyle) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a link style");
  }

  getSuggestions(query: string): (typeof STYLES)[number][] {
    const lower = query.toLowerCase();
    return STYLES.filter((s) => s.label.toLowerCase().includes(lower));
  }

  renderSuggestion(item: (typeof STYLES)[number], el: HTMLElement): void {
    el.createDiv({ text: item.label });
    el.createEl("small", { text: item.hint, cls: "fantasy-map-suggest-hint" });
  }

  onChooseSuggestion(item: (typeof STYLES)[number]): void {
    this.onChoose(item.style);
  }
}
