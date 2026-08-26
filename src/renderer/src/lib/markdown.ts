import type { TreeEntry } from '../../../shared/types'

const LEGACY_DISPLAY_NAMES: Record<string, string> = {
  '我的笔记': 'My Notes',
  '你的笔记': 'Your Notes'
}

export interface WikiMatch {
  query: string
  start: number
  end: number
}

export interface OutgoingDocumentLink {
  target: string
  label: string
  line: number
  kind: 'wiki' | 'markdown'
}

export interface TextRange {
  start: number
  end: number
}

export interface EditableDocumentLink extends TextRange {
  target: string
  label: string
  kind: 'wiki' | 'markdown'
}

export interface DocumentLocation {
  line: number
  label: string
  markdown: string
  kind: 'heading' | 'paragraph'
}

export function displayEntryName(name: string): string {
  return LEGACY_DISPLAY_NAMES[name] ?? name
}

export function displayLibraryPath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .map(displayEntryName)
    .join('/')
}

export function flattenMarkdownFiles(tree: TreeEntry[]): TreeEntry[] {
  return tree.flatMap((entry) => {
    if (entry.type !== 'file') return flattenMarkdownFiles(entry.children ?? [])
    return /\.(md|markdown|txt)$/i.test(entry.name) ? [entry] : []
  })
}

export function buildWikiLink(targetPath: string, alias = '', anchor = ''): string {
  const normalized = targetPath.replaceAll('\\', '/')
  const hashIndex = normalized.indexOf('#')
  const path = (hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized).replace(/\.(md|markdown|txt)$/i, '')
  const existingAnchor = hashIndex >= 0 ? normalized.slice(hashIndex + 1) : ''
  const fragment = anchor.trim() || existingAnchor.trim()
  const target = fragment ? `${path}#${fragment}` : path
  const label = alias.trim()
  return label ? `[[${target}|${label}]]` : `[[${target}]]`
}

export function buildDocumentJumpTarget(path: string, line?: number): string {
  const normalized = path.replaceAll('\\', '/')
  return typeof line === 'number' && line > 0 ? `${normalized}#L${line}` : normalized
}

export function extractDocumentLocations(content: string): DocumentLocation[] {
  const locations: DocumentLocation[] = []
  const lines = content.split(/\r?\n/)

  function addLocation(line: number, source: string, kind: DocumentLocation['kind']): void {
    const label = source
      .replace(/^(?:```|~~~)[^\n]*\n?/, '')
      .replace(/\n?(?:```|~~~)\s*$/, '')
      .replace(/^\$\$\s*/, '')
      .replace(/\s*\$\$$/, '')
      .replace(/^>\s*/, '')
      .replace(/^(?:[-*+] |\d+[.)]\s+)/, '')
      .replace(/^\[[ xX]\]\s*/, '')
      .replace(/!?(?:\[([^\]]+)\])\([^)]+\)/g, '$1')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_whole, target: string, alias?: string) => alias || target)
      .replace(/<[^>]+>/g, '')
      .replace(/[*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!label) return
    locations.push({ line, label: label.slice(0, 1000), markdown: source.slice(0, 700), kind })
  }

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (!trimmed || /^(?:---+|\*\*\*+)$/.test(trimmed)) continue
    if (/^(?:```|~~~)/.test(trimmed)) {
      const line = index + 1
      const marker = trimmed.slice(0, 3)
      let source = lines[index]
      while (index + 1 < lines.length) {
        index += 1
        source += `\n${lines[index]}`
        if (lines[index].trim().startsWith(marker)) break
      }
      addLocation(line, source, 'paragraph')
      continue
    }
    if (trimmed === '$$') {
      const line = index + 1
      let source = lines[index]
      while (index + 1 < lines.length) {
        index += 1
        source += `\n${lines[index]}`
        if (lines[index].trim() === '$$') break
      }
      addLocation(line, source, 'paragraph')
      continue
    }
    const heading = trimmed.match(/^#{1,6}\s+(.+?)\s*#*$/)
    const line = index + 1
    let source = heading?.[1] ?? trimmed
    if (!heading && !/^(?:>|[-*+] |\d+[.)]\s+)/.test(trimmed)) {
      while (index + 1 < lines.length) {
        const next = lines[index + 1].trim()
        if (!next || /^(?:#{1,6}\s+|```|~~~|\$\$|>|[-*+] |\d+[.)]\s+)/.test(next)) break
        source += ` ${next}`
        index += 1
      }
    }
    addLocation(line, source, heading ? 'heading' : 'paragraph')
    if (locations.length >= 3000) break
  }
  return locations
}

export function findSourceTextRange(content: string, selectedText: string, occurrence = 0): TextRange | null {
  const selection = selectedText.replaceAll('\r\n', '\n')
  if (!selection.trim() || occurrence < 0) return null
  let start = -selection.length
  for (let index = 0; index <= occurrence; index += 1) {
    start = content.indexOf(selection, start + selection.length)
    if (start < 0) return null
  }
  return { start, end: start + selection.length }
}

export function extractEditableDocumentLinks(content: string): EditableDocumentLink[] {
  const links: EditableDocumentLink[] = []

  for (const match of content.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    if (match.index === undefined) continue
    links.push({
      start: match.index,
      end: match.index + match[0].length,
      target: match[1].trim(),
      label: match[2]?.trim() || match[1].trim(),
      kind: 'wiki'
    })
  }

  for (const match of content.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (match.index === undefined || !/\.(md|markdown|txt)(?:#.*)?$/i.test(match[2])) continue
    links.push({
      start: match.index,
      end: match.index + match[0].length,
      target: match[2],
      label: match[1],
      kind: 'markdown'
    })
  }

  return links.sort((left, right) => left.start - right.start)
}

export function findDocumentLinkAtOffset(content: string, offset: number): EditableDocumentLink | null {
  return extractEditableDocumentLinks(content).find((link) => offset >= link.start && offset <= link.end) ?? null
}

export function findWikiMatch(content: string, cursor: number): WikiMatch | null {
  const beforeCursor = content.slice(0, cursor)
  const match = beforeCursor.match(/\[\[([^\]\n]*)$/)
  if (!match || match.index === undefined) return null
  return { query: match[1], start: match.index, end: cursor }
}

export function insertWikiTarget(content: string, match: WikiMatch, target: string): { content: string; cursor: number } {
  const insertion = `[[${target}]]`
  const next = `${content.slice(0, match.start)}${insertion}${content.slice(match.end)}`
  return { content: next, cursor: match.start + insertion.length }
}

export function wikiLinksToMarkdown(content: string): string {
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_whole, target: string, alias?: string) => {
    const label = alias?.trim() || target.trim()
    return `[${label}](#wiki:${encodeURIComponent(target.trim())})`
  })
}

export function pagefoldStylesToMarkdown(content: string): string {
  return content
    .replace(/<mark>(.+?)<\/mark>/g, '[$1](#pf-style:highlight)')
    .replace(/<span data-pf-color="(red|amber|green|blue|violet|muted)">(.+?)<\/span>/g, '[$2](#pf-style:color-$1)')
    .replace(/<span data-pf-font="(serif|sans|mono|hand)">(.+?)<\/span>/g, '[$2](#pf-style:font-$1)')
}

export function renderableMarkdown(content: string): string {
  return pagefoldStylesToMarkdown(wikiLinksToMarkdown(content))
}

export function extractOutgoingDocumentLinks(content: string, notePath: string): OutgoingDocumentLink[] {
  const links: OutgoingDocumentLink[] = []
  const seen = new Set<string>()

  function add(target: string, label: string, index: number, kind: OutgoingDocumentLink['kind']): void {
    const cleanTarget = target.trim()
    if (!cleanTarget) return
    const key = cleanTarget.toLocaleLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    links.push({
      target: cleanTarget,
      label: label.trim() || cleanTarget,
      line: content.slice(0, index).split('\n').length,
      kind
    })
  }

  for (const match of content.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    add(match[1], match[2] || match[1], match.index, 'wiki')
  }

  for (const match of content.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const rawTarget = match[2]
    if (!/\.(md|markdown|txt)(?:#.*)?$/i.test(rawTarget)) continue
    const [rawPath, fragment] = rawTarget.split('#', 2)
    let decoded: string
    try {
      decoded = decodeURIComponent(rawPath)
    } catch {
      decoded = rawPath
    }
    const resolved = resolveRelativeNotePath(notePath, decoded)
    add(fragment ? `${resolved}#${fragment}` : resolved, match[1], match.index, 'markdown')
  }

  return links.sort((a, b) => a.line - b.line)
}

export function resolveRelativeNotePath(notePath: string, assetPath: string): string {
  const clean = assetPath.replaceAll('\\', '/')
  if (/^(data:|blob:|https?:)/i.test(clean)) return clean
  const baseParts = notePath.replaceAll('\\', '/').split('/').slice(0, -1)
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') baseParts.pop()
    else baseParts.push(part)
  }
  return baseParts.join('/')
}

export function offsetForLine(content: string, line: number): number {
  if (line <= 1) return 0
  let offset = 0
  for (let index = 1; index < line; index += 1) {
    const next = content.indexOf('\n', offset)
    if (next < 0) return content.length
    offset = next + 1
  }
  return offset
}
