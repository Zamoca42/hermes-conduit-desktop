import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { Icon } from './icons'
import type { CallPicture, PictureKind } from '../state/callPicture'

/**
 * Show a picture on a call, after the phone's Camera on the call screen and
 * Ask Hermes About Screen: a picture chosen from the computer, or a
 * screenshot of the screen Conduit is on. While one waits for the call's
 * next request, a chip says so and takes it off.
 */
export function CallPictureControls({
  waiting,
  busy,
  onPick,
  onScreenshot,
  onRemove
}: {
  waiting: CallPicture | null
  busy: boolean
  onPick: (file: File) => void
  onScreenshot: () => void
  onRemove: () => void
}) {
  const [menu, setMenu] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])
  return (
    <>
      {waiting ? <PictureChip kind={waiting.kind} onRemove={onRemove} /> : null}
      <span className="call-picture">
        <button
          className="voice-call-round"
          aria-label={t('Show a picture')}
          title={t('Show a picture')}
          aria-haspopup="menu"
          aria-expanded={menu}
          disabled={busy}
          onClick={e => {
            e.stopPropagation()
            setMenu(open => !open)
          }}
        >
          <Icon name={busy ? 'spinner' : 'image'} />
        </button>
        {menu ? (
          <div className="host-menu message-menu call-picture-menu" role="menu">
            <button role="menuitem" onClick={() => picker.current?.click()}>
              {t('Choose a picture…')}
            </button>
            <button role="menuitem" onClick={onScreenshot}>
              {t('Ask Hermes About Screen')}
            </button>
          </div>
        ) : null}
        <input
          ref={picker}
          type="file"
          accept="image/*"
          hidden
          onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onPick(file)
          }}
        />
      </span>
    </>
  )
}

function PictureChip({ kind, onRemove }: { kind: PictureKind; onRemove: () => void }) {
  return (
    <span className="call-picture-chip" role="status">
      <Icon name="image" />
      {kind === 'screenshot' ? t('Asking about this screenshot') : t('Asking about this picture')}
      <button className="staged-remove" aria-label={t('Remove')} title={t('Remove')} onClick={onRemove}>
        <Icon name="close" />
      </button>
    </span>
  )
}
