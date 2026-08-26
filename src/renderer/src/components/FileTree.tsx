import { useState } from 'react'
import {
  ChevronRight,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers3,
  MoreHorizontal,
  Pencil,
  Trash2
} from 'lucide-react'
import type { EntryType, TreeEntry } from '../../../shared/types'
import { displayEntryName } from '../lib/markdown'

interface FileTreeProps {
  tree: TreeEntry[]
  activePath: string | null
  selectedPath: string
  onSelect: (entry: TreeEntry) => void
  onOpen: (path: string) => void
  onCreate: (parentPath: string, type: EntryType) => void
  onRename: (entry: TreeEntry) => void
  onDelete: (entry: TreeEntry) => void
  onMove: (sourcePath: string, targetFolder: string) => void
  onImport: (files: File[], targetFolder: string) => void
}

function droppedMarkdownFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files).filter((file) => /\.(md|markdown)$/i.test(file.name))
}

function ActionMenu({ entry, onRename, onDelete }: Pick<FileTreeProps, 'onRename' | 'onDelete'> & { entry: TreeEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="entry-menu-wrap">
      <button className="icon-button tree-more" aria-label={`Actions for ${displayEntryName(entry.name)}`} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}>
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <span className="tree-actions" onMouseLeave={() => setOpen(false)}>
          <button onClick={(event) => { event.stopPropagation(); setOpen(false); onRename(entry) }}><Pencil size={13} />Rename</button>
          <button className="danger" onClick={(event) => { event.stopPropagation(); setOpen(false); onDelete(entry) }}><Trash2 size={13} />Delete</button>
        </span>
      )}
    </span>
  )
}

function NoteRow({ entry, props }: { entry: TreeEntry; props: FileTreeProps }) {
  const active = props.activePath === entry.path
  const selected = props.selectedPath === entry.path
  return (
    <div
      className={`tree-row note-row ${active ? 'is-current-note' : ''} ${selected ? 'is-selected' : ''}`}
      data-entry-path={entry.path}
      role="treeitem"
      aria-selected={selected}
      aria-current={active ? 'page' : undefined}
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/pagefold-path', entry.path)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => { props.onSelect(entry); props.onOpen(entry.path) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { props.onSelect(entry); props.onOpen(entry.path) }
      }}
    >
      <span className="tree-name" title={displayEntryName(entry.name.replace(/\.md$/i, ''))}>{displayEntryName(entry.name.replace(/\.md$/i, ''))}</span>
      <ActionMenu entry={entry} onRename={props.onRename} onDelete={props.onDelete} />
    </div>
  )
}

function CreateButtons({ parent, props }: { parent: string; props: FileTreeProps }) {
  return (
    <span className="container-create-buttons">
      <button className="icon-button tree-add" aria-label="New note" title="New note" onClick={(event) => { event.stopPropagation(); props.onCreate(parent, 'file') }}><FilePlus2 size={12} /></button>
      <button className="icon-button tree-add" aria-label="New folder" title="New folder" onClick={(event) => { event.stopPropagation(); props.onCreate(parent, 'folder') }}><FolderPlus size={12} /></button>
    </span>
  )
}

function FolderGroup({ entry, props }: { entry: TreeEntry; props: FileTreeProps }) {
  const [open, setOpen] = useState(true)
  const [dropActive, setDropActive] = useState(false)
  const selected = props.selectedPath === entry.path
  const current = selected || props.selectedPath.startsWith(`${entry.path}/`)
  return (
    <div className={`folder-group ${current ? 'is-current-folder' : ''}`}>
      <div
        className={`tree-row folder-row ${selected ? 'is-selected' : ''} ${dropActive ? 'is-drop-target' : ''}`}
        role="treeitem"
        aria-expanded={open}
        aria-selected={selected}
        tabIndex={0}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('text/pagefold-path', entry.path)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') ? 'copy' : 'move'
          setDropActive(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDropActive(false)
          const source = event.dataTransfer.getData('text/pagefold-path')
          if (source) props.onMove(source, entry.path)
          else {
            const files = droppedMarkdownFiles(event.dataTransfer)
            if (files.length) props.onImport(files, entry.path)
          }
        }}
        onClick={() => { props.onSelect(entry); setOpen((value) => !value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') { props.onSelect(entry); setOpen((value) => !value) }
        }}
      >
        <ChevronRight className={`tree-chevron ${open ? 'is-open' : ''}`} size={13} />
        {open ? <FolderOpen size={14} /> : <Folder size={14} />}
        <strong className="tree-name folder-name" title={displayEntryName(entry.name)}>{displayEntryName(entry.name)}</strong>
        <CreateButtons parent={entry.path} props={props} />
        <ActionMenu entry={entry} onRename={props.onRename} onDelete={props.onDelete} />
      </div>
      {open && <div className="folder-contents">{(entry.children ?? []).map((child, childIndex) => renderEntry(child, props, childIndex))}</div>}
    </div>
  )
}

function SectionGroup({ entry, index, props }: { entry: TreeEntry; index: number; props: FileTreeProps }) {
  const [open, setOpen] = useState(true)
  const [dropActive, setDropActive] = useState(false)
  const selected = props.selectedPath === entry.path
  const current = selected || props.selectedPath.startsWith(`${entry.path}/`)
  return (
    <section className={`library-section section-tone-${index % 4} ${current ? 'is-current-section' : ''}`}>
      <div
        className={`section-row ${selected ? 'is-selected' : ''} ${dropActive ? 'is-drop-target' : ''}`}
        role="treeitem"
        aria-expanded={open}
        aria-selected={selected}
        tabIndex={0}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') ? 'copy' : 'move'
          setDropActive(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setDropActive(false)
          const source = event.dataTransfer.getData('text/pagefold-path')
          if (source) props.onMove(source, entry.path)
          else {
            const files = droppedMarkdownFiles(event.dataTransfer)
            if (files.length) props.onImport(files, entry.path)
          }
        }}
        onClick={() => { props.onSelect(entry); setOpen((value) => !value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') { props.onSelect(entry); setOpen((value) => !value) }
        }}
      >
        <Layers3 className="section-icon" size={16} />
        <strong title={displayEntryName(entry.name)}>{displayEntryName(entry.name)}</strong>
        <ChevronRight className={`section-chevron ${open ? 'is-open' : ''}`} size={14} />
        <CreateButtons parent={entry.path} props={props} />
        <ActionMenu entry={entry} onRename={props.onRename} onDelete={props.onDelete} />
      </div>
      {open && <div className="section-contents">{(entry.children ?? []).map((child, childIndex) => renderEntry(child, props, childIndex))}</div>}
    </section>
  )
}

function renderEntry(entry: TreeEntry, props: FileTreeProps, index = 0) {
  if (entry.type === 'section') return <SectionGroup key={entry.path} entry={entry} index={index} props={props} />
  if (entry.type === 'folder') return <FolderGroup key={entry.path} entry={entry} props={props} />
  return <NoteRow key={entry.path} entry={entry} props={props} />
}

export function FileTree(props: FileTreeProps) {
  return (
    <div className="file-tree library-tree" role="tree" aria-label="Library">
      {props.tree.map((entry, index) => renderEntry(entry, props, index))}
    </div>
  )
}
