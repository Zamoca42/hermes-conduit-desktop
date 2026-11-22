import { useEffect, useRef } from 'react'
import { t } from '@shared/i18n'
import type { LivePreview } from '../state/livePreview'
import { inSelectMenu } from './Select'

/** Live call style's "What Conduit sends", after the phone's LiveVoiceInstructionsPreviewSheet. */
export function LivePreviewSheet({ preview, onClose }: { preview: LivePreview | null; onClose: () => void }) {
  const done = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    done.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inSelectMenu(event)) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-sheet live-preview" role="dialog" aria-modal="true" aria-label={t('What Conduit sends')} onClick={e => e.stopPropagation()}>
        <header>
          <h2>{t('What Conduit sends')}</h2>
          <span className="spacer" />
          <button ref={done} className="link" onClick={onClose}>
            {t('Done')}
          </button>
        </header>
        {preview ? (
          <>
            <p className="meta">
              {preview.isLocalLive
                ? t('Conduit sends this to your fast model as its instructions for every call; nothing else is added before it. Personality is read when a call starts.')
                : t(
                    "Conduit adds this to {mode}'s instructions for every call. Your Hermes server adds its own voice persona before it. Memory and personality are read when a call starts.",
                    { mode: preview.mode }
                  )}
            </p>
            <pre className="live-preview-text">{preview.instructions}</pre>
            {preview.openingTurn ? (
              <>
                <p className="meta">{t("Sent as the call's first turn when it connects:")}</p>
                <pre className="live-preview-text">{preview.openingTurn}</pre>
              </>
            ) : null}
          </>
        ) : (
          <p className="meta">{t('Turn on a live voice mode to see what Conduit sends.')}</p>
        )}
      </div>
    </div>
  )
}
