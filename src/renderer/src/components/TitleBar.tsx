import { Icon } from './icons'

export function TitleBar({ subtitle }: { subtitle?: string }) {
  const { platform, window: win } = window.conduit
  return (
    <header className="titlebar" onDoubleClick={event => event.target === event.currentTarget && win.toggleMaximize()}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        <span className="brand-name">Conduit</span>
        {subtitle ? <span className="brand-sub">· {subtitle}</span> : null}
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
