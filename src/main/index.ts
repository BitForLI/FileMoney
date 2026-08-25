import { app, BrowserWindow, clipboard, ipcMain, net, protocol } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  AttachmentInput,
  AttachmentResult,
  BacklinkResult,
  EntryType,
  MarkdownImportInput,
  SearchResult,
  TreeEntry,
  WorkspaceSnapshot
} from '../shared/types'

protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { secure: true, supportFetchAPI: true, standard: true } }
])

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])
const IGNORED_FOLDERS = new Set(['.git', '.assets', '.pagefold-initialized', '.pagefold-section', 'node_modules', '.DS_Store'])
let workspaceRoot: string | null = null

async function initializeLibrary(): Promise<void> {
  workspaceRoot = path.join(app.getPath('userData'), 'vault')
  await fs.mkdir(workspaceRoot, { recursive: true })
  const marker = path.join(workspaceRoot, '.pagefold-initialized')
  try {
    await fs.access(marker)
  } catch {
    await fs.writeFile(marker, new Date().toISOString(), 'utf8')
  }
  const legacySection = path.join(workspaceRoot, '我的笔记')
  try {
    if ((await fs.stat(legacySection)).isDirectory()) {
      await fs.writeFile(path.join(legacySection, '.pagefold-section'), '', { flag: 'a' })
    }
  } catch {
    // Existing libraries do not need a default section.
  }
}

function requireWorkspace(): string {
  if (!workspaceRoot) throw new Error('Workspace is not available')
  return workspaceRoot
}

function normalizeRelative(relativePath: string): string {
  return relativePath.replaceAll('\\', '/').replace(/^\/+/, '')
}

function resolveInWorkspace(relativePath = ''): string {
  const root = requireWorkspace()
  const resolved = path.resolve(root, normalizeRelative(relativePath))
  const rootPrefix = `${root}${path.sep}`.toLocaleLowerCase()
  const candidate = resolved.toLocaleLowerCase()
  if (candidate !== root.toLocaleLowerCase() && !candidate.startsWith(rootPrefix)) {
    throw new Error('Path is outside the current workspace')
  }
  return resolved
}

async function readTree(directory: string, relative = '', depth = 0): Promise<TreeEntry[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const tree: TreeEntry[] = []

  for (const entry of entries) {
    if (IGNORED_FOLDERS.has(entry.name)) continue
    const entryRelative = normalizeRelative(path.posix.join(relative, entry.name))
    const absolute = path.join(directory, entry.name)
    let stat
    try {
      stat = await fs.stat(absolute)
    } catch {
      continue
    }

    if (entry.isDirectory()) {
      let type: EntryType = 'folder'
      if (depth === 0) {
        try {
          await fs.access(path.join(absolute, '.pagefold-section'))
          type = 'section'
        } catch {
          type = 'folder'
        }
      }
      tree.push({
        name: entry.name,
        path: entryRelative,
        type,
        modifiedAt: stat.mtimeMs,
        children: await readTree(absolute, entryRelative, depth + 1)
      })
    } else if (entry.isFile()) {
      tree.push({ name: entry.name, path: entryRelative, type: 'file', modifiedAt: stat.mtimeMs })
    }
  }

  return tree.sort((a, b) => {
    const order: Record<EntryType, number> = { section: 0, folder: 1, file: 2 }
    if (a.type !== b.type) return order[a.type] - order[b.type]
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  })
}

async function snapshot(): Promise<WorkspaceSnapshot> {
  return {
    name: 'My Library',
    rootPath: requireWorkspace(),
    tree: await readTree(requireWorkspace())
  }
}

async function collectTextFiles(directory: string, relative = ''): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (IGNORED_FOLDERS.has(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    const entryRelative = normalizeRelative(path.posix.join(relative, entry.name))
    if (entry.isDirectory()) files.push(...(await collectTextFiles(absolute, entryRelative)))
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(entryRelative)
  }
  return files
}

function uniqueDestination(directory: string, fileName: string, attempt = 0): string {
  const parsed = path.parse(fileName)
  const suffix = attempt === 0 ? '' : `-${attempt}`
  return path.join(directory, `${parsed.name}${suffix}${parsed.ext}`)
}

async function availableDestination(directory: string, fileName: string): Promise<string> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = uniqueDestination(directory, fileName, attempt)
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
  }
  throw new Error('Could not generate a unique filename')
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#e9e4da',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('workspace:get', snapshot)
  ipcMain.handle('tree:refresh', async () => readTree(requireWorkspace()))
  ipcMain.handle('file:read', async (_event, relativePath: string) => {
    const absolute = resolveInWorkspace(relativePath)
    if (!TEXT_EXTENSIONS.has(path.extname(absolute).toLowerCase())) throw new Error('Only Markdown and text files can be edited')
    return fs.readFile(absolute, 'utf8')
  })
  ipcMain.handle('file:write', async (_event, relativePath: string, content: string) => {
    const absolute = resolveInWorkspace(relativePath)
    await fs.writeFile(absolute, content, 'utf8')
  })
  ipcMain.handle('entry:create', async (_event, parentPath: string, type: EntryType, requestedName: string) => {
    const safeName = path.basename(requestedName.trim())
    if (!safeName || safeName === '.' || safeName === '..') throw new Error('Invalid name')
    const parentParts = normalizeRelative(parentPath).split('/').filter(Boolean)
    if (type === 'section' && parentParts.length !== 0) throw new Error('Sections can only be created at the library root')
    const name = type === 'file' && !path.extname(safeName) ? `${safeName}.md` : safeName
    const relative = normalizeRelative(path.posix.join(parentPath, name))
    const absolute = resolveInWorkspace(relative)
    if (type === 'folder' || type === 'section') {
      await fs.mkdir(absolute)
      if (type === 'section') await fs.writeFile(path.join(absolute, '.pagefold-section'), '', 'utf8')
    } else await fs.writeFile(absolute, `# ${path.parse(name).name}\n`, { encoding: 'utf8', flag: 'wx' })
    return relative
  })
  ipcMain.handle('entry:rename', async (_event, relativePath: string, requestedName: string) => {
    const current = resolveInWorkspace(relativePath)
    const currentStat = await fs.stat(current)
    let safeName = path.basename(requestedName.trim())
    if (!safeName || safeName === '.' || safeName === '..') throw new Error('Invalid name')
    if (currentStat.isFile() && !path.extname(safeName)) safeName = `${safeName}${path.extname(current) || '.md'}`
    const target = path.join(path.dirname(current), safeName)
    resolveInWorkspace(path.relative(requireWorkspace(), target))
    await fs.rename(current, target)
    return normalizeRelative(path.relative(requireWorkspace(), target))
  })
  ipcMain.handle('entry:move', async (_event, sourcePath: string, targetFolder: string) => {
    const source = resolveInWorkspace(sourcePath)
    const folder = resolveInWorkspace(targetFolder)
    const target = path.join(folder, path.basename(source))
    if (target.toLocaleLowerCase() === source.toLocaleLowerCase()) return normalizeRelative(sourcePath)
    if (folder.toLocaleLowerCase().startsWith(`${source.toLocaleLowerCase()}${path.sep}`)) {
      throw new Error('A folder cannot be moved into itself')
    }
    await fs.rename(source, target)
    return normalizeRelative(path.relative(requireWorkspace(), target))
  })
  ipcMain.handle('markdown:import', async (_event, input: MarkdownImportInput) => {
    const directory = resolveInWorkspace(input.targetPath)
    const directoryStat = await fs.stat(directory)
    if (!directoryStat.isDirectory()) throw new Error('Files can only be imported into the library or a folder')
    const safeName = path.basename(input.fileName.trim())
    if (!safeName || !['.md', '.markdown'].includes(path.extname(safeName).toLowerCase())) {
      throw new Error('Only Markdown files can be imported')
    }
    const destination = await availableDestination(directory, safeName)
    await fs.writeFile(destination, input.content, { encoding: 'utf8', flag: 'wx' })
    return normalizeRelative(path.relative(requireWorkspace(), destination))
  })
  ipcMain.handle('entry:delete', async (_event, relativePath: string) => {
    const absolute = resolveInWorkspace(relativePath)
    await fs.rm(absolute, { recursive: true, force: false })
  })
  ipcMain.handle('clipboard:read-text', () => clipboard.readText())
  ipcMain.handle('clipboard:write-text', (_event, text: string) => clipboard.writeText(text))
  ipcMain.handle('search:run', async (_event, query: string) => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return []
    const files = await collectTextFiles(requireWorkspace())
    const matches: SearchResult[] = []
    for (const file of files) {
      const content = await fs.readFile(resolveInWorkspace(file), 'utf8')
      content.split(/\r?\n/).forEach((line, index) => {
        if (matches.length >= 200 || !line.toLocaleLowerCase().includes(needle)) return
        matches.push({ path: file, name: path.basename(file), line: index + 1, excerpt: line.trim().slice(0, 180) })
      })
      if (matches.length >= 200) break
    }
    return matches
  })
  ipcMain.handle('links:backlinks', async (_event, relativePath: string) => {
    const stem = path.parse(relativePath).name
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const linkPattern = new RegExp(`\\[\\[(?:[^\\]|]+/)?${escaped}(?:[#|][^\\]]*)?\\]\\]`, 'i')
    const files = await collectTextFiles(requireWorkspace())
    const results: BacklinkResult[] = []
    for (const file of files) {
      if (file === relativePath) continue
      const content = await fs.readFile(resolveInWorkspace(file), 'utf8')
      content.split(/\r?\n/).forEach((line, index) => {
        if (linkPattern.test(line)) results.push({ path: file, name: path.basename(file), line: index + 1, excerpt: line.trim().slice(0, 180) })
      })
    }
    return results
  })
  ipcMain.handle('attachment:save', async (_event, input: AttachmentInput): Promise<AttachmentResult> => {
    const assets = resolveInWorkspace('.assets')
    await fs.mkdir(assets, { recursive: true })
    const safeName = path.basename(input.fileName).replace(/[^\p{L}\p{N}._-]+/gu, '-') || `image-${Date.now()}.png`
    const destination = await availableDestination(assets, safeName)
    await fs.writeFile(destination, Buffer.from(input.bytes))
    const attachmentPath = normalizeRelative(path.relative(requireWorkspace(), destination))
    const noteDirectory = path.posix.dirname(normalizeRelative(input.notePath))
    const markdownPath = path.posix.relative(noteDirectory === '.' ? '' : noteDirectory, attachmentPath)
    return { path: attachmentPath, markdownPath }
  })
}

app.whenReady().then(async () => {
  await initializeLibrary()
  registerIpc()
  protocol.handle('vault', async (request) => {
    const url = new URL(request.url)
    const relativePath = url.searchParams.get('path') ?? ''
    try {
      return net.fetch(pathToFileURL(resolveInWorkspace(relativePath)).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
