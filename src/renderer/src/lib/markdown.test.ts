import { describe, expect, it } from 'vitest'
import { buildDocumentJumpTarget, buildWikiLink, displayEntryName, displayLibraryPath, extractDocumentLocations, extractOutgoingDocumentLinks, findSourceTextRange, findWikiMatch, flattenMarkdownFiles, insertWikiTarget, offsetForLine, renderableMarkdown, resolveRelativeNotePath, wikiLinksToMarkdown } from './markdown'

describe('Markdown helpers', () => {
  it('uses English display aliases without changing stored paths', () => {
    expect(displayEntryName('我的笔记')).toBe('My Notes')
    expect(displayEntryName('Custom Folder')).toBe('Custom Folder')
    expect(displayLibraryPath('我的笔记/1/note.md')).toBe('My Notes/1/note.md')
  })

  it('finds and completes an unfinished wiki link', () => {
    const content = '参见 [[项'
    const match = findWikiMatch(content, content.length)
    expect(match?.query).toBe('项')
    expect(insertWikiTarget(content, match!, '项目计划').content).toBe('参见 [[项目计划]]')
  })

  it('converts aliased wiki links for preview', () => {
    expect(wikiLinksToMarkdown('[[项目计划|计划]]')).toBe('[计划](#wiki:%E9%A1%B9%E7%9B%AE%E8%AE%A1%E5%88%92)')
  })

  it('builds a wiki link from a selected phrase', () => {
    expect(buildWikiLink('项目/计划.md', '这份计划')).toBe('[[项目/计划|这份计划]]')
    expect(buildWikiLink('项目/计划.md', '概率', 'L12')).toBe('[[项目/计划#L12|概率]]')
  })

  it('extracts headings and paragraph locations from a document', () => {
    expect(extractDocumentLocations('# **标题**\n\n- [x] 完成任务\n---\n普通段落\n继续说明\n\n```python\nprint(1)\n```\n\n$$\nx^2\n$$')).toEqual([
      { line: 1, label: '标题', markdown: '**标题**', kind: 'heading' },
      { line: 3, label: '完成任务', markdown: '- [x] 完成任务', kind: 'paragraph' },
      { line: 5, label: '普通段落 继续说明', markdown: '普通段落 继续说明', kind: 'paragraph' },
      { line: 8, label: 'print(1)', markdown: '```python\nprint(1)\n```', kind: 'paragraph' },
      { line: 12, label: 'x^2', markdown: '$$\nx^2\n$$', kind: 'paragraph' }
    ])
  })

  it('maps a unique preview selection back to Markdown source', () => {
    expect(findSourceTextRange('调用 entropy 函数。', 'entropy')).toEqual({ start: 3, end: 10 })
    expect(findSourceTextRange('重复 word 和 word', 'word', 1)).toEqual({ start: 10, end: 14 })
    expect(findSourceTextRange('没有目标', 'word')).toBeNull()
  })

  it('finds notes at the root and inside sections', () => {
    expect(flattenMarkdownFiles([
      { name: '根笔记.md', path: '根笔记.md', type: 'file', modifiedAt: 1 },
      { name: '项目', path: '项目', type: 'section', modifiedAt: 1, children: [{ name: '计划.md', path: '项目/计划.md', type: 'file', modifiedAt: 1 }] }
    ])).toHaveLength(2)
  })

  it('resolves attachment paths relative to a note', () => {
    expect(resolveRelativeNotePath('notes/today.md', '../assets/a.png')).toBe('assets/a.png')
  })

  it('calculates a line offset', () => {
    expect(offsetForLine('一\n二\n三', 3)).toBe(4)
  })

  it('extracts unique outgoing wiki and Markdown document links', () => {
    expect(extractOutgoingDocumentLinks('[[项目计划|计划]]\n[日志](../日志.md#L8)\n[[项目计划]]', '项目/今天.md')).toEqual([
      { target: '项目计划', label: '计划', line: 1, kind: 'wiki' },
      { target: '日志.md#L8', label: '日志', line: 2, kind: 'markdown' }
    ])
  })

  it('renders Pagefold highlight, color, and font spans safely', () => {
    expect(renderableMarkdown('<mark>重点</mark> <span data-pf-color="red">红字</span> <span data-pf-font="mono">代码字</span>'))
      .toBe('[重点](#pf-style:highlight) [红字](#pf-style:color-red) [代码字](#pf-style:font-mono)')
  })

  it('creates a document jump target for a location click', () => {
    expect(buildDocumentJumpTarget('项目/计划.md')).toBe('项目/计划.md')
    expect(buildDocumentJumpTarget('项目/计划.md', 12)).toBe('项目/计划.md#L12')
  })
})
