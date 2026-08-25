import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../release/win-unpacked/Pagefold.exe', import.meta.url))
const port = Number(process.env.PAGEFOLD_REMOTE_PORT || 9327)
const app = process.env.PAGEFOLD_SKIP_SPAWN
  ? null
  : spawn(executable, [`--remote-debugging-port=${port}`], { stdio: 'ignore' })

async function waitForPage() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const page = pages.find((candidate) => candidate.type === 'page' && /^(file:|http:\/\/localhost:)/.test(candidate.url || '') && candidate.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // The debugging endpoint is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('The app did not finish rendering in time')
}

async function inspectDom(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let requestId = 0
  const pending = new Map()
  const diagnostics = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    } else if (message.method === 'Runtime.exceptionThrown') {
      diagnostics.push(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text)
    } else if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      diagnostics.push(message.params.entry.text)
    }
  })
  function send(method, params = {}) {
    requestId += 1
    const id = requestId
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 30000)
      pending.set(id, (message) => { clearTimeout(timeout); resolve(message) })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  if (process.env.PAGEFOLD_SKIP_SPAWN) {
    await send('Page.reload')
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  await new Promise((resolve) => setTimeout(resolve, 2200))
  const result = await send('Runtime.evaluate', {
        expression: `(async () => {
          let workspaceName = null
          let workspaceEntries = 0
          let ipcError = null
          let rootNoteRoundTrip = false
          let dragDropImported = false
          let dropTargetHighlighted = false
          let folderDragDropImported = false
          let folderDropTargetHighlighted = false
          let mathRendered = false
          let mathSubscriptScaled = false
          let sectionOnlyHighlight = false
          let plainNoteRows = false
          let compactTreeSpacing = false
          let sectionSelectionColors = false
          let previewContextMenuEnabled = false
          let previewLinkPicker = false
          let activeNoteTabSync = false
          let linkLocationPicker = false
          let splitResizerEnabled = false
          let treeLabelsEnglish = false
          let treeLabelFontReadable = false
          let tempPath = null
          try {
            const workspace = await window.pagefold.getWorkspace()
            workspaceName = workspace?.name ?? null
            workspaceEntries = workspace?.tree?.length ?? 0
            tempPath = await window.pagefold.createEntry('', 'file', '__pagefold-smoke-' + Date.now())
            rootNoteRoundTrip = (await window.pagefold.readFile(tempPath)).startsWith('# __pagefold-smoke-')
          } catch (error) {
            ipcError = String(error)
          } finally {
            if (tempPath) await window.pagefold.deleteEntry(tempPath)
          }
          const importName = '__pagefold-drop-' + Date.now() + '.md'
          const importContent = '# Drop test\\n\\nInline formula $x^2$.\\n\\n$$\\n\\\\sum_{i=1}^n i\\n$$'
          let importedPath = null
          try {
            const droppedFile = new File([importContent], importName, { type: 'text/markdown' })
            const transfer = new DataTransfer()
            transfer.items.add(droppedFile)
            const dropTarget = document.querySelector('.tree-scroll')
            dropTarget?.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }))
            await new Promise((resolve) => setTimeout(resolve, 60))
            dropTargetHighlighted = Boolean(dropTarget?.classList.contains('is-drop-target'))
            dropTarget?.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
            for (let attempt = 0; attempt < 20 && !importedPath; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 100))
              const workspace = await window.pagefold.getWorkspace()
              const flatten = (entries) => entries.flatMap((entry) => [entry, ...flatten(entry.children || [])])
              importedPath = flatten(workspace.tree).find((entry) => entry.name === importName)?.path || null
            }
            dragDropImported = Boolean(importedPath && (await window.pagefold.readFile(importedPath)) === importContent)
          } finally {
            if (importedPath) await window.pagefold.deleteEntry(importedPath)
          }
          const folderImportName = '__pagefold-folder-drop-' + Date.now() + '.md'
          let folderImportedPath = null
          try {
            const droppedFile = new File([importContent], folderImportName, { type: 'text/markdown' })
            const transfer = new DataTransfer()
            transfer.items.add(droppedFile)
            const folderTarget = document.querySelector('.folder-row')
            folderTarget?.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }))
            await new Promise((resolve) => setTimeout(resolve, 60))
            folderDropTargetHighlighted = Boolean(folderTarget?.classList.contains('is-drop-target'))
            folderTarget?.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
            for (let attempt = 0; attempt < 20 && !folderImportedPath; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 100))
              const workspace = await window.pagefold.getWorkspace()
              const flatten = (entries) => entries.flatMap((entry) => [entry, ...flatten(entry.children || [])])
              folderImportedPath = flatten(workspace.tree).find((entry) => entry.name === folderImportName)?.path || null
            }
            folderDragDropImported = Boolean(folderImportedPath?.includes('/') && (await window.pagefold.readFile(folderImportedPath)) === importContent)
          } finally {
            if (folderImportedPath) await window.pagefold.deleteEntry(folderImportedPath)
          }
          await new Promise((resolve) => setTimeout(resolve, 160))
          mathRendered = document.querySelectorAll('.katex').length >= 2 && Boolean(document.querySelector('.katex-display'))
          const displayFormula = document.querySelector('.katex-display .katex')
          const formulaScript = displayFormula?.querySelector('.sizing')
          mathSubscriptScaled = Boolean(displayFormula && formulaScript
            && parseFloat(getComputedStyle(formulaScript).fontSize) < parseFloat(getComputedStyle(displayFormula).fontSize) * 0.9)
          const sectionRow = document.querySelector('.section-row:not(.folder-row)')
          const folderRow = document.querySelector('.folder-row')
          const sectionContainer = sectionRow?.closest('.library-section')
          const folderGroup = folderRow?.closest('.folder-group')
          const treeLabels = Array.from(document.querySelectorAll('.section-row strong, .folder-row strong')).map((label) => label.textContent?.trim())
          sectionOnlyHighlight = Boolean(sectionRow && folderRow && sectionContainer && folderGroup
            && !folderGroup.classList.contains('library-section')
            && folderRow.querySelector('.section-index') === null
            && document.querySelector('.note-row .section-index') === null
            && getComputedStyle(sectionContainer, '::before').backgroundColor !== 'rgba(0, 0, 0, 0)')
          plainNoteRows = Array.from(document.querySelectorAll('.note-row')).every((row) =>
            !row.querySelector(':scope > svg') && getComputedStyle(row, '::before').content === 'none')
          compactTreeSpacing = Boolean(sectionContainer && sectionRow && folderRow
            && parseFloat(getComputedStyle(sectionContainer).marginBottom) <= 4
            && parseFloat(getComputedStyle(sectionRow).minHeight) <= 42
            && parseFloat(getComputedStyle(folderRow).height) <= 32
            && Array.from(document.querySelectorAll('.note-row')).every((row) => parseFloat(getComputedStyle(row).height) <= 32))
          const currentSection = document.querySelector('.library-section.is-current-section')
          const inactiveSection = document.querySelector('.library-section:not(.is-current-section)')
          sectionSelectionColors = Boolean(currentSection
            && (!inactiveSection || getComputedStyle(currentSection, '::before').backgroundColor !== getComputedStyle(inactiveSection, '::before').backgroundColor))
          const currentWorkspace = await window.pagefold.getWorkspace()
          const allEntries = (entries) => entries.flatMap((entry) => [entry, ...allEntries(entry.children || [])])
          const storedNames = allEntries(currentWorkspace.tree).map((entry) => entry.name)
          treeLabelsEnglish = !treeLabels.includes('我的笔记') && !treeLabels.includes('你的笔记')
            && (!storedNames.includes('我的笔记') || treeLabels.includes('My Notes'))
            && (!storedNames.includes('你的笔记') || treeLabels.includes('Your Notes'))
          treeLabelFontReadable = Array.from(document.querySelectorAll('.section-row strong'))
            .every((label) => parseFloat(getComputedStyle(label).fontSize) >= 16)
          const activeTabButton = document.querySelector('.tab-strip > button.active')
          const activeTabPath = activeTabButton?.dataset.path
          document.querySelector('.library-section:not(.is-current-section) > .section-row')?.click()
          activeTabButton?.click()
          await new Promise((resolve) => setTimeout(resolve, 100))
          const currentNoteRow = document.querySelector('.note-row.is-current-note')
          activeNoteTabSync = Boolean(activeTabPath && currentNoteRow?.dataset.entryPath === activeTabPath
            && getComputedStyle(currentNoteRow).backgroundColor !== 'rgba(0, 0, 0, 0)'
            && parseFloat(getComputedStyle(currentNoteRow).fontWeight) >= 600)
          document.querySelector('.library-create-buttons button[aria-label="New note"]')?.click()
          await new Promise((resolve) => setTimeout(resolve, 120))
          const createDialog = Boolean(document.querySelector('.entry-dialog'))
          const createInputFocused = document.activeElement?.id === 'entry-name'
          document.querySelector('.dialog-cancel')?.click()
          let editor = document.querySelector('textarea[aria-label="Markdown editor"]')
          if (!editor) {
            document.querySelector('.mode-switch button[title="Edit"]')?.click()
            await new Promise((resolve) => setTimeout(resolve, 100))
            editor = document.querySelector('textarea[aria-label="Markdown editor"]')
          }
          if (editor) {
            editor.focus()
            editor.setSelectionRange(0, Math.min(3, editor.value.length))
            editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 500, clientY: 300 }))
          }
          await new Promise((resolve) => setTimeout(resolve, 80))
          const contextMenuItems = Array.from(document.querySelectorAll('.editor-context-menu button')).map((button) => button.textContent?.trim())
          document.querySelector('.editor-context-menu button')?.click()
          await new Promise((resolve) => setTimeout(resolve, 80))
          const linkPicker = Boolean(document.querySelector('.link-picker'))
          const linkResults = document.querySelectorAll('.link-picker-results button').length
          document.querySelector('.link-picker-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          document.querySelector('.mode-switch button[title="Split"]')?.click()
          await new Promise((resolve) => setTimeout(resolve, 100))
          const splitResizer = document.querySelector('.split-resizer')
          const splitValueBefore = Number(splitResizer?.getAttribute('aria-valuenow'))
          splitResizer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
          await new Promise((resolve) => setTimeout(resolve, 50))
          const splitValueAdjusted = Number(splitResizer?.getAttribute('aria-valuenow'))
          splitResizer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
          await new Promise((resolve) => setTimeout(resolve, 50))
          splitResizerEnabled = Boolean(splitResizer?.getAttribute('role') === 'separator'
            && splitResizer?.getAttribute('aria-label') === 'Resize editor and preview'
            && splitValueAdjusted > splitValueBefore
            && Number(splitResizer?.getAttribute('aria-valuenow')) === splitValueBefore)
          const preview = document.querySelector('article[aria-label="Markdown preview"]')
          if (preview) {
            const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT)
            let textNode = walker.nextNode()
            while (textNode && !textNode.textContent?.trim()) textNode = walker.nextNode()
            if (textNode?.textContent) {
              const start = textNode.textContent.search(/\\S/)
              const selection = window.getSelection()
              const range = document.createRange()
              range.setStart(textNode, start)
              range.setEnd(textNode, Math.min(textNode.textContent.length, start + 4))
              selection?.removeAllRanges()
              selection?.addRange(range)
              preview.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: 330 }))
              await new Promise((resolve) => setTimeout(resolve, 80))
              const previewButtons = Array.from(document.querySelectorAll('.editor-context-menu button'))
              const requiredPreviewActions = ['Link to document', 'Copy', 'Cut', 'Paste']
              previewContextMenuEnabled = requiredPreviewActions.every((label) => {
                const button = previewButtons.find((candidate) => candidate.textContent?.trim() === label)
                return Boolean(button && !button.disabled)
              })
              previewButtons.find((candidate) => candidate.textContent?.trim() === 'Link to document')?.click()
              await new Promise((resolve) => setTimeout(resolve, 80))
              previewLinkPicker = Boolean(document.querySelector('.link-picker'))
              document.querySelector('.link-picker-results button')?.click()
              await new Promise((resolve) => setTimeout(resolve, 180))
              linkLocationPicker = Boolean(document.querySelector('.link-location-whole')
                && document.querySelector('.link-location')
                && Array.from(document.querySelectorAll('.link-location small')).some((label) => /^Line \\d+$/.test(label.textContent?.trim() || ''))
                && Array.from(document.querySelectorAll('.link-location-content > b')).every((marker) => marker.textContent === '#'))
              document.querySelector('.link-picker-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
          }
          return JSON.stringify({
            hasLibraryText: document.body.innerText.includes('My Library'),
            ready: document.readyState,
            api: typeof window.pagefold,
            apiKeys: Object.keys(window.pagefold || {}),
            workspaceName,
            workspaceEntries,
            ipcError,
            rootNoteRoundTrip,
            dragDropImported,
            dropTargetHighlighted,
            folderDragDropImported,
            folderDropTargetHighlighted,
            mathRendered,
            mathSubscriptScaled,
            sectionOnlyHighlight,
            plainNoteRows,
            compactTreeSpacing,
            sectionSelectionColors,
            previewContextMenuEnabled,
            previewLinkPicker,
            activeNoteTabSync,
            linkLocationPicker,
            splitResizerEnabled,
            treeLabelsEnglish,
            treeLabelFontReadable,
            createDialog,
            createInputFocused,
            rootCreateButtons: document.querySelectorAll('.library-create-buttons button').length,
            contextMenuItems,
            linkPicker,
            linkResults,
            sections: document.querySelectorAll('.library-section').length,
            folders: document.querySelectorAll('.folder-group').length,
            notes: document.querySelectorAll('.note-row').length
          })
        })()`,
        awaitPromise: true,
        returnByValue: true
  })
  if (process.env.PAGEFOLD_SKIP_SPAWN) {
    await send('Page.reload')
  }
  socket.close()
  if (result.result.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails.text)
  }
  return { ...JSON.parse(result.result.result.value), diagnostics }
}

try {
  const page = await waitForPage()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const state = await inspectDom(page.webSocketDebuggerUrl)
  if (!state.hasLibraryText || !state.rootNoteRoundTrip || !state.dragDropImported || !state.dropTargetHighlighted || !state.folderDragDropImported || !state.folderDropTargetHighlighted || !state.mathRendered || !state.mathSubscriptScaled || !state.sectionOnlyHighlight || !state.plainNoteRows || !state.compactTreeSpacing || !state.sectionSelectionColors || !state.previewContextMenuEnabled || !state.previewLinkPicker || !state.activeNoteTabSync || !state.linkLocationPicker || !state.splitResizerEnabled || !state.treeLabelsEnglish || !state.treeLabelFontReadable || state.rootCreateButtons !== 3 || !state.createDialog || !state.createInputFocused || !state.contextMenuItems.includes('Link to document') || !state.contextMenuItems.includes('Paste') || !state.linkPicker) {
    throw new Error(`The library interface is incomplete: ${JSON.stringify(state)}`)
  }
  console.log(JSON.stringify(state))
} finally {
  app?.kill()
}
