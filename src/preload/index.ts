import { contextBridge, ipcRenderer } from 'electron'
import type { AttachmentInput, EntryType, MarkdownImportInput, WorkspaceApi } from '../shared/types'

const api: WorkspaceApi = {
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  refreshTree: () => ipcRenderer.invoke('tree:refresh'),
  readFile: (relativePath) => ipcRenderer.invoke('file:read', relativePath),
  writeFile: (relativePath, content) => ipcRenderer.invoke('file:write', relativePath, content),
  createEntry: (parentPath: string, type: EntryType, name: string) => ipcRenderer.invoke('entry:create', parentPath, type, name),
  renameEntry: (relativePath, newName) => ipcRenderer.invoke('entry:rename', relativePath, newName),
  moveEntry: (sourcePath, targetFolder) => ipcRenderer.invoke('entry:move', sourcePath, targetFolder),
  importMarkdown: (input: MarkdownImportInput) => ipcRenderer.invoke('markdown:import', input),
  deleteEntry: (relativePath) => ipcRenderer.invoke('entry:delete', relativePath),
  search: (query) => ipcRenderer.invoke('search:run', query),
  backlinks: (relativePath) => ipcRenderer.invoke('links:backlinks', relativePath),
  saveAttachment: (input: AttachmentInput) => ipcRenderer.invoke('attachment:save', input),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboardText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text)
}

contextBridge.exposeInMainWorld('pagefold', api)
