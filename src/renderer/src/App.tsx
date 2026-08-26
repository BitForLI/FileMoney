import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
  FilePlus2,
  FolderPlus,
  Hash,
  Link2,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  Layers3,
  X
} from 'lucide-react'
import type { BacklinkResult, EntryType, SearchResult, TreeEntry, WorkspaceSnapshot } from '../../shared/types'
import { EditorPane, type ViewMode } from './components/EditorPane'
import { NameDialog } from './components/EntryDialog'
import { FileTree } from './components/FileTree'
import { SettingsPanel, type AppSettings } from './components/SettingsPanel'
import { displayEntryName, displayLibraryPath, extractDocumentLocations, extractOutgoingDocumentLinks, flattenMarkdownFiles } from './lib/markdown'

interface OpenTab {
  path: string
  name: string
  content: string
  savedContent: string
}

type NameDialogState =
  | { mode: 'create'; parent: string; entryType: EntryType }
  | { mode: 'rename'; entry: TreeEntry }

const DEFAULT_SETTINGS: AppSettings = { theme: 'light', fontScale: 18, readableWidth: true }

function findTreeEntry(entries: TreeEntry[], path: string): TreeEntry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry
    const child = findTreeEntry(entry.children ?? [], path)
    if (child) return child
  }
  return null
}

function loadSettings(): AppSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('pagefold:settings') ?? '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function replacePathPrefix(value: string, oldPrefix: string, newPrefix: string): string {
  if (value === oldPrefix) return newPrefix
  return value.startsWith(`${oldPrefix}/`) ? `${newPrefix}${value.slice(oldPrefix.length)}` : value
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const [tree, setTree] = useState<TreeEntry[]>([])
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const tabsRef = useRef<OpenTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const stored = Number(localStorage.getItem('pagefold:right-panel-width'))
    return Number.isFinite(stored) && stored >= 220 && stored <= 420 ? stored : 260
  })
  const rightPanelPointer = useRef<number | null>(null)
  const [backlinks, setBacklinks] = useState<BacklinkResult[]>([])
  const [rightContextPath, setRightContextPath] = useState<string | null>(null)
  const [rightLinkMode, setRightLinkMode] = useState<'backlinks' | 'outgoing'>('backlinks')
  const [rightPanelMode, setRightPanelMode] = useState<'links' | 'outline'>('links')
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('pagefold:view') as ViewMode) || 'split')
  const [jumpLine, setJumpLine] = useState<number | null>(null)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const [rootDropActive, setRootDropActive] = useState(false)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const saveVersions = useRef<Record<string, number>>({})
  const savePromises = useRef<Record<string, Promise<void> | undefined>>({})
  const openingFiles = useRef<Record<string, Promise<string> | undefined>>({})
  const [saveErrors, setSaveErrors] = useState<Record<string, boolean>>({})
  const [backlinkRevision, setBacklinkRevision] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchBusy, setSearchBusy] = useState(false)

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null
  const rightContextTab = tabs.find((tab) => tab.path === rightContextPath) ?? activeTab
  const activeSaveStatus: 'saved' | 'saving' | 'error' = activePath && saveErrors[activePath]
    ? 'error'
    : activeTab && activeTab.content !== activeTab.savedContent ? 'saving' : 'saved'

  function notify(message: string): void {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }

  const openFile = useCallback(async (path: string, line?: number, activate = true) => {
    if (!/\.(md|markdown|txt)$/i.test(path)) {
      notify('Only Markdown and text files can be edited')
      return
    }
    const existing = tabsRef.current.find((tab) => tab.path === path)
    if (!existing) {
      try {
        const pending = openingFiles.current[path] ?? window.pagefold.readFile(path)
        openingFiles.current[path] = pending
        const content = await pending
        const tab = { path, name: path.split('/').pop() ?? path, content, savedContent: content }
        setTabs((current) => current.some((item) => item.path === path) ? current : [...current, tab])
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not open the file')
        return
      } finally {
        delete openingFiles.current[path]
      }
    }
    if (activate) {
      setActivePath(path)
      setJumpLine(null)
      if (line) window.requestAnimationFrame(() => setJumpLine(line))
    }
  }, [])

  function openInPane(path: string, pane: 'left' | 'right'): void {
    void openFile(path, undefined, pane === 'right')
  }

  async function activateWorkspace(next: WorkspaceSnapshot): Promise<void> {
    setWorkspace(next)
    setTree(next.tree)
    setSelectedPath('')
    setTabs([])
    setActivePath(null)
    const key = `pagefold:session:${next.rootPath}`
    try {
      const session = JSON.parse(localStorage.getItem(key) ?? '{}') as { paths?: string[]; activePath?: string }
      const restored = (await Promise.all((session.paths ?? []).slice(0, 12).map(async (path) => {
        try {
          const content = await window.pagefold.readFile(path)
          return { path, name: path.split('/').pop() ?? path, content, savedContent: content }
        } catch {
          return null
        }
      }))).filter((tab): tab is OpenTab => tab !== null)
      setTabs(restored)
      const restoredActive = restored.some((tab) => tab.path === session.activePath) ? session.activePath! : restored[0]?.path ?? null
      setActivePath(restoredActive)
    } catch {
      // A corrupt session should never block opening the workspace.
    }
  }

  async function loadInitialWorkspace(): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const initial = await Promise.race([
          window.pagefold.getWorkspace(),
          new Promise<never>((_resolve, reject) => window.setTimeout(() => reject(new Error('workspace timeout')), 900))
        ])
        if (initial) {
          await activateWorkspace(initial)
          return
        }
      } catch {
        // The packaged renderer can become ready a fraction before IPC on slower systems.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 180))
    }
    notify('Could not load the library. Try again.')
  }

  useEffect(() => {
    void loadInitialWorkspace()
  }, [])

  useEffect(() => {
    tabsRef.current = tabs
    if (!workspace) return
    localStorage.setItem(`pagefold:session:${workspace.rootPath}`, JSON.stringify({
      paths: tabs.map((tab) => tab.path),
      activePath
    }))
  }, [tabs, activePath, workspace])

  useEffect(() => {
    setSelectedPath(activePath ?? '')
  }, [activePath])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.style.setProperty('--editor-size', `${settings.fontScale}px`)
    document.documentElement.classList.toggle('readable-width', settings.readableWidth)
    localStorage.setItem('pagefold:settings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    localStorage.setItem('pagefold:view', viewMode)
  }, [viewMode])

  useEffect(() => {
    localStorage.setItem('pagefold:right-panel-width', String(rightPanelWidth))
  }, [rightPanelWidth])

  useEffect(() => {
    setRightContextPath((current) => current && tabs.some((tab) => tab.path === current) ? current : activePath)
  }, [tabs, activePath])

  useEffect(() => {
    if (!rightContextPath) {
      setBacklinks([])
      return
    }
    const timer = window.setTimeout(() => {
      window.pagefold.backlinks(rightContextPath).then(setBacklinks).catch(() => setBacklinks([]))
    }, 280)
    return () => window.clearTimeout(timer)
  }, [rightContextPath, rightContextTab?.savedContent, backlinkRevision])

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([])
      setSearchBusy(false)
      return
    }
    setSearchBusy(true)
    let cancelled = false
    const timer = window.setTimeout(() => {
      window.pagefold.search(searchQuery)
        .then((results) => { if (!cancelled) setSearchResults(results) })
        .catch(() => { if (!cancelled) notify('Search failed') })
        .finally(() => { if (!cancelled) setSearchBusy(false) })
    }, 220)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [searchOpen, searchQuery])

  useEffect(() => window.pagefold.onPrepareClose(() => {
    void flushAllTabs().then((saved) => {
      if (saved) void window.pagefold.finishClose()
      else notify('Could not save all open notes. The window was kept open.')
    })
  }), [])

  useEffect(() => window.pagefold.onWorkspaceChanged(() => {
    void reconcileExternalWorkspaceChange()
  }), [workspace?.rootPath])

  useEffect(() => {
    function keyboard(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'p') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [])

  async function refreshTree(): Promise<void> {
    const nextTree = await window.pagefold.refreshTree()
    setTree(nextTree)
  }

  async function reconcileExternalWorkspaceChange(): Promise<void> {
    try {
      const nextWorkspace = await window.pagefold.getWorkspace()
      if (!nextWorkspace || nextWorkspace.rootPath !== workspace?.rootPath) return
      setWorkspace(nextWorkspace)
      setTree(nextWorkspace.tree)
      let conflictCount = 0
      let removedCount = 0
      const reconciled = (await Promise.all(tabsRef.current.map(async (tab) => {
        try {
          const diskContent = await window.pagefold.readFile(tab.path)
          if (diskContent === tab.savedContent) return tab
          if (tab.content === tab.savedContent) return { ...tab, content: diskContent, savedContent: diskContent }
          clearTimeout(saveTimers.current[tab.path])
          delete saveTimers.current[tab.path]
          saveVersions.current[tab.path] = (saveVersions.current[tab.path] ?? 0) + 1
          setSaveErrors((current) => ({ ...current, [tab.path]: true }))
          conflictCount += 1
          return tab
        } catch {
          if (tab.content !== tab.savedContent) {
            conflictCount += 1
            return tab
          }
          removedCount += 1
          return null
        }
      }))).filter((tab): tab is OpenTab => tab !== null)
      tabsRef.current = reconciled
      setTabs(reconciled)
      setActivePath((current) => current && reconciled.some((tab) => tab.path === current) ? current : reconciled[0]?.path ?? null)
      setBacklinkRevision((current) => current + 1)
      if (conflictCount) notify(`${conflictCount} open ${conflictCount === 1 ? 'note has' : 'notes have'} local edits and was not overwritten by a synced change.`)
      else if (removedCount) notify(`${removedCount} open ${removedCount === 1 ? 'note was' : 'notes were'} removed by external sync.`)
    } catch {
      notify('Could not refresh changes from the sync folder.')
    }
  }

  async function changeWorkspace(source: 'folder' | 'default'): Promise<void> {
    if (!await flushAllTabs()) return
    setWorkspaceBusy(true)
    try {
      const next = source === 'folder'
        ? await window.pagefold.chooseWorkspaceFolder()
        : await window.pagefold.useDefaultWorkspace()
      if (!next) return
      await activateWorkspace(next)
      setSaveErrors({})
      notify(source === 'folder' ? 'Library folder changed.' : 'Default library restored.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not change the library folder.')
    } finally {
      setWorkspaceBusy(false)
    }
  }

  async function persistContent(path: string, content: string, version: number): Promise<boolean> {
    const operation = window.pagefold.writeFile(path, content)
    savePromises.current[path] = operation
    try {
      await operation
      if (saveVersions.current[path] === version) {
        setTabs((current) => current.map((tab) => tab.path === path ? { ...tab, savedContent: content } : tab))
        setSaveErrors((current) => ({ ...current, [path]: false }))
      }
      setBacklinkRevision((current) => current + 1)
      return true
    } catch {
      if (saveVersions.current[path] === version) setSaveErrors((current) => ({ ...current, [path]: true }))
      notify('Auto-save failed. Check file permissions.')
      return false
    } finally {
      if (savePromises.current[path] === operation) delete savePromises.current[path]
    }
  }

  async function flushPath(path: string): Promise<boolean> {
    clearTimeout(saveTimers.current[path])
    delete saveTimers.current[path]
    if (savePromises.current[path]) await savePromises.current[path]?.catch(() => undefined)
    const tab = tabsRef.current.find((item) => item.path === path)
    if (!tab || tab.content === tab.savedContent) return true
    const version = (saveVersions.current[path] ?? 0) + 1
    saveVersions.current[path] = version
    return persistContent(path, tab.content, version)
  }

  async function flushPathPrefix(prefix: string): Promise<boolean> {
    const paths = tabsRef.current
      .filter((tab) => tab.path === prefix || tab.path.startsWith(`${prefix}/`))
      .map((tab) => tab.path)
    const results = await Promise.all(paths.map(flushPath))
    return results.every(Boolean)
  }

  async function settlePathPrefix(prefix: string): Promise<void> {
    const paths = Object.keys(saveVersions.current).filter((path) => path === prefix || path.startsWith(`${prefix}/`))
    for (const path of paths) {
      clearTimeout(saveTimers.current[path])
      delete saveTimers.current[path]
      saveVersions.current[path] = (saveVersions.current[path] ?? 0) + 1
    }
    await Promise.all(paths.map((path) => savePromises.current[path]?.catch(() => undefined)))
  }

  async function flushAllTabs(): Promise<boolean> {
    const results = await Promise.all(tabsRef.current.map((tab) => flushPath(tab.path)))
    return results.every(Boolean)
  }

  async function createEntry(parent: string, type: EntryType, requested: string): Promise<boolean> {
    try {
      const path = await window.pagefold.createEntry(parent, type, requested)
      await refreshTree()
      setSelectedPath(path)
      if (type === 'file') await openFile(path)
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create the item. That name may already be in use.')
      return false
    }
  }

  function requestCreate(parent: string, entryType: EntryType): void {
    setNameDialog({ mode: 'create', parent, entryType })
  }

  function createQuickNote(): void {
    requestCreate(defaultCreateParent, 'file')
  }

  async function renameEntry(entry: TreeEntry, requested: string): Promise<boolean> {
    if (requested === entry.name || requested === entry.name.replace(/\.md$/i, '')) return true
    if (!await flushPathPrefix(entry.path)) return false
    try {
      const nextPath = await window.pagefold.renameEntry(entry.path, requested)
      setTabs((current) => current.map((tab) => {
        const path = replacePathPrefix(tab.path, entry.path, nextPath)
        return { ...tab, path, name: path.split('/').pop() ?? path }
      }))
      setActivePath((current) => current ? replacePathPrefix(current, entry.path, nextPath) : current)
      setSelectedPath(nextPath)
      setSaveErrors((current) => Object.fromEntries(Object.entries(current).map(([path, failed]) => [replacePathPrefix(path, entry.path, nextPath), failed])))
      await refreshTree()
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Rename failed')
      return false
    }
  }

  async function moveEntry(sourcePath: string, targetFolder: string): Promise<void> {
    if (!sourcePath || sourcePath === targetFolder) return
    if (!await flushPathPrefix(sourcePath)) return
    try {
      const nextPath = await window.pagefold.moveEntry(sourcePath, targetFolder)
      setTabs((current) => current.map((tab) => {
        const path = replacePathPrefix(tab.path, sourcePath, nextPath)
        return { ...tab, path, name: path.split('/').pop() ?? path }
      }))
      setActivePath((current) => current ? replacePathPrefix(current, sourcePath, nextPath) : current)
      setSelectedPath(nextPath)
      setSaveErrors((current) => Object.fromEntries(Object.entries(current).map(([path, failed]) => [replacePathPrefix(path, sourcePath, nextPath), failed])))
      await refreshTree()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Move failed')
    }
  }

  async function importMarkdownFiles(files: File[], targetPath: string): Promise<void> {
    const markdownFiles = files.filter((file) => /\.(md|markdown)$/i.test(file.name))
    if (!markdownFiles.length) {
      notify('Only Markdown files can be imported')
      return
    }
    const imported: string[] = []
    let failed = 0
    for (const file of markdownFiles) {
      try {
        imported.push(await window.pagefold.importMarkdown({
          targetPath,
          fileName: file.name,
          content: await file.text()
        }))
      } catch {
        failed += 1
      }
    }
    if (imported.length) {
      await refreshTree()
      setSelectedPath(imported[0])
      await openFile(imported[0])
    }
    notify(failed
      ? `Imported ${imported.length} ${imported.length === 1 ? 'note' : 'notes'}; ${failed} failed`
      : `Imported ${imported.length} ${imported.length === 1 ? 'note' : 'notes'}`)
  }

  async function deleteEntry(entry: TreeEntry): Promise<boolean> {
    try {
      await settlePathPrefix(entry.path)
      await window.pagefold.deleteEntry(entry.path)
      const remaining = tabsRef.current.filter((tab) => tab.path !== entry.path && !tab.path.startsWith(`${entry.path}/`))
      setTabs(remaining)
      setActivePath((current) => current === entry.path || current?.startsWith(`${entry.path}/`) ? remaining[0]?.path ?? null : current)
      setSelectedPath('')
      setSaveErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => path !== entry.path && !path.startsWith(`${entry.path}/`))))
      await refreshTree()
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Delete failed')
      return false
    }
  }

  async function submitNameDialog(value: string): Promise<void> {
    if (!nameDialog) return
    setDialogBusy(true)
    const completed = nameDialog.mode === 'create'
      ? await createEntry(nameDialog.parent, nameDialog.entryType, value)
      : await renameEntry(nameDialog.entry, value)
    setDialogBusy(false)
    if (completed) setNameDialog(null)
  }

  function updateContent(path: string, content: string): void {
    setTabs((current) => current.map((tab) => tab.path === path ? { ...tab, content } : tab))
    setSaveErrors((current) => ({ ...current, [path]: false }))
    clearTimeout(saveTimers.current[path])
    const version = (saveVersions.current[path] ?? 0) + 1
    saveVersions.current[path] = version
    saveTimers.current[path] = setTimeout(async () => {
      delete saveTimers.current[path]
      await persistContent(path, content, version)
    }, 520)
  }

  async function closeTab(path: string): Promise<void> {
    if (!await flushPath(path)) return
    const index = tabsRef.current.findIndex((item) => item.path === path)
    const remaining = tabsRef.current.filter((item) => item.path !== path)
    setTabs(remaining)
    if (activePath === path) setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path ?? null)
  }

  async function attach(notePath: string, file: File): Promise<string> {
    const result = await window.pagefold.saveAttachment({ notePath, fileName: file.name, bytes: await file.arrayBuffer() })
    await refreshTree()
    return result.markdownPath
  }

  function openWiki(target: string): void {
    const [rawTarget, fragment] = target.split('#', 2)
    const normalized = rawTarget.replaceAll('\\', '/').replace(/\.(md|markdown|txt)$/i, '')
    const note = flattenMarkdownFiles(tree).find((entry) => {
      const withoutExtension = entry.path.replace(/\.(md|markdown|txt)$/i, '')
      return withoutExtension === normalized || entry.name.replace(/\.(md|markdown|txt)$/i, '') === normalized.split('/').pop()
    })
    const line = fragment?.match(/^L(\d+)$/i)
    if (note) void openFile(note.path, line ? Number(line[1]) : undefined)
    else notify(`Could not find “${target}”`)
  }

  function resizeRightPanel(clientX: number): void {
    setRightPanelWidth(Math.min(420, Math.max(220, window.innerWidth - clientX)))
  }

  const breadcrumb = useMemo(() => activePath?.split('/') ?? [], [activePath])
  const defaultCreateParent = useMemo(() => {
    if (!selectedPath) return ''
    const selectedEntry = findTreeEntry(tree, selectedPath)
    if (selectedEntry?.type === 'folder' || selectedEntry?.type === 'section') return selectedEntry.path
    const contextPath = selectedEntry?.path ?? ''
    return contextPath.includes('/') ? contextPath.slice(0, contextPath.lastIndexOf('/')) : ''
  }, [selectedPath, tree])
  const recentPaths = useMemo(() => Array.from(new Set([
    ...(activePath ? [activePath] : []),
    ...tabs.map((tab) => tab.path).reverse()
  ])), [activePath, tabs])
  const outgoingLinks = useMemo(
    () => rightContextTab ? extractOutgoingDocumentLinks(rightContextTab.content, rightContextTab.path) : [],
    [rightContextTab?.content, rightContextTab?.path]
  )
  const outline = useMemo(
    () => {
      if (!rightContextTab) return []
      const lines = rightContextTab.content.split(/\r?\n/)
      return extractDocumentLocations(rightContextTab.content)
        .filter((location) => location.kind === 'heading')
        .map((location) => ({
          ...location,
          level: lines[location.line - 1]?.match(/^(#{1,6})\s/)?.[1].length ?? 1
        }))
    },
    [rightContextTab?.content]
  )

  if (!workspace) return <main className="library-loading"><span>P</span><p>Preparing your library…</p><button onClick={() => void loadInitialWorkspace()}>Reload</button></main>

  return (
    <main
      className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'} ${rightPanelOpen ? '' : 'right-collapsed'}`}
      style={rightPanelOpen ? { gridTemplateColumns: `${sidebarOpen ? 230 : 0}px minmax(0, 1fr) ${rightPanelWidth}px` } : undefined}
    >
      <header className="app-header">
        <div className="breadcrumb" aria-label="Current location">
          <span>{workspace.name}</span>
          {breadcrumb.map((part, index) => <span key={`${part}-${index}`}><ChevronRight size={13} />{displayEntryName(part.replace(/\.md$/i, ''))}</span>)}
        </div>
        <div className="header-actions">
          <button className={`icon-button ${rightPanelMode === 'links' && rightLinkMode === 'backlinks' && rightPanelOpen ? 'active' : ''}`} onClick={() => { setRightPanelMode('links'); setRightLinkMode('backlinks'); setRightPanelOpen(true) }} title="Show backlinks" aria-label="Show backlinks"><ArrowDownLeft size={17} /></button>
          <button className={`icon-button ${rightPanelMode === 'links' && rightLinkMode === 'outgoing' && rightPanelOpen ? 'active' : ''}`} onClick={() => { setRightPanelMode('links'); setRightLinkMode('outgoing'); setRightPanelOpen(true) }} title="Show outgoing links" aria-label="Show outgoing links"><ArrowUpRight size={17} /></button>
          <button className={`icon-button ${rightPanelMode === 'outline' && rightPanelOpen ? 'active' : ''}`} onClick={() => { setRightPanelMode('outline'); setRightPanelOpen(true) }} title="Show outline" aria-label="Show outline"><ListTree size={17} /></button>
          <button className="icon-button" onClick={() => setRightPanelOpen((value) => !value)} title={rightPanelOpen ? 'Collapse right panel' : 'Expand right panel'} aria-label={rightPanelOpen ? 'Collapse right panel' : 'Expand right panel'}>{rightPanelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>
        </div>
      </header>

      <aside className="left-sidebar">
        <>
            <div className="section-heading">
              <button className="sidebar-toggle" onClick={() => setSidebarOpen(false)} title="Collapse library" aria-label="Collapse library"><PanelLeftClose size={17} /></button>
              <div className="library-create-buttons">
                <button onClick={createQuickNote} title="New note" aria-label="New note"><FilePlus2 size={14} /></button>
                <button onClick={() => requestCreate(defaultCreateParent, 'folder')} title="New folder" aria-label="New folder"><FolderPlus size={14} /></button>
                <button onClick={() => requestCreate('', 'section')} title="New section" aria-label="New section"><Layers3 size={14} /></button>
                <button onClick={() => setSearchOpen(true)} title="Search (Ctrl+P)" aria-label="Search library"><Search size={14} /></button>
                <button onClick={() => setSettingsOpen(true)} title="Settings (Ctrl+,)" aria-label="Settings"><Settings size={14} /></button>
              </div>
            </div>
            <div
              className={`tree-scroll ${rootDropActive ? 'is-drop-target' : ''}`}
              onClick={(event) => {
                const target = event.target instanceof Element ? event.target : null
                if (!target?.closest('[role="treeitem"]')) setSelectedPath('')
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') ? 'copy' : 'move'
                if (event.target === event.currentTarget) setRootDropActive(true)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setRootDropActive(false)
              }}
              onDrop={(event) => {
                setRootDropActive(false)
                if (event.target !== event.currentTarget) return
                const source = event.dataTransfer.getData('text/pagefold-path')
                if (source) void moveEntry(source, '')
                else void importMarkdownFiles(Array.from(event.dataTransfer.files), '')
              }}
            >
              <FileTree tree={tree} activePath={activePath} selectedPath={selectedPath} onSelect={(entry) => setSelectedPath(entry.path)} onOpen={(path) => void openFile(path)} onCreate={requestCreate} onRename={(entry) => setNameDialog({ mode: 'rename', entry })} onDelete={(entry) => void deleteEntry(entry)} onMove={(source, target) => void moveEntry(source, target)} onImport={(files, target) => void importMarkdownFiles(files, target)} />
            </div>
        </>
      </aside>

      {!sidebarOpen && <button className="sidebar-reveal icon-button" onClick={() => setSidebarOpen(true)} title="Expand library" aria-label="Expand library"><PanelLeftOpen size={17} /></button>}

      <section className="workspace-stage">
        {tabs.length > 0 && (
          <div className="tab-strip">
            {tabs.map((tab) => <button key={tab.path} data-path={tab.path} draggable onDragStart={(event) => { event.dataTransfer.setData('text/pagefold-path', tab.path); event.dataTransfer.effectAllowed = 'copy' }} className={tab.path === activePath ? 'active' : ''} onClick={() => { setActivePath(tab.path); setSelectedPath(tab.path) }}><FileTextIcon /><span>{tab.name.replace(/\.md$/i, '')}</span>{tab.content !== tab.savedContent && <i />}<b role="button" tabIndex={0} aria-label={`Close ${tab.name}`} onClick={(event) => { event.stopPropagation(); void closeTab(tab.path) }}><X size={13} /></b></button>)}
          </div>
        )}
        {activeTab ? (
          <EditorPane path={activeTab.path} content={activeTab.content} openDocuments={tabs} tree={tree} recentPaths={recentPaths} mode={viewMode} jumpLine={jumpLine} onModeChange={setViewMode} onChange={updateContent} onWikiOpen={openWiki} onOpenInPane={openInPane} onAttach={attach} />
        ) : (
          <div className="empty-editor">
            <div className="empty-number">{String(flattenMarkdownFiles(tree).length).padStart(2, '0')}</div>
            <button className="primary-button" onClick={createQuickNote}><FilePlus2 size={17} />New note</button>
          </div>
        )}
        <footer className="status-bar">
          <span>{activeTab ? `${activeTab.content.trim() ? activeTab.content.trim().split(/\s+/).length : 0} words · ${activeTab.content.length} characters` : 'Ready'}</span>
          <span className={`save-state ${activeSaveStatus}`}><Check size={12} />{activeSaveStatus === 'saving' ? 'Saving' : activeSaveStatus === 'error' ? 'Save failed' : 'Saved locally'}</span>
        </footer>
      </section>

      <aside className="right-sidebar">
        <div
          className="right-panel-resizer"
          role="separator"
          aria-label="Resize links panel"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={420}
          aria-valuenow={Math.round(rightPanelWidth)}
          tabIndex={0}
          title="Drag to resize"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            rightPanelPointer.current = event.pointerId
            event.currentTarget.setPointerCapture(event.pointerId)
            resizeRightPanel(event.clientX)
          }}
          onPointerMove={(event) => {
            if (rightPanelPointer.current === event.pointerId) resizeRightPanel(event.clientX)
          }}
          onPointerUp={(event) => {
            if (rightPanelPointer.current !== event.pointerId) return
            rightPanelPointer.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={(event) => {
            if (rightPanelPointer.current !== event.pointerId) return
            rightPanelPointer.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setRightPanelWidth((current) => Math.min(420, current + 12))
            else if (event.key === 'ArrowRight') setRightPanelWidth((current) => Math.max(220, current - 12))
            else return
            event.preventDefault()
          }}
        />
        {rightContextTab && <div className="right-panel-context"><select value={rightContextTab.path} onChange={(event) => setRightContextPath(event.target.value)} aria-label="Document for links panel">{tabs.map((tab) => <option key={tab.path} value={tab.path}>{tab.name.replace(/\.(md|markdown|txt)$/i, '')}</option>)}</select></div>}
        {rightPanelMode === 'links' ? (
          <>
            <div className="connection-list backlink-list">
              {!rightContextPath ? null : rightLinkMode === 'backlinks' ? (
                backlinks.length === 0 ? null : backlinks.map((link, index) => <button key={`${link.path}-${link.line}-${index}`} onClick={() => void openFile(link.path, link.line)}><span><ArrowDownLeft size={13} />{link.name.replace(/\.md$/i, '')}</span><small>{displayLibraryPath(link.path)} · Line {link.line}</small></button>)
              ) : (
                outgoingLinks.length === 0 ? null : outgoingLinks.map((link) => <button key={`${link.kind}-${link.target}`} onClick={() => openWiki(link.target)}><span><ArrowUpRight size={13} />{link.label}</span><p>{displayLibraryPath(link.target)}</p><small>Line {link.line}</small></button>)
              )}
            </div>
          </>
        ) : (
          <div className="outline-list">
            {!rightContextPath || outline.length === 0 ? null : outline.map((heading) => <button key={`${heading.line}-${heading.label}`} className={`outline-level-${heading.level}`} onClick={() => void openFile(rightContextPath, heading.line)}><span>{heading.label}</span><small>Line {heading.line}</small></button>)}
          </div>
        )}
      </aside>

      {settingsOpen && <SettingsPanel settings={settings} workspacePath={workspace.rootPath} workspaceBusy={workspaceBusy} onChange={setSettings} onChooseWorkspace={() => void changeWorkspace('folder')} onUseDefaultWorkspace={() => void changeWorkspace('default')} onClose={() => { if (!workspaceBusy) setSettingsOpen(false) }} />}
      {searchOpen && (
        <div className="modal-backdrop search-dialog-backdrop" onMouseDown={() => setSearchOpen(false)}>
          <section className="search-dialog" role="dialog" aria-modal="true" aria-label="Search library" onMouseDown={(event) => event.stopPropagation()}>
            <div className="search-dialog-input"><Search size={16} /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false) }} placeholder="Search every note" /><button className="icon-button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={16} /></button></div>
            <div className="search-dialog-results">
              {searchBusy && <p>Searching…</p>}
              {!searchBusy && searchQuery.trim() && searchResults.length === 0 && <p>No matches</p>}
              {!searchBusy && !searchQuery.trim() && <p>Type to search note contents</p>}
              {searchResults.map((result) => <button key={`${result.path}-${result.line}`} onClick={() => { void openFile(result.path, result.line); setSearchOpen(false) }}><strong>{result.name.replace(/\.(md|markdown|txt)$/i, '')}</strong><small>{displayLibraryPath(result.path)} · Line {result.line}</small><span>{result.excerpt}</span></button>)}
            </div>
          </section>
        </div>
      )}
      {nameDialog && (
        <NameDialog
          title={nameDialog.mode === 'create' ? ({ section: 'New section', folder: 'New folder', file: 'New note' } as const)[nameDialog.entryType] : 'Rename'}
          initialValue={nameDialog.mode === 'rename' ? nameDialog.entry.name.replace(/\.md$/i, '') : ''}
          confirmLabel={nameDialog.mode === 'create' ? 'Create' : 'Save'}
          busy={dialogBusy}
          onClose={() => { if (!dialogBusy) setNameDialog(null) }}
          onSubmit={(value) => void submitNameDialog(value)}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  )
}

function FileTextIcon() {
  return <span className="tab-file-icon">§</span>
}
