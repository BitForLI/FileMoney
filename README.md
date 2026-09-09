# Pagefold

Pagefold is a small desktop Markdown editor built for people who prefer ordinary files over a proprietary notes database. Notes and folders can be created in the app, reorganised by drag and drop, and opened in any other Markdown tool.

## What it does

- Edits local Markdown files in a focused desktop interface.
- Organises notes into folders and sections without changing the file format.
- Watches the library for changes made by OneDrive, Dropbox, or Syncthing.
- Preserves unsaved local edits as a `-local-conflict` copy when a synced version arrives.
- Keeps the user's library after the application is uninstalled.

The default Windows library is stored at:

```text
%APPDATA%\pagefold\vault
```

A different local folder can be selected under **Settings > Library location**. Pagefold never moves or deletes the previous library automatically.

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
