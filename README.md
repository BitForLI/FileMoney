# Pagefold

Pagefold is a small desktop Markdown editor built for people who prefer ordinary files over a proprietary notes database. Notes and folders can be created in the app, reorganised by drag and drop, and opened in any other Markdown tool.

## Product at a glance

| | |
| --- | --- |
| **Users** | People who want a focused notes app without locking their writing into one service |
| **Problem** | Local Markdown is portable, but raw folders provide a poor writing and organisation experience |
| **Core experience** | Write, preview, search, link, and organise ordinary `.md` files in a desktop app |
| **Ownership model** | The user chooses the library folder and keeps it after uninstalling Pagefold |
| **Conflict behaviour** | External changes never silently replace unsaved work; Pagefold first creates a conflict copy |

The main product decision is simple: Pagefold manages the editing experience, not ownership of the content. Cloud synchronisation is optional and remains the responsibility of tools such as OneDrive, Dropbox, or Syncthing.

## What it does

- Edits local Markdown files in a focused desktop interface.
- Organises notes into folders and sections without changing the file format.
- Watches local library changes, including files updated by a separate sync tool such as OneDrive, Dropbox, or Syncthing; Pagefold does not provide its own cloud sync.
- Saves unsaved local edits as a `-local-conflict` copy when it detects a changed disk version during reconciliation.
- Keeps the user's library after the application is uninstalled.

The default Windows library is stored at:

```text
%APPDATA%\pagefold\vault
```

A different local folder can be selected under **Settings > Library location**. Pagefold never moves or deletes the previous library automatically.

## Implementation references

The [main process](src/main/index.ts) owns filesystem operations and watches
the selected library. A [typed preload API](src/preload/index.ts) exposes those
operations to the React renderer without enabling Node integration there.
The [editor](src/renderer/src/components/EditorPane.tsx) provides edit, split
and preview modes, GFM and math rendering, links and attachment display.

[Renderer state](src/renderer/src/App.tsx) serializes saves per file, checks the
expected disk content before writing, and attempts a conflict copy before
loading an externally changed version. This detects common editing conflicts;
the check and write are separate operations, not an atomic compare-and-swap.
Open-tab paths and display settings are kept locally. Search and backlinks
scan the library files rather than relying on a proprietary database.

[Markdown tests](src/renderer/src/lib/markdown.test.ts) exercise link handling,
source locations and malformed escapes. The [packaged smoke script](scripts/smoke-packaged.mjs)
checks file/IPC operations and selected UI flows. It creates temporary notes
in the selected library and removes them afterward, so use a test library for
that check. Neither suite establishes an all-races, no-data-loss guarantee.

## Development

```powershell
npm install
npm run dev
```

Run the checks and create a Windows installer with:

```powershell
npm test
npm run build
npm run dist:win
```

The installer is written to `release/Pagefold-Setup-<version>.exe`.

## Stack

Electron, React, TypeScript, Vite, Vitest, and electron-builder.
