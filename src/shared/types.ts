export type EntryType = 'file' | 'folder' | 'section'

export interface TreeEntry {
  name: string
  path: string
  type: EntryType
  modifiedAt: number
  children?: TreeEntry[]
}

export interface WorkspaceSnapshot {
  name: string
  rootPath: string
  tree: TreeEntry[]
}

export interface SearchResult {
  path: string
  name: string
  line: number
  excerpt: string
}

export interface BacklinkResult extends SearchResult {}

export interface AttachmentInput {
  notePath: string
  fileName: string
  bytes: ArrayBuffer
}

export interface AttachmentResult {
  path: string
  markdownPath: string
}

export interface MarkdownImportInput {
  targetPath: string
  fileName: string
  content: string
}

export interface WorkspaceApi {
  getWorkspace: () => Promise<WorkspaceSnapshot | null>
  refreshTree: () => Promise<TreeEntry[]>
  readFile: (relativePath: string) => Promise<string>
  writeFile: (relativePath: string, content: string) => Promise<void>
  createEntry: (parentPath: string, type: EntryType, name: string) => Promise<string>
  renameEntry: (relativePath: string, newName: string) => Promise<string>
  moveEntry: (sourcePath: string, targetFolder: string) => Promise<string>
  importMarkdown: (input: MarkdownImportInput) => Promise<string>
  deleteEntry: (relativePath: string) => Promise<void>
  search: (query: string) => Promise<SearchResult[]>
  backlinks: (relativePath: string) => Promise<BacklinkResult[]>
  saveAttachment: (input: AttachmentInput) => Promise<AttachmentResult>
  readClipboardText: () => Promise<string>
  writeClipboardText: (text: string) => Promise<void>
}
