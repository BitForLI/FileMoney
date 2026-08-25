import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, X } from 'lucide-react'

interface NameDialogProps {
  title: string
  initialValue?: string
  confirmLabel: string
  busy: boolean
  onClose: () => void
  onSubmit: (value: string) => void
}

export function NameDialog({ title, initialValue = '', confirmLabel, busy, onClose, onSubmit }: NameDialogProps) {
  const [value, setValue] = useState(initialValue)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  return (
    <div className="modal-backdrop entry-dialog-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <form
        className="entry-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (value.trim() && !busy) onSubmit(value.trim())
        }}
      >
        <div className="entry-dialog-number">＋</div>
        <div className="entry-dialog-heading">
          <h2 id="entry-dialog-title">{title}</h2>
          <button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
        <label htmlFor="entry-name">Name</label>
        <input
          ref={input}
          id="entry-name"
          value={value}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) onClose()
          }}
        />
        <div className="entry-dialog-actions">
          <button type="button" className="dialog-cancel" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="dialog-confirm" disabled={!value.trim() || busy}>{busy ? 'Working…' : confirmLabel}<ArrowRight size={14} /></button>
        </div>
      </form>
    </div>
  )
}

interface DeleteDialogProps {
  name: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}

export function DeleteDialog({ name, busy, onClose, onConfirm }: DeleteDialogProps) {
  return (
    <div className="modal-backdrop entry-dialog-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <section className="entry-dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="delete-mark"><AlertTriangle size={22} /></div>
        <div className="entry-dialog-heading">
          <h2 id="delete-dialog-title">Delete “{name}”?</h2>
          <button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
        <p>This also deletes everything inside it. This version does not have a trash folder yet.</p>
        <div className="entry-dialog-actions">
          <button className="dialog-cancel" disabled={busy} onClick={onClose}>Keep</button>
          <button className="dialog-confirm danger" disabled={busy} onClick={onConfirm}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </section>
    </div>
  )
}
