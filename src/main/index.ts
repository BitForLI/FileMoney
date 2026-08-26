import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, shell, type OpenDialogOptions } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
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
const IGNORED_FOLDERS = new Set(['.git', '.assets', '.pagefold-initialized', '.pagefold-section', '.stfolder', '.stversions', 'node_modules', '.DS_Store'])
const RESERVED_NAMES = new Set(['.git', '.assets', '.pagefold-initialized', '.pagefold-section', '.stfolder', '.stversions', '.ds_store', 'node_modules'])
const closeReadyWindows = new WeakSet<BrowserWindow>()
let workspaceRoot: string | null = null
let workspaceWatcher: FSWatcher | null = null
let workspaceChangeTimer: ReturnType<typeof setTimeout> | null = null

function defaultWorkspaceRoot(): string {
  return path.join(app.getPath('userData'), 'vault')
}

function workspaceConfigPath(): string {
  return path.join(app.getPath('userData'), 'workspace.json')
}

async function prepareWorkspace(root: string): Promise<void> {
  const resolvedRoot = path.resolve(root)
  if (resolvedRoot === path.parse(resolvedRoot).root) throw new Error('Choose a dedicated folder instead of the drive root')
  workspaceRoot = resolvedRoot
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

async function persistWorkspaceRoot(root: string): Promise<void> {
  await fs.writeFile(workspaceConfigPath(), JSON.stringify({ rootPath: root }, null, 2), 'utf8')
}

async function initializeLibrary(): Promise<void> {
  let configuredRoot = defaultWorkspaceRoot()
  try {
    const configured = JSON.parse(await fs.readFile(workspaceConfigPath(), 'utf8')) as { rootPath?: unknown }
    if (typeof configured.rootPath === 'string' && path.isAbsolute(configured.rootPath)) configuredRoot = configured.rootPath
  } catch {
    // The default library remains available when no custom folder is configured.
  }
  try {
    await prepareWorkspace(configuredRoot)
  } catch {
    await prepareWorkspace(defaultWorkspaceRoot())
  }
}

function broadcastWorkspaceChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send('workspace:changed')
  }
}

function startWorkspaceWatcher(): void {
  workspaceWatcher?.close()
  workspaceWatcher = null
  if (workspaceChangeTimer) clearTimeout(workspaceChangeTimer)
  workspaceChangeTimer = null
  const root = requireWorkspace()
  try {
    workspaceWatcher = watch(root, { recursive: true }, (_event, fileName) => {
      const normalized = String(fileName ?? '').replaceAll('\\', '/')
      if (normalized.split('/').some((part) => IGNORED_FOLDERS.has(part))) return
      if (workspaceChangeTimer) clearTimeout(workspaceChangeTimer)
      workspaceChangeTimer = setTimeout(broadcastWorkspaceChanged, 650)
    })
    workspaceWatcher.on('error', () => {
      workspaceWatcher?.close()
      workspaceWatcher = null
    })
  } catch {
    // Manual refresh remains available if a platform cannot watch the selected folder.
  }
}

async function switchWorkspace(root: string): Promise<WorkspaceSnapshot> {
  await prepareWorkspace(root)
  await persistWorkspaceRoot(requireWorkspace())
  startWorkspaceWatcher()
  return snapshot()
}

function requireWorkspace(): string {
  if (!workspaceRoot) throw new Error('Workspace is not available')
  return workspaceRoot
}

function normalizeRelative(relativePath: string): string {
  return relativePath.replaceAll('\\', '/').replace(/^\/+/, '')
}

function canonicalNotePath(relativePath: string): string {
  return normalizeRelative(relativePath)
    .replace(/\.(md|markdown|txt)$/i, '')
    .toLocaleLowerCase()
}

function contentLinksToTarget(content: string, sourcePath: string, targetPath: string): boolean {
  const canonicalTarget = canonicalNotePath(targetPath)
  const targetName = path.posix.basename(canonicalTarget)
  for (const match of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const rawTarget = match[1].split('#', 1)[0].trim()
    const canonicalLink = canonicalNotePath(rawTarget)
    if (canonicalLink === canonicalTarget || !canonicalLink.includes('/') && canonicalLink === targetName) return true
  }
  for (const match of content.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const rawTarget = match[1].split('#', 1)[0]
    if (!TEXT_EXTENSIONS.has(path.posix.extname(rawTarget).toLowerCase())) continue
    let decoded: string
    try {
      decoded = decodeURIComponent(rawTarget)
    } catch {
      continue
    }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(normalizeRelative(sourcePath)), decoded))
    if (canonicalNotePath(resolved) === canonicalTarget) return true
  }
  return false
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

function validatedEntryName(requestedName: string, type: EntryType, existingExtension = ''): string {
  let safeName = path.basename(requestedName.trim())
  const deviceName = safeName.split('.')[0].toLocaleLowerCase()
  if (!safeName || safeName === '.' || safeName === '..' || RESERVED_NAMES.has(safeName.toLocaleLowerCase())
    || /[<>:"/\\|?*\u0000-\u001f]/.test(safeName) || /[. ]$/.test(safeName)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(deviceName)) throw new Error('Invalid name')
  if (type === 'file' && !path.extname(safeName)) safeName = `${safeName}${existingExtension || '.md'}`
  if (type === 'file' && !TEXT_EXTENSIONS.has(path.extname(safeName).toLowerCase())) {
    throw new Error('Notes must use .md, .markdown, or .txt')
  }
  return safeName
}

async function ensureAvailableTarget(source: string, target: string): Promise<void> {
  if (source === target || source.toLocaleLowerCase() === target.toLocaleLowerCase()) return
  try {
    await fs.access(target)
  } catch {
    return
  }
  throw new Error('An item with that name already exists')
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
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
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
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  let closeFallback: ReturnType<typeof setTimeout> | null = null

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url === current) return
    event.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
  window.on('close', (event) => {
    if (closeReadyWindows.has(window) || window.webContents.isDestroyed()) return
    event.preventDefault()
    window.webContents.send('window:prepare-close')
    if (!closeFallback) {
      closeFallback = setTimeout(() => {
        closeReadyWindows.add(window)
        window.close()
      }, 5000)
    }
  })
  window.on('closed', () => { if (closeFallback) clearTimeout(closeFallback) })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle('workspace:get', snapshot)
  ipcMain.handle('workspace:choose-folder', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: 'Choose Pagefold library folder',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return switchWorkspace(result.filePaths[0])
  })
  ipcMain.handle('workspace:use-default', () => switchWorkspace(defaultWorkspaceRoot()))
  ipcMain.handle('tree:refresh', async () => readTree(requireWorkspace()))
  ipcMain.handle('file:read', async (_event, relativePath: string) => {
    const absolute = resolveInWorkspace(relativePath)
    if (!TEXT_EXTENSIONS.has(path.extname(absolute).toLowerCase())) throw new Error('Only Markdown and text files can be edited')
    return fs.readFile(absolute, 'utf8')
  })
  ipcMain.handle('file:write', async (_event, relativePath: string, content: string) => {
    const absolute = resolveInWorkspace(relativePath)
    if (!TEXT_EXTENSIONS.has(path.extname(absolute).toLowerCase())) throw new Error('Only Markdown and text files can be edited')
    const handle = await fs.open(absolute, 'r+')
    try {
      await handle.truncate(0)
      await handle.writeFile(content, 'utf8')
    } finally {
      await handle.close()
    }
  })
  ipcMain.handle('entry:create', async (_event, parentPath: string, type: EntryType, requestedName: string) => {
    if (!['file', 'folder', 'section'].includes(type)) throw new Error('Invalid entry type')
    const safeName = validatedEntryName(requestedName, type)
    const parentParts = normalizeRelative(parentPath).split('/').filter(Boolean)
    if (type === 'section' && parentParts.length !== 0) throw new Error('Sections can only be created at the library root')
    const parent = resolveInWorkspace(parentPath)
    if (!(await fs.stat(parent)).isDirectory()) throw new Error('Items can only be created in a folder')
    const relative = normalizeRelative(path.posix.join(parentPath, safeName))
    const absolute = resolveInWorkspace(relative)
    if (type === 'folder' || type === 'section') {
      await fs.mkdir(absolute)
      if (type === 'section') await fs.writeFile(path.join(absolute, '.pagefold-section'), '', 'utf8')
    } else await fs.writeFile(absolute, `# ${path.parse(safeName).name}\n`, { encoding: 'utf8', flag: 'wx' })
    return relative
  })
  ipcMain.handle('entry:rename', async (_event, relativePath: string, requestedName: string) => {
    const current = resolveInWorkspace(relativePath)
    const currentStat = await fs.stat(current)
    const safeName = validatedEntryName(requestedName, currentStat.isFile() ? 'file' : 'folder', path.extname(current))
    const target = path.join(path.dirname(current), safeName)
    resolveInWorkspace(path.relative(requireWorkspace(), target))
    await ensureAvailableTarget(current, target)
    await fs.rename(current, target)
    return normalizeRelative(path.relative(requireWorkspace(), target))
  })
  ipcMain.handle('entry:move', async (_event, sourcePath: string, targetFolder: string) => {
    const source = resolveInWorkspace(sourcePath)
    const folder = resolveInWorkspace(targetFolder)
    if (!(await fs.stat(folder)).isDirectory()) throw new Error('Items can only be moved into a folder')
    const target = path.join(folder, path.basename(source))
    if (target.toLocaleLowerCase() === source.toLocaleLowerCase()) return normalizeRelative(sourcePath)
    if (folder.toLocaleLowerCase().startsWith(`${source.toLocaleLowerCase()}${path.sep}`)) {
      throw new Error('A folder cannot be moved into itself')
    }
    await ensureAvailableTarget(source, target)
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
    if (absolute === requireWorkspace()) throw new Error('The library root cannot be deleted')
    await fs.rm(absolute, { recursive: true, force: false })
  })
  ipcMain.handle('window:close-ready', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    closeReadyWindows.add(window)
    window.close()
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
    const files = await collectTextFiles(requireWorkspace())
    const results: BacklinkResult[] = []
    for (const file of files) {
      if (file === relativePath) continue
      const content = await fs.readFile(resolveInWorkspace(file), 'utf8')
      content.split(/\r?\n/).forEach((line, index) => {
        if (contentLinksToTarget(line, file, relativePath)) results.push({ path: file, name: path.basename(file), line: index + 1, excerpt: line.trim().slice(0, 180) })
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
  startWorkspaceWatcher()
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

app.on('before-quit', () => {
  workspaceWatcher?.close()
  if (workspaceChangeTimer) clearTimeout(workspaceChangeTimer)
})
