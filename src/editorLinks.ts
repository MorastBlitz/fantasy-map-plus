import { ViewPlugin } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { Keymap, editorLivePreviewField } from "obsidian";
import type { App } from "obsidian";
import { PROTOCOL_ACTION } from "src/links";

const MAP_LINK = new RegExp(
  String.raw`\[(?:[^\]\\]|\\.)*\]\((obsidian://${PROTOCOL_ACTION}\?[^\s)]*)\)`,
  "g",
);

/** Find the map link whose markdown source contains `pos`. */
function findMapLinkAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos);
  for (const match of line.text.matchAll(MAP_LINK)) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to && match[1]) return match[1];
  }
  return null;
}

function parseParams(uri: string): Record<string, string> | null {
  try {
    return Object.fromEntries(new URL(uri).searchParams);
  } catch {
    return null;
  }
}

/** Same targets Obsidian treats as a clickable external link in the editor. */
function isLinkTarget(target: EventTarget | null): target is Element {
  if (!(target instanceof Element)) return false;
  if (target.closest(".external-link")) return true;
  return (
    target.closest(".cm-underline") !== null &&
    target.closest(".cm-link, .cm-url") !== null
  );
}

/**
 * Obsidian does not dispatch `obsidian://` links clicked in the editor,
 * so catch clicks on map links before Obsidian does and handle them here.
 */
export function mapLinkClickHandler(
  app: App,
  onLink: (params: Record<string, string>) => void,
) {
  return ViewPlugin.define((view) => {
    const onClick = (evt: MouseEvent) => {
      if (evt.button !== 0) return;
      const mod = Boolean(Keymap.isModEvent(evt));
      const livePreview = view.state.field(editorLivePreviewField, false);
      // Mirror Obsidian: source mode needs Mod, Shift/Alt extend selections
      if (!livePreview && !mod) return;
      if (!mod && (evt.shiftKey || evt.altKey)) return;
      // A drag that ended on the link selected text, it wasn't a click
      if (!view.state.selection.main.empty) return;
      if (!isLinkTarget(evt.target)) return;

      let pos: number;
      try {
        pos = view.posAtDOM(evt.target);
      } catch {
        return;
      }
      const uri = findMapLinkAt(view, pos);
      const params = uri ? parseParams(uri) : null;
      if (!params) return;
      // Links into another vault are left to Obsidian
      if (params.vault && params.vault !== app.vault.getName()) return;

      evt.preventDefault();
      evt.stopPropagation();
      onLink(params);
    };

    view.dom.addEventListener("click", onClick, { capture: true });
    return {
      destroy: () => {
        view.dom.removeEventListener("click", onClick, { capture: true });
      },
    };
  });
}
