import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Bold, Braces, ChevronLeft, ClipboardPaste, Code2, Columns2, Copy, Eye, Heading1, Highlighter, Italic, Link2, List as ListIcon, Palette, PenLine, Quote, Scissors, Search, Strikethrough, TextSelect, Type } from 'lucide-react'
import type { TreeEntry } from '../../../shared/types'
import {
  buildDocumentJumpTarget,
  buildWikiLink,
  displayEntryName,
  displayLibraryPath,
  extractDocumentLocations,
  findSourceTextRange,
  findWikiMatch,
  flattenMarkdownFiles,
  insertWikiTarget,
  offsetForLine,
  resolveRelativeNotePath,
  renderableMarkdown
} from '../lib/markdown'
import type { DocumentLocation } from '../lib/markdown'

export type ViewMode = 'edit' | 'split' | 'preview'

interface EditorPaneProps {
  path: string
  content: string
  tree: TreeEntry[]
  recentPaths: string[]
  mode: ViewMode
  jumpLine: number | null
  onModeChange: (mode: ViewMode) => void
  onChange: (content: string) => void
  onWikiOpen: (target: string) => void
  onAttach: (file: File) => Promise<string>
}

interface SelectionRange {
  start: number
  end: number
}

interface ContextMenuState extends SelectionRange {
  x: number
  y: number
  selectedText: string
  source: 'editor' | 'preview'
  editable: boolean
}

export function LocationMarkdown({ source, onDoubleClick }: { source: string; onDoubleClick?: () => void }) {
  return (
    <span onDoubleClick={onDoubleClick}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => <span>{children}</span>,
          h1: ({ children }) => <span>{children}</span>,
          h2: ({ children }) => <span>{children}</span>,
          h3: ({ children }) => <span>{children}</span>,
          h4: ({ children }) => <span>{children}</span>,
          h5: ({ children }) => <span>{children}</span>,
          h6: ({ children }) => <span>{children}</span>,
          ul: ({ children }) => <span>{children}</span>,
          ol: ({ children }) => <span>{children}</span>,
          li: ({ children }) => <span>{children}</span>,
          blockquote: ({ children }) => <span>{children}</span>,
          pre: ({ children }) => <span className="link-location-code">{children}</span>,
          a: ({ children }) => <span>{children}</span>,
          img: ({ alt }) => <span>{alt || 'Image'}</span>
        }}
      >
        {renderableMarkdown(source)}
      </ReactMarkdown>
    </span>
  )
}

export function EditorPane({ path, content, tree, recentPaths, mode, jumpLine, onModeChange, onChange, onWikiOpen, onAttach }: EditorPaneProps) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const preview = useRef<HTMLElement>(null)
  const editorStage = useRef<HTMLDivElement>(null)
  const splitPointer = useRef<number | null>(null)
  const [cursor, setCursor] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [linkSelection, setLinkSelection] = useState<SelectionRange | null>(null)
  const [linkQuery, setLinkQuery] = useState('')
  const [linkTargetNote, setLinkTargetNote] = useState<TreeEntry | null>(null)
  const [linkLocations, setLinkLocations] = useState<DocumentLocation[]>([])
  const [linkLocationsBusy, setLinkLocationsBusy] = useState(false)
  const [styleMenu, setStyleMenu] = useState<'color' | 'font' | null>(null)
  const [splitPercent, setSplitPercent] = useState(() => {
    const stored = Number(window.localStorage.getItem('pagefold:split-percent'))
    return Number.isFinite(stored) && stored >= 15 && stored <= 85 ? stored : 50
  })
  const [splitDragging, setSplitDragging] = useState(false)
  const wikiMatch = findWikiMatch(content, cursor)
  const notes = useMemo(() => flattenMarkdownFiles(tree), [tree])
  const suggestions = wikiMatch
    ? notes.filter((note) => note.path !== path && note.name.toLocaleLowerCase().includes(wikiMatch.query.toLocaleLowerCase())).slice(0, 7)
    : []
  const linkChoices = useMemo(() => {
    const available = notes.filter((note) => note.path !== path)
    const searchTerm = linkQuery.trim().toLocaleLowerCase()
    if (searchTerm) {
      return available.filter((note) => `${note.name} ${note.path}`.toLocaleLowerCase().includes(searchTerm)).slice(0, 12)
    }
    const byPath = new Map(available.map((note) => [note.path, note]))
    const recent = recentPaths.map((recentPath) => byPath.get(recentPath)).filter((note): note is TreeEntry => Boolean(note))
    const recentSet = new Set(recent.map((note) => note.path))
    return [...recent, ...available.filter((note) => !recentSet.has(note.path))].slice(0, 8)
  }, [linkQuery, notes, path, recentPaths])
  const linkLocationChoices = useMemo(() => {
    const searchTerm = linkQuery.trim().toLocaleLowerCase()
    if (!searchTerm) return linkLocations.filter((location) => location.kind === 'heading').slice(0, 120)
    return linkLocations.filter((location) => `${location.label} line ${location.line}`.toLocaleLowerCase().includes(searchTerm)).slice(0, 120)
  }, [linkLocations, linkQuery])

  useEffect(() => {
    if (!jumpLine) return
    if (textarea.current) {
      const start = offsetForLine(content, jumpLine)
      const end = content.indexOf('\n', start)
      textarea.current.focus()
      textarea.current.setSelectionRange(start, end >= 0 ? end : content.length)
      const lineHeight = Number.parseFloat(window.getComputedStyle(textarea.current).lineHeight) || 26
      const paddingTop = Number.parseFloat(window.getComputedStyle(textarea.current).paddingTop) || 0
      textarea.current.scrollTop = Math.max(0, (jumpLine - 1) * lineHeight + paddingTop)
    }
    const frame = window.requestAnimationFrame(() => {
      const candidates = Array.from(preview.current?.querySelectorAll<HTMLElement>('[data-source-line]') ?? [])
      const target = candidates.find((element) => Number(element.dataset.sourceLine) === jumpLine)
        ?? candidates.filter((element) => Number(element.dataset.sourceLine) <= jumpLine).at(-1)
      if (!target) return
      target.scrollIntoView({ block: 'center' })
      target.classList.remove('is-jump-target')
      window.requestAnimationFrame(() => target.classList.add('is-jump-target'))
      window.setTimeout(() => target.classList.remove('is-jump-target'), 1800)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [jumpLine, content, mode])

  useEffect(() => {
    window.localStorage.setItem('pagefold:split-percent', String(splitPercent))
  }, [splitPercent])

  useEffect(() => () => document.body.classList.remove('is-resizing-split'), [])

  function clampSplitPercent(value: number): number {
    const stageWidth = editorStage.current?.getBoundingClientRect().width ?? 0
    const minimum = stageWidth > 0
      ? Math.min(45, Math.max(15, 260 / Math.max(1, stageWidth - 9) * 100))
      : 20
    return Math.min(100 - minimum, Math.max(minimum, value))
  }

  function resizeSplit(clientX: number): void {
    const bounds = editorStage.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 9) return
    setSplitPercent(clampSplitPercent((clientX - bounds.left - 4.5) / (bounds.width - 9) * 100))
  }

  function finishSplitResize(target: HTMLDivElement, pointerId: number): void {
    if (splitPointer.current !== pointerId) return
    splitPointer.current = null
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
    document.body.classList.remove('is-resizing-split')
    setSplitDragging(false)
  }

  function insertText(text: string): void {
    const element = textarea.current
    const start = element?.selectionStart ?? content.length
    const end = element?.selectionEnd ?? start
    const next = `${content.slice(0, start)}${text}${content.slice(end)}`
    onChange(next)
    requestAnimationFrame(() => {
      const nextCursor = start + text.length
      element?.focus()
      element?.setSelectionRange(nextCursor, nextCursor)
      setCursor(nextCursor)
    })
  }

  function replaceRange(range: SelectionRange, text: string): void {
    const next = `${content.slice(0, range.start)}${text}${content.slice(range.end)}`
    const nextCursor = range.start + text.length
    onChange(next)
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(nextCursor, nextCursor)
      setCursor(nextCursor)
    })
  }

  function wrapSelection(before: string, after: string, placeholder: string): void {
    const element = textarea.current
    const start = element?.selectionStart ?? content.length
    const end = element?.selectionEnd ?? start
    const selected = content.slice(start, end) || placeholder
    const insertion = `${before}${selected}${after}`
    onChange(`${content.slice(0, start)}${insertion}${content.slice(end)}`)
    requestAnimationFrame(() => {
      const selectionStart = start + before.length
      const selectionEnd = selectionStart + selected.length
      element?.focus()
      element?.setSelectionRange(selectionStart, selectionEnd)
      setCursor(selectionEnd)
    })
  }

  function prefixSelectedLines(prefix: string): void {
    const element = textarea.current
    const selectionStart = element?.selectionStart ?? content.length
    const selectionEnd = element?.selectionEnd ?? selectionStart
    const start = content.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
    const nextBreak = content.indexOf('\n', selectionEnd)
    const end = nextBreak < 0 ? content.length : nextBreak
    const selected = content.slice(start, end)
    replaceRange({ start, end }, selected.split('\n').map((line) => `${prefix}${line}`).join('\n'))
  }

  async function copyContextSelection(menu: ContextMenuState): Promise<void> {
    await window.pagefold.writeClipboardText(menu.selectedText)
  }

  async function pasteSelection(range: SelectionRange): Promise<void> {
    replaceRange(range, await window.pagefold.readClipboardText())
  }

  function selectAll(source: ContextMenuState['source']): void {
    if (source === 'preview' && preview.current) {
      const range = document.createRange()
      range.selectNodeContents(preview.current)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      setContextMenu(null)
      return
    }
    textarea.current?.focus()
    textarea.current?.select()
    setCursor(content.length)
    setContextMenu(null)
  }

  function closeLinkPicker(): void {
    setLinkSelection(null)
    setLinkTargetNote(null)
    setLinkLocations([])
    setLinkLocationsBusy(false)
    setLinkQuery('')
  }

  function previewJump(line: number | null | undefined): void {
    if (!line || !Number.isFinite(line) || line <= 0) return
    onWikiOpen(`${path}#L${line}`)
  }

  function jumpFromPreviewElement(event: React.MouseEvent<HTMLElement>): void {
    let element: HTMLElement | null = event.target instanceof HTMLElement ? event.target : null
    let line = Number.NaN
    while (element && event.currentTarget.contains(element)) {
      line = Number(element.dataset.sourceLine)
      if (Number.isFinite(line) && line > 0) break
      element = element.parentElement
    }
    if (!Number.isFinite(line) || line <= 0) return
    event.preventDefault()
    event.stopPropagation()
    previewJump(line)
  }

  async function chooseLinkDocument(note: TreeEntry): Promise<void> {
    setLinkTargetNote(note)
    setLinkQuery('')
    setLinkLocations([])
    setLinkLocationsBusy(true)
    try {
      setLinkLocations(extractDocumentLocations(await window.pagefold.readFile(note.path)))
    } catch {
      setLinkLocations([])
    } finally {
      setLinkLocationsBusy(false)
    }
  }

  function openLocation(note: TreeEntry, line?: number): void {
    closeLinkPicker()
    onWikiOpen(buildDocumentJumpTarget(note.path, line))
  }

  function chooseLink(note: TreeEntry, line?: number): void {
    if (!linkSelection) return
    const selectedText = content.slice(linkSelection.start, linkSelection.end)
    replaceRange(linkSelection, buildWikiLink(note.path, selectedText, line ? `L${line}` : ''))
    closeLinkPicker()
  }

  async function attachFiles(files: File[]): Promise<void> {
    for (const file of files.filter((item) => item.type.startsWith('image/'))) {
      const markdownPath = await onAttach(file)
      insertText(`![${file.name}](${markdownPath})`)
    }
  }

  function chooseSuggestion(target: string): void {
    if (!wikiMatch) return
    const result = insertWikiTarget(content, wikiMatch, target.replace(/\.md$/i, ''))
    onChange(result.content)
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(result.cursor, result.cursor)
      setCursor(result.cursor)
    })
  }

  return (
    <section className={`editor-shell ${mode !== 'preview' ? 'has-format-toolbar' : ''}`}>
      <div className="editor-toolbar">
        <span className="document-path">{displayLibraryPath(path)}</span>
        <div className="mode-switch" aria-label="Editor mode">
          <button className={mode === 'edit' ? 'active' : ''} onClick={() => onModeChange('edit')} title="Edit"><PenLine size={15} /></button>
          <button className={mode === 'split' ? 'active' : ''} onClick={() => onModeChange('split')} title="Split"><Columns2 size={15} /></button>
          <button className={mode === 'preview' ? 'active' : ''} onClick={() => onModeChange('preview')} title="Preview"><Eye size={15} /></button>
        </div>
      </div>
      {mode !== 'preview' && (
        <div className="format-toolbar" aria-label="Markdown formatting">
          <div className="format-group">
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('**', '**', 'bold text')} title="Bold" aria-label="Bold"><Bold size={14} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('*', '*', 'italic text')} title="Italic" aria-label="Italic"><Italic size={14} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('~~', '~~', 'strikethrough text')} title="Strikethrough" aria-label="Strikethrough"><Strikethrough size={14} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('`', '`', 'code')} title="Inline code" aria-label="Inline code"><Code2 size={14} /></button>
          </div>
          <div className="format-group">
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => prefixSelectedLines('# ')} title="Heading 1" aria-label="Heading 1"><Heading1 size={14} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => prefixSelectedLines('- ')} title="List" aria-label="List"><ListIcon size={14} /></button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => prefixSelectedLines('> ')} title="Blockquote" aria-label="Blockquote"><Quote size={14} /></button>
          </div>
          <div className="format-group format-style-group">
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('<mark>', '</mark>', 'highlighted text')} title="Highlight" aria-label="Highlight"><Highlighter size={14} /></button>
            <span className="format-popover-wrap">
              <button className={styleMenu === 'color' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => setStyleMenu((current) => current === 'color' ? null : 'color')} title="Text color" aria-label="Text color"><Palette size={14} /></button>
              {styleMenu === 'color' && (
                <span className="format-popover color-popover">
                  {(['red', 'amber', 'green', 'blue', 'violet', 'muted'] as const).map((color) => <button key={color} className={`color-swatch color-${color}`} aria-label={`${color} text`} onMouseDown={(event) => event.preventDefault()} onClick={() => { wrapSelection(`<span data-pf-color="${color}">`, '</span>', 'colored text'); setStyleMenu(null) }} />)}
                </span>
              )}
            </span>
            <span className="format-popover-wrap">
              <button className={styleMenu === 'font' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => setStyleMenu((current) => current === 'font' ? null : 'font')} title="Font" aria-label="Font"><Type size={14} /></button>
              {styleMenu === 'font' && (
                <span className="format-popover font-popover">
                  {([['serif', 'Serif'], ['sans', 'Sans serif'], ['mono', 'Monospace'], ['hand', 'Handwriting']] as const).map(([font, label]) => <button key={font} className={`font-option font-${font}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { wrapSelection(`<span data-pf-font="${font}">`, '</span>', 'text'); setStyleMenu(null) }}>{label}</button>)}
                </span>
              )}
            </span>
          </div>
        </div>
      )}
      <div
        ref={editorStage}
        className={`editor-stage mode-${mode}${splitDragging ? ' is-resizing' : ''}`}
        style={mode === 'split' ? { gridTemplateColumns: `minmax(260px, ${splitPercent}fr) 9px minmax(260px, ${100 - splitPercent}fr)` } : undefined}
      >
        {mode !== 'preview' && (
          <div className="source-wrap">
            <textarea
              ref={textarea}
              value={content}
              spellCheck={false}
              aria-label="Markdown editor"
              onContextMenu={(event) => {
                event.preventDefault()
                setContextMenu({
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                  x: Math.min(event.clientX, window.innerWidth - 190),
                  y: Math.min(event.clientY, window.innerHeight - 235),
                  selectedText: event.currentTarget.value.slice(event.currentTarget.selectionStart, event.currentTarget.selectionEnd),
                  source: 'editor',
                  editable: true
                })
              }}
              onChange={(event) => {
                onChange(event.target.value)
                setCursor(event.target.selectionStart)
              }}
              onClick={(event) => setCursor(event.currentTarget.selectionStart)}
              onKeyUp={(event) => setCursor(event.currentTarget.selectionStart)}
              onPaste={(event) => {
                const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
                if (images.length) {
                  event.preventDefault()
                  void attachFiles(images)
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const images = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'))
                if (images.length) {
                  event.preventDefault()
                  void attachFiles(images)
                }
              }}
            />
            {suggestions.length > 0 && (
              <div className="wiki-suggestions">
                <div className="suggestion-label"><Link2 size={12} />Link to note</div>
                {suggestions.map((note) => (
                  <button key={note.path} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuggestion(note.path)}>
                    <span>{displayEntryName(note.name.replace(/\.md$/i, ''))}</span><small>{displayLibraryPath(note.path)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {mode === 'split' && (
          <div
            className="split-resizer"
            role="separator"
            aria-label="Resize editor and preview"
            aria-orientation="vertical"
            aria-valuemin={15}
            aria-valuemax={85}
            aria-valuenow={Math.round(splitPercent)}
            tabIndex={0}
            title="Drag to resize · Double-click to reset"
            onDoubleClick={() => setSplitPercent(50)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setSplitPercent((current) => clampSplitPercent(current - 2))
              else if (event.key === 'ArrowRight') setSplitPercent((current) => clampSplitPercent(current + 2))
              else if (event.key === 'Home') setSplitPercent(clampSplitPercent(15))
              else if (event.key === 'End') setSplitPercent(clampSplitPercent(85))
              else return
              event.preventDefault()
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              splitPointer.current = event.pointerId
              event.currentTarget.setPointerCapture(event.pointerId)
              document.body.classList.add('is-resizing-split')
              setSplitDragging(true)
              resizeSplit(event.clientX)
            }}
            onPointerMove={(event) => {
              if (splitPointer.current === event.pointerId) resizeSplit(event.clientX)
            }}
            onPointerUp={(event) => finishSplitResize(event.currentTarget, event.pointerId)}
            onPointerCancel={(event) => finishSplitResize(event.currentTarget, event.pointerId)}
          >
            <span aria-hidden="true" />
          </div>
        )}
        {mode !== 'edit' && (
          <article
            ref={preview}
            className="markdown-preview"
            aria-label="Markdown preview"
            onDoubleClick={jumpFromPreviewElement}
            onContextMenu={(event) => {
              event.preventDefault()
              const selection = window.getSelection()
              const selectedRange = selection?.rangeCount ? selection.getRangeAt(0) : null
              const selectedText = selectedRange && event.currentTarget.contains(selectedRange.commonAncestorContainer) ? selection?.toString() ?? '' : ''
              let occurrence = 0
              if (selectedRange && selectedText) {
                const precedingRange = document.createRange()
                precedingRange.selectNodeContents(event.currentTarget)
                precedingRange.setEnd(selectedRange.startContainer, selectedRange.startOffset)
                const precedingText = precedingRange.toString()
                let offset = precedingText.indexOf(selectedText)
                while (offset >= 0) {
                  occurrence += 1
                  offset = precedingText.indexOf(selectedText, offset + selectedText.length)
                }
              }
              const sourceRange = findSourceTextRange(content, selectedText, occurrence)
              setContextMenu({
                start: sourceRange?.start ?? cursor,
                end: sourceRange?.end ?? cursor,
                x: Math.min(event.clientX, window.innerWidth - 190),
                y: Math.min(event.clientY, window.innerHeight - 235),
                selectedText,
                source: 'preview',
                editable: Boolean(sourceRange)
              })
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
              components={{
                a: ({ href, children }) => (
                  href?.startsWith('#pf-style:')
                    ? <span className={`pf-${href.slice(10)}`}>{children}</span>
                    : <a
                        href={href}
                        onClick={(event) => {
                          if (href?.startsWith('#wiki:')) {
                            event.preventDefault()
                            onWikiOpen(decodeURIComponent(href.slice(6)))
                          } else if (href && /\.(md|markdown|txt)(?:#.*)?$/i.test(href)) {
                            event.preventDefault()
                            const [linkedPath, fragment] = href.split('#', 2)
                            const resolved = resolveRelativeNotePath(path, decodeURIComponent(linkedPath))
                            onWikiOpen(fragment ? `${resolved}#${decodeURIComponent(fragment)}` : resolved)
                          }
                        }}
                      >{children}</a>
                ),
                h1: ({ node, children }) => <h1 data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</h1>,
                h2: ({ node, children }) => <h2 data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</h2>,
                h3: ({ node, children }) => <h3 data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</h3>,
                h4: ({ node, children }) => <h4 data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</h4>,
                h5: ({ node, children }) => <h5 data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</h5>,
                h6: ({ node, children }) => <h6 data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</h6>,
                p: ({ node, children }) => <p data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</p>,
                li: ({ node, children }) => <li data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</li>,
                blockquote: ({ node, children }) => <blockquote data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</blockquote>,
                pre: ({ node, children }) => <pre data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</pre>,
                div: ({ node, children }) => <div data-source-line={node?.position?.start.line} onDoubleClick={jumpFromPreviewElement}>{children}</div>,
                img: ({ src, alt }) => {
                  const resolved = resolveRelativeNotePath(path, src ?? '')
                  const imageSource = /^(data:|blob:|https?:)/i.test(resolved)
                    ? resolved
                    : `vault:///asset?path=${encodeURIComponent(resolved)}`
                  return <img src={imageSource} alt={alt ?? ''} />
                },
                code: ({ children, className }) => <code className={className}><Braces size={12} aria-hidden="true" />{children}</code>
              }}
            >
              {renderableMarkdown(content)}
            </ReactMarkdown>
          </article>
        )}
      </div>
      {contextMenu && (
        <div className="editor-context-layer" onMouseDown={() => setContextMenu(null)}>
          <div className="editor-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
            <button disabled={!contextMenu.editable} onClick={() => { setLinkSelection(contextMenu); setLinkTargetNote(null); setLinkLocations([]); setLinkQuery(''); setContextMenu(null) }}><Link2 size={14} />Link to document</button>
            <span />
            <button disabled={!contextMenu.selectedText} onClick={() => { void copyContextSelection(contextMenu); setContextMenu(null) }}><Copy size={14} />Copy</button>
            <button disabled={!contextMenu.editable || !contextMenu.selectedText} onClick={() => { void copyContextSelection(contextMenu).then(() => replaceRange(contextMenu, '')); setContextMenu(null) }}><Scissors size={14} />Cut</button>
            <button disabled={!contextMenu.editable} onClick={() => { void pasteSelection(contextMenu); setContextMenu(null) }}><ClipboardPaste size={14} />Paste</button>
            <span />
            <button onClick={() => selectAll(contextMenu.source)}><TextSelect size={14} />Select all</button>
          </div>
        </div>
      )}
      {linkSelection && (
        <div className="link-picker-backdrop" onMouseDown={closeLinkPicker}>
          <section className="link-picker" role="dialog" aria-modal="true" aria-label="Link to document" onMouseDown={(event) => event.stopPropagation()}>
            <div className="link-picker-search">
              {linkTargetNote && <button className="link-picker-back" onClick={() => { setLinkTargetNote(null); setLinkLocations([]); setLinkQuery('') }} aria-label="Back to documents"><ChevronLeft size={16} /></button>}
              <Search size={15} />
              <input
                autoFocus
                value={linkQuery}
                onChange={(event) => setLinkQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  if (linkTargetNote) { setLinkTargetNote(null); setLinkLocations([]); setLinkQuery('') } else closeLinkPicker()
                }}
                placeholder={linkTargetNote ? 'Search this document' : 'Search documents'}
              />
            </div>
            <div className="link-picker-label">{linkTargetNote ? `${linkQuery.trim() ? 'Search results' : 'Headings'} in ${displayEntryName(linkTargetNote.name.replace(/\.(md|markdown|txt)$/i, ''))}` : linkQuery.trim() ? 'Search results' : 'Recent documents'}</div>
            <div className="link-picker-results">
              {!linkTargetNote && linkChoices.map((note) => <button key={note.path} onClick={() => void chooseLinkDocument(note)}><span>{displayEntryName(note.name.replace(/\.(md|markdown|txt)$/i, ''))}</span><small>{displayLibraryPath(note.path)}</small></button>)}
              {!linkTargetNote && linkChoices.length === 0 && <div className="link-picker-empty">No matching documents</div>}
              {linkTargetNote && <button className="link-location-whole" onClick={() => chooseLink(linkTargetNote)} onDoubleClick={() => openLocation(linkTargetNote)}><span><b>↗</b>Whole document</span><small>Open at top</small></button>}
              {linkTargetNote && linkLocationChoices.map((location) => (
                <button
                  key={`${location.line}-${location.kind}`}
                  className="link-location"
                  onClick={(event) => {
                    if (event.detail === 2) {
                      event.preventDefault()
                      event.stopPropagation()
                      openLocation(linkTargetNote, location.line)
                      return
                    }
                    chooseLink(linkTargetNote, location.line)
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    openLocation(linkTargetNote, location.line)
                  }}
                >
                  <span className="link-location-content"><b>{location.kind === 'heading' ? '#' : '¶'}</b><span className="link-location-rendered"><LocationMarkdown source={location.markdown} onDoubleClick={() => openLocation(linkTargetNote, location.line)} /></span></span><small>Line {location.line}</small>
                </button>
              ))}
              {linkTargetNote && linkLocationsBusy && <div className="link-picker-empty">Reading document…</div>}
              {linkTargetNote && !linkLocationsBusy && linkLocationChoices.length === 0 && <div className="link-picker-empty">{linkQuery.trim() ? 'No matching content' : 'No headings in this document'}</div>}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
