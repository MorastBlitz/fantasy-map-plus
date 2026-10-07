# Deep-link (`obsidian://fantasy-map`) investigation — findings

Status: **open**. The plugin's deep-link logic was verified correct; the remaining
failure is that Obsidian does **not** dispatch `obsidian://` links that are clicked
while a note is in **Live Preview (edit) mode**. Reading view works.

All temporary diagnostics and the two experimental fixes I tried have been
**reverted**; the repo is back at HEAD (only the pre-existing `.gitignore` /
`manifest.json` local modifications remain), and `main.js` was rebuilt from HEAD.

---

## 1. Reported symptom (German, original)

> der link hier funktioniert nicht, erst wenn ich einen anderen map link öffne funktioniert dieser auch.

Link used:

```
[📍 Zum Rastplatz des Holzfällers](obsidian://fantasy-map?vault=Obsidian&map=d0ec2f93-aa46-40ad-a9b4-c37e1d2cda47&feature=cc0ba1fd-adcf-4a7b-af58-8ed634816924)
```

Clarified behaviour:

- Clicking the link → **nothing happens**.
- Reading mode works.
- Live Preview (edit mode): **no effect, no console output at all**.

## 2. Environment / data (from the user's machine)

- Vault root: `/Users/thomas/Library/CloudStorage/Nextcloud-nextcloud.netz-co.de-superuser/Obsidian`
  - `obsidian.json` registers this path with name derived from the folder → **"Obsidian"**, which **matches** the link's `vault=Obsidian` (so this is *not* a vault-mismatch / URI-reload case).
- Note: `…/Obsidian/Daggerheart/Dullis/Abenteuer/01 - Das verschollene Archiv des Kartografen/02 - Glyntworth.md`
  - Contains **three different link constructs**:
    1. A `fantasy-map` **preview code block** at the very top — **only `map:`, no `feature:`**:
       ```
       ```fantasy-map
       map: d0ec2f93-aa46-40ad-a9b4-c37e1d2cda47
       ```
       ```
    2. Small **📍 markdown links** `[📍 …](obsidian://fantasy-map?vault=Obsidian&map=…&feature=…)` (Oswin, Ebenholzdrache, Schreinerei, Wache).
    3. A `fantasy-map` preview block under “Forschungslabor” with `map:` **and** `feature:`.
- Plugin data (`…/.obsidian/plugins/fantasy-map-plus/data.json`):
  - map `d0ec2f93-…` = **"Glyntworth"**, 1 layer, 6 features.
  - feature `cc0ba1fd-…` **exists** on that map, name **"Zum Rastplatz des Holzfällers"**.
    → `resolveFeatureId(config, "cc0ba1fd-…")` **will** resolve it.

## 3. Code path under test

```
Plugin.onload
  └─ registerObsidianProtocolHandler("fantasy-map", params => handleProtocolLink(params))   // main.ts
handleProtocolLink(params)                                                                   // main.ts
  ├─ resolveMap(settings.maps, params.map)
  ├─ resolveFeatureId(config, params.feature)
  └─ openMap(config.id, featureId)
openMap(mapId, featureId)                                                                    // main.ts
  ├─ leaves = workspace.getLeavesOfType(FANTASY_MAP_VIEW)
  ├─ leaf = leaves[0] ?? workspace.getLeaf("tab")
  ├─ (reuse) if (leaf.view instanceof FantasyMapView && view.isShowing(mapId)) → revealLeaf + focusFeature
  └─ else revealLeaf(leaf); leaf.setViewState({ type, active:true, state:{ mapId, featureId } })
FantasyMapView.setState(state)                                                               // FantasyMapView.ts
  ├─ this.mapId = state.mapId; this.focusFeatureId = state.featureId
  └─ renderMap() → initializeMap() → layerMgr.loadAndDisplay(); selectById(this.focusFeatureId)
```

## 4. Evidence

Diagnostics (temporary `console.log` + debug `Notice`) were inserted into
`handleProtocolLink`, `openMap`, `FantasyMapView.setState/renderMap` and
`preview.ts`. Three controlled tests were run.

### 4a. OS-level dispatch — **WORKS**

Command (delivered the URI exactly like the OS does when a link is opened):

```
open "obsidian://fantasy-map?vault=Obsidian&map=d0ec2f93-aa46-40ad-a9b4-c37e1d2cda47&feature=cc0ba1fd-adcf-4a7b-af58-8ed634816924"
```

Console:

```
app.js:1 Received URL action {map: 'd0ec2f93-…', feature: 'cc0ba1fd-…', action: 'fantasy-map'}
plugin:fantasy-map-plus [fantasy-map] PROTOCOL link received {"map":"d0ec2f93-…","feature":"cc0ba1fd-…","action":"fantasy-map"}
plugin:fantasy-map-plus [fantasy-map] openMap {mapId: 'd0ec2f93-…', featureId: 'cc0ba1fd-…', existingLeaves: 0, leafViewType: 'empty', isDeferred: false}
plugin:fantasy-map-plus [fantasy-map] view.setState {mapId: 'd0ec2f93-…', featureId: 'cc0ba1fd-…'}
plugin:fantasy-map-plus [fantasy-map] view.setState resolved {mapId: 'd0ec2f93-…', focusFeatureId: 'cc0ba1fd-…'}
plugin:fantasy-map-plus [fantasy-map] openMap: setViewState resolved {mapId: 'd0ec2f93-…', leafViewType: 'fantasy-map-view'}
```

→ map opens **and** the feature is focused. **The plugin logic is correct.**

### 4b. Reading view, cold start — **WORKS**

After fully quitting and reopening Obsidian, the very first action was a plain
click on the 📍 link **in Reading view** → identical full trace as 4a → map +
feature. So there is **no “first click is lost” bug** on the code path itself.

### 4c. Live Preview (edit mode) — **FAILS**

Plain click on the 📍 link in Live Preview → **no console output at all**
(not even Obsidian's own `Received URL action`), nothing happens. Obsidian
never routes the URI to the protocol handler.

### 4d. The earlier “featureId: undefined” trace was a *preview block* click

An earlier trace showed:

```
[fantasy-map] openMap {mapId: 'd0ec2f93-…', featureId: undefined, existingLeaves: 0, leafViewType: 'empty', …}
```

with **no** `PROTOCOL link received` line. That is the **preview code block** path:
`preview.ts` `open()` → `plugin.openMap(config.id, feature?.properties.id)`. The
block at the top of the note has only `map:` (no `feature:`), so
`featureId: undefined` is **expected** there — it is not the markdown-link bug.

## 5. Why Live Preview can't be fixed via the DOM (key technical finding)

From the shipped Obsidian app (`/Applications/Obsidian.app/Contents/Resources/obsidian.asar`):

- **Reading view** renders the link as an anchor and Obsidian's link component
  handles the click with:
  ```js
  a ? workspace.openLinkText(l, o, mod) : s && window.open(l, "_blank")
  ```
  For an `obsidian://` URL this ends up going through the OS round-trip
  (`window.open` → main-process `setWindowOpenHandler` → `$e(url)` → `window.OBS_ACT(params)`
  → renderer dispatcher) and the handler fires.
- **Live Preview** is CodeMirror. Markdown links are drawn with the CSS classes
  **`cm-link` / `cm-url`** (verified in the asar); the URL is **not present in the
  DOM** as `href`/`data-href`. Editor clicks are handled by CM6 `domEventHandlers`.

Consequences:

- A document-level `click` listener looking for `a[href]`/`[data-href]` **cannot**
  see the URL in Live Preview (confirmed: the first attempted fix did nothing there,
  although Reading view still worked).
- Only an **editor/CodeMirror-level** hook can intercept the click and read the
  source text at the click position.

## 6. What I tried (and why it didn't work)

1. **Document capture-phase click interceptor** matching `[data-href], a[href]`
   → `parseMapUri(href)` → `handleProtocolLink`.
   *Result:* live Preview still did nothing (URL not in DOM). Reading view kept working.
2. **Extended interceptor** to read the click position from the editor and regex the
   link out of the line:
   ```ts
   const cm = editor?.cm;                       // CodeMirror EditorView (undocumented handle)
   const pos = cm.posAtCoords({ x: evt.clientX, y: evt.clientY });
   const line = cm.state.doc.lineAt(pos);
   /\[[^\]]*\]\((obsidian:\/\/fantasy-map[^\s)]*)\)/g   // find link containing pos, then handleProtocolLink
   ```
   *Result:* user reports it still does not work in Live Preview.
   *Likely reasons to investigate:* `editor.cm` may not be the correct/available
   handle in this Obsidian version; the click may be consumed before our document
   listener; or the click does not land inside the markdown link range that
   `posAtCoords` returns.

Both attempts were reverted.

## 7. Other things verified (rule-outs)

- Obsidian **awaits** `plugin.onload()` (`Component.load()` → `Promise.all([onload()])`,
  `PluginManager.loadPlugin()` awaits it), and plugins are enabled *before*
  `registerUriHook()` dispatches a pending URI → the handler is registered in time.
- `WorkspaceLeaf.setViewState()` has an early `if (this.working) return;`. It is a
  real silent-no-op mechanism, but **not** the cause here (a brand-new leaf has
  `working === false`; and the OS/Reading tests dispatch fine).
- On view creation, `View.open()` calls `onOpen()` **before** `setState()`
  (`WorkspaceLeaf.open` → `view.open`), so `renderMap()` runs twice (create-form,
  then map). This is harmless — the second `renderMap()` has `mapId` set and focuses
  the feature.
- `ItemView` creates `contentEl` **synchronously** in its constructor, so
  `renderMap()` can safely run from `onOpen()`.
- Vault name matches, so the `sessionStorage`/reload vault-switch path is not hit.
- No stray note/file was created by the link click (so it isn't being treated as an
  internal unresolved link).
- `Ek` (renderer URI parser) preserves arbitrary query params, and it logs
  `"Received callback URL"`; that line never appeared for the Live Preview click,
  i.e. that code path was not entered.

## 8. Recommendations for the next pass

1. **Reproduce/confirm in isolation**: in Live Preview, test a minimal
   `[x](obsidian://fantasy-map?map=Glyntworth)` and also test **Cmd/Ctrl+click**.
   Determine whether Obsidian *ever* dispatches `obsidian://` from the editor, or
   whether it only follows internal + `http(s)` links there.
2. **Proper Live Preview fix** (supported API): register a CodeMirror extension via
   `this.registerEditorExtension(...)` using `EditorView.domEventHandlers({ click })`,
   resolve the link at the click (`view.posAtCoords` → line text), and call the
   plugin handler; `preventDefault()` to stop Obsidian's own handling.
   - Obsidian already imports CM6 in its typings and exports `editorEditorField`
     (`StateField<EditorView>`) to obtain the `EditorView`.
   - `@codemirror/view` and `@codemirror/state` are currently only **peerDependencies
     of `obsidian`** and are **not installed** in `node_modules` (esbuild treats them
     as externals). They must be added (e.g. `pnpm add -D @codemirror/view @codemirror/state`)
     to get types; runtime resolution works because Obsidian provides them.
   - Note: `pnpm` was not on `PATH` in the debug shell (node/npm are available).
3. If a code fix is not desired, document the limitation: **run links from Reading
   view** (or Cmd/Ctrl+click if that works), and/or prefer the `fantasy-map` preview
   block which is handled in JS and works in every mode.
4. Optional hardening (independent of the above): keep surfacing `openMap` failures,
   since `void this.openMap(...)` currently swallows rejections
   (`handleProtocolLink`).

## 9. Key code references

- `src/main.ts` — `onload()` (protocol handler registration), `handleProtocolLink()`,
  `openMap()`
- `src/links.ts` — `buildMapUri()`, `resolveMap()`, `resolveFeatureId()`
- `src/map/FantasyMapView.ts` — `setState()`, `renderMap()`, `initializeMap()`,
  `isShowing()`, `focusFeature()`
- `src/preview.ts` — `MapPreview.draw()/open()` (the preview-block click path)
