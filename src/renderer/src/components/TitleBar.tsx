import { useEffect, useState } from 'react'
import type { HostSummary } from '@shared/ipc'
import { Icon } from './icons'

export function hostName(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

interface Props {
  subtitle?: string
  /** With more than one, the subtitle opens a list to switch hosts. */
  hosts?: HostSummary[]
  currentUrl?: string
  onSwitch?: (url: string) => void
}

export function TitleBar({ subtitle, hosts = [], currentUrl, onSwitch }: Props) {
  const { platform, window: win } = window.conduit
  const [open, setOpen] = useState(false)
  const switchable = hosts.length > 1 && !!onSwitch

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <header className="titlebar" onDoubleClick={event => event.target === event.currentTarget && win.toggleMaximize()}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        <span className="brand-name">Conduit</span>
        {subtitle && switchable ? (
          <span className="host-switch">
            <button
              className="brand-sub host-button"
              aria-haspopup="menu"
              aria-expanded={open}
              title="Switch Hermes"
              onClick={e => {
                e.stopPropagation()
                setOpen(o => !o)
              }}
            >
              · {subtitle} ▾
            </button>
            {open ? (
              <div className="host-menu" role="menu">
                {hosts.map(host => (
                  <button
                    key={host.url}
                    role="menuitemradio"
                    aria-checked={host.url === currentUrl}
                    onClick={() => {
                      setOpen(false)
                      if (host.url !== currentUrl) onSwitch!(host.url)
                    }}
                  >
                    <span className="host-check">{host.url === currentUrl ? '✓' : ''}</span>
                    <span className="host-label">{hostName(host.url)}</span>
                    {host.username ? <span className="meta">{host.username}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </span>
        ) : subtitle ? (
          <span className="brand-sub">· {subtitle}</span>
        ) : null}
      </div>
      {platform !== 'darwin' ? (
        <div className="caption-buttons">
          <button className="cap" aria-label="Minimize" onClick={() => win.minimize()}>
            <Icon name="minimize" />
          </button>
          <button className="cap" aria-label="Maximize" onClick={() => win.toggleMaximize()}>
            <Icon name="maximize" />
          </button>
          <button className="cap close" aria-label="Close" onClick={() => win.close()}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}
    </header>
  )
}
