import { Moon, Sun, X } from 'lucide-react'

export interface AppSettings {
  theme: 'light' | 'dark'
  fontScale: number
  readableWidth: boolean
}

interface SettingsPanelProps {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onClose: () => void
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-heading">
          <div><span className="eyebrow">WORKSPACE</span><h2 id="settings-title">Reading & Appearance</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={18} /></button>
        </div>
        <div className="setting-group">
          <label>Theme</label>
          <div className="theme-options">
            <button className={settings.theme === 'light' ? 'selected' : ''} onClick={() => onChange({ ...settings, theme: 'light' })}><Sun size={18} /><span>Paper</span></button>
            <button className={settings.theme === 'dark' ? 'selected' : ''} onClick={() => onChange({ ...settings, theme: 'dark' })}><Moon size={18} /><span>Night Ink</span></button>
          </div>
        </div>
        <div className="setting-group">
          <label htmlFor="font-size">Editor font size <strong>{settings.fontScale}px</strong></label>
          <input id="font-size" type="range" min="14" max="22" value={settings.fontScale} onChange={(event) => onChange({ ...settings, fontScale: Number(event.target.value) })} />
        </div>
        <div className="setting-row">
          <div><label htmlFor="readable-width">Comfortable line width</label><p>Limits content width for longer writing sessions.</p></div>
          <button id="readable-width" role="switch" aria-checked={settings.readableWidth} className={`switch ${settings.readableWidth ? 'on' : ''}`} onClick={() => onChange({ ...settings, readableWidth: !settings.readableWidth })}><span /></button>
        </div>
      </section>
    </div>
  )
}
