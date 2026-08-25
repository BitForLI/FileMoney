import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronRight,
  ArrowUpRight,
  FilePlus2,
  FolderPlus,
  Hash,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Layers3,
  X
} from 'lucide-react'
import type { BacklinkResult, EntryType, SearchResult, TreeEntry, WorkspaceSnapshot } from '../../shared/types'
import { EditorPane, type ViewMode } from './components/EditorPane'
import { DeleteDialog, NameDialog } from './components/EntryDialog'
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
  const [sidebarMode, setSidebarMode] = useState<'files' | 'search'>('files')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const stored = Number(localStorage.getItem('pagefold:right-panel-width'))
    return Number.isFinite(stored) && stored >= 220 && stored <= 420 ? stored : 260
  })
  const rightPanelPointer = useRef<number | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [backlinks, setBacklinks] = useState<BacklinkResult[]>([])
  const [rightLinkMode, setRightLinkMode] = useState<'backlinks' | 'outgoing'>('backlinks')
  const [rightPanelMode, setRightPanelMode] = useState<'links' | 'outline'>('links')
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('pagefold:view') as ViewMode) || 'split')
  const [jumpLine, setJumpLine] = useState<number | null>(null)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [toast, setToast] = useState('')
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TreeEntry | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const [rootDropActive, setRootDropActive] = useState(false)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const searchInput = useRef<HTMLInputElement>(null)

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null

  function notify(message: string): void {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }

  const openFile = useCallback(async (path: string, line?: number) => {
    if (!/\.(md|markdown|txt)$/i.test(path)) {
      notify('Only Markdown and text files can be edited')
      return
    }
    const existing = tabsRef.current.find((tab) => tab.path === path)
    if (!existing) {
      try {
        const content = await window.pagefold.readFile(path)
        const tab = { path, name: path.split('/').pop() ?? path, content, savedContent: content }
        setTabs((current) => [...current, tab])
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not open the file')
        return
      }
    }
    setActivePath(path)
    setJumpLine(null)
    if (line) window.requestAnimationFrame(() => setJumpLine(line))
  }, [])

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
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    const timer = window.setTimeout(() => {
      window.pagefold.search(query).then(setSearchResults).catch(() => notify('Search failed'))
    }, 220)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!activePath) {
      setBacklinks([])
      return
    }
    const timer = window.setTimeout(() => {
      window.pagefold.backlinks(activePath).then(setBacklinks).catch(() => setBacklinks([]))
    }, 280)
    return () => window.clearTimeout(timer)
  }, [activePath, activeTab?.savedContent])

  useEffect(() => {
    function keyboard(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'p') {
        event.preventDefault()
        setSidebarOpen(true)
        setSidebarMode('search')
        window.setTimeout(() => searchInput.current?.focus(), 0)
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [])

  async function refreshTree(): Promise<void> {
    const nextTree = await window.pagefold.refreshTree()
    setTree(nextTree)
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
    requestCreate('', 'file')
  }

  async function renameEntry(entry: TreeEntry, requested: string): Promise<boolean> {
    if (requested === entry.name || requested === entry.name.replace(/\.md$/i, '')) return true
    try {
      const nextPath = await window.pagefold.renameEntry(entry.path, requested)
      setTabs((current) => current.map((tab) => {
        const path = replacePathPrefix(tab.path, entry.path, nextPath)
        return { ...tab, path, name: path.split('/').pop() ?? path }
      }))
      setActivePath((current) => current ? replacePathPrefix(current, entry.path, nextPath) : current)
      setSelectedPath(nextPath)
      await refreshTree()
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Rename failed')
      return false
    }
  }

  async function moveEntry(sourcePath: string, targetFolder: string): Promise<void> {
    if (!sourcePath || sourcePath === targetFolder) return
    try {
      const nextPath = await window.pagefold.moveEntry(sourcePath, targetFolder)
      setTabs((current) => current.map((tab) => {
        const path = replacePathPrefix(tab.path, sourcePath, nextPath)
        return { ...tab, path, name: path.split('/').pop() ?? path }
      }))
      setActivePath((current) => current ? replacePathPrefix(current, sourcePath, nextPath) : current)
      setSelectedPath(nextPath)
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
      await window.pagefold.deleteEntry(entry.path)
      setTabs((current) => current.filter((tab) => tab.path !== entry.path && !tab.path.startsWith(`${entry.path}/`)))
      setActivePath((current) => current === entry.path || current?.startsWith(`${entry.path}/`) ? null : current)
      setSelectedPath('')
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

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return
    setDialogBusy(true)
    const completed = await deleteEntry(deleteTarget)
    setDialogBusy(false)
    if (completed) setDeleteTarget(null)
  }

  function updateContent(content: string): void {
    if (!activePath) return
    const path = activePath
    setTabs((current) => current.map((tab) => tab.path === path ? { ...tab, content } : tab))
    setSaveStatus('saving')
    clearTimeout(saveTimers.current[path])
    saveTimers.current[path] = setTimeout(async () => {
      try {
        await window.pagefold.writeFile(path, content)
        setTabs((current) => current.map((tab) => tab.path === path ? { ...tab, savedContent: content } : tab))
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
        notify('Auto-save failed. Check file permissions.')
      }
    }, 520)
  }

  function closeTab(path: string): void {
    const tab = tabsRef.current.find((item) => item.path === path)
    if (tab && tab.content !== tab.savedContent) void window.pagefold.writeFile(path, tab.content)
    const index = tabsRef.current.findIndex((item) => item.path === path)
    const remaining = tabsRef.current.filter((item) => item.path !== path)
    setTabs(remaining)
    if (activePath === path) setActivePath(remaining[Math.min(index, remaining.length - 1)]?.path ?? null)
  }

  async function attach(file: File): Promise<string> {
    if (!activePath) throw new Error('Open a note first')
    const result = await window.pagefold.saveAttachment({ notePath: activePath, fileName: file.name, bytes: await file.arrayBuffer() })
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
  const recentPaths = useMemo(() => Array.from(new Set([
    ...(activePath ? [activePath] : []),
    ...tabs.map((tab) => tab.path).reverse()
  ])), [activePath, tabs])
  const outgoingLinks = useMemo(
    () => activeTab ? extractOutgoingDocumentLinks(activeTab.content, activeTab.path) : [],
    [activeTab?.content, activeTab?.path]
  )
  const outline = useMemo(
    () => {
      if (!activeTab) return []
      const lines = activeTab.content.split(/\r?\n/)
      return extractDocumentLocations(activeTab.content)
        .filter((location) => location.kind === 'heading')
        .map((location) => ({
          ...location,
          level: lines[location.line - 1]?.match(/^(#{1,6})\s/)?.[1].length ?? 1
        }))
    },
    [activeTab?.content]
  )

  if (!workspace) return <main className="library-loading"><span>P</span><p>Preparing your library…</p><button onClick={() => void loadInitialWorkspace()}>Reload</button></main>

  return (
    <main
      className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'} ${rightPanelOpen ? '' : 'right-collapsed'}`}
      style={rightPanelOpen ? { gridTemplateColumns: `270px minmax(420px, 1fr) ${rightPanelWidth}px` } : undefined}
    >
      <header className="app-header">
        <div className="brand"><strong>Pagefold</strong></div>
        <div className="breadcrumb" aria-label="Current location">
          <span>{workspace.name}</span>
          {breadcrumb.map((part, index) => <span key={`${part}-${index}`}><ChevronRight size={13} />{displayEntryName(part.replace(/\.md$/i, ''))}</span>)}
        </div>
        <div className="header-actions">
          <button className="icon-button" onClick={() => setRightPanelOpen((value) => !value)} title="Links"><Link2 size={17} /></button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings (Ctrl+,)"><Settings size={17} /></button>
        </div>
      </header>

      <aside className="left-sidebar">
        <div className="sidebar-topline">
          <div className="workspace-name"><span>P</span><div><strong>{workspace.name}</strong></div></div>
          <button className="icon-button" onClick={() => setSidebarOpen(false)} title="Collapse sidebar"><PanelLeftClose size={17} /></button>
        </div>
        <div className="sidebar-tabs">
          <button className={sidebarMode === 'files' ? 'active' : ''} onClick={() => setSidebarMode('files')}><BookOpen size={15} />Files</button>
          <button className={sidebarMode === 'search' ? 'active' : ''} onClick={() => { setSidebarMode('search'); setTimeout(() => searchInput.current?.focus(), 0) }}><Search size={15} />Search</button>
        </div>
        {sidebarMode === 'files' ? (
          <>
            <div className="section-heading">
              <span>Library</span>
              <div className="library-create-buttons">
                <button onClick={createQuickNote} title="New note" aria-label="New note"><FilePlus2 size={14} /></button>
                <button onClick={() => requestCreate('', 'folder')} title="New folder" aria-label="New folder"><FolderPlus size={14} /></button>
                <button onClick={() => requestCreate('', 'section')} title="New section" aria-label="New section"><Layers3 size={14} /></button>
              </div>
            </div>
            <div
              className={`tree-scroll ${rootDropActive ? 'is-drop-target' : ''}`}
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
              <FileTree tree={tree} activePath={activePath} selectedPath={selectedPath} onSelect={(entry) => setSelectedPath(entry.path)} onOpen={(path) => void openFile(path)} onCreate={requestCreate} onRename={(entry) => setNameDialog({ mode: 'rename', entry })} onDelete={setDeleteTarget} onMove={(source, target) => void moveEntry(source, target)} onImport={(files, target) => void importMarkdownFiles(files, target)} />
            </div>
          </>
        ) : (
          <div className="search-panel">
            <div className="search-box"><Search size={15} /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search filenames and content…" /><kbd>Ctrl P</kbd></div>
            <div className="result-count">{query ? `${searchResults.length} ${searchResults.length === 1 ? 'match' : 'matches'}` : ''}</div>
            <div className="search-results">
              {searchResults.map((result, index) => <button key={`${result.path}-${result.line}-${index}`} onClick={() => void openFile(result.path, result.line)}><strong>{displayEntryName(result.name.replace(/\.md$/i, ''))}</strong><small>{displayLibraryPath(result.path)} · Line {result.line}</small><p>{result.excerpt}</p></button>)}
            </div>
          </div>
        )}
      </aside>

      {!sidebarOpen && <button className="sidebar-reveal icon-button" onClick={() => setSidebarOpen(true)} title="Expand sidebar"><PanelLeftOpen size={18} /></button>}

      <section className="workspace-stage">
        {tabs.length > 0 && (
          <div className="tab-strip">
            {tabs.map((tab) => <button key={tab.path} data-path={tab.path} className={tab.path === activePath ? 'active' : ''} onClick={() => { setActivePath(tab.path); setSelectedPath(tab.path) }}><FileTextIcon /><span>{tab.name.replace(/\.md$/i, '')}</span>{tab.content !== tab.savedContent && <i />}<b role="button" tabIndex={0} aria-label={`Close ${tab.name}`} onClick={(event) => { event.stopPropagation(); closeTab(tab.path) }}><X size={13} /></b></button>)}
          </div>
        )}
        {activeTab ? (
          <EditorPane path={activeTab.path} content={activeTab.content} tree={tree} recentPaths={recentPaths} mode={viewMode} jumpLine={jumpLine} onModeChange={setViewMode} onChange={updateContent} onWikiOpen={openWiki} onAttach={attach} />
        ) : (
          <div className="empty-editor">
            <div className="empty-number">{String(flattenMarkdownFiles(tree).length).padStart(2, '0')}</div>
            <button className="primary-button" onClick={createQuickNote}><FilePlus2 size={17} />New note</button>
          </div>
        )}
        <footer className="status-bar">
          <span>{activeTab ? `${activeTab.content.trim() ? activeTab.content.trim().split(/\s+/).length : 0} words · ${activeTab.content.length} characters` : 'Ready'}</span>
          <span className={`save-state ${saveStatus}`}><Check size={12} />{saveStatus === 'saving' ? 'Saving' : saveStatus === 'error' ? 'Save failed' : 'Saved locally'}</span>
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
        <div className="right-heading"><h3>{rightPanelMode === 'links' ? 'Links' : 'Outline'}</h3><button className="icon-button" onClick={() => setRightPanelOpen(false)} aria-label="Close links panel"><X size={16} /></button></div>
        <div className="right-panel-tabs">
          <button className={rightPanelMode === 'links' ? 'active' : ''} onClick={() => setRightPanelMode('links')}>Links</button>
          <button className={rightPanelMode === 'outline' ? 'active' : ''} onClick={() => setRightPanelMode('outline')}>Outline <span>{outline.length}</span></button>
        </div>
        {rightPanelMode === 'links' ? (
          <>
            <div className="connection-tabs">
              <button className={rightLinkMode === 'backlinks' ? 'active' : ''} onClick={() => setRightLinkMode('backlinks')}>Backlinks <span>{backlinks.length}</span></button>
              <button className={rightLinkMode === 'outgoing' ? 'active' : ''} onClick={() => setRightLinkMode('outgoing')}>Outgoing <span>{outgoingLinks.length}</span></button>
            </div>
            <div className="connection-list backlink-list">
              {!activePath ? <div className="backlink-empty">No note selected</div> : rightLinkMode === 'backlinks' ? (
                backlinks.length === 0 ? <div className="backlink-empty"><Hash size={19} />No backlinks</div> : backlinks.map((link, index) => <button key={`${link.path}-${link.line}-${index}`} onClick={() => void openFile(link.path, link.line)}><span><Link2 size={13} />{link.name.replace(/\.md$/i, '')}</span><small>{displayLibraryPath(link.path)} · Line {link.line}</small></button>)
              ) : (
                outgoingLinks.length === 0 ? <div className="backlink-empty"><ArrowUpRight size={19} />No outgoing links</div> : outgoingLinks.map((link) => <button key={`${link.kind}-${link.target}`} onClick={() => openWiki(link.target)}><span><ArrowUpRight size={13} />{link.label}</span><p>{displayLibraryPath(link.target)}</p><small>Line {link.line}</small></button>)
              )}
            </div>
          </>
        ) : (
          <div className="outline-list">
            {!activePath ? <div className="backlink-empty">No note selected</div> : outline.length === 0 ? <div className="backlink-empty">No headings</div> : outline.map((heading) => <button key={`${heading.line}-${heading.label}`} className={`outline-level-${heading.level}`} onClick={() => void openFile(activePath, heading.line)}><span>{heading.label}</span><small>Line {heading.line}</small></button>)}
          </div>
        )}
      </aside>

      {settingsOpen && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
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
      {deleteTarget && <DeleteDialog name={deleteTarget.name} busy={dialogBusy} onClose={() => { if (!dialogBusy) setDeleteTarget(null) }} onConfirm={() => void confirmDelete()} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  )
}

function FileTextIcon() {
  return <span className="tab-file-icon">§</span>
}
