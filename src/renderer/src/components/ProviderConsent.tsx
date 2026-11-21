import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { company, consented, modeName, setConsented, type LiveMode } from '../state/consent'
import { inSelectMenu } from './Select'

/** Before a live mode's first call: the phone's "Send your voice to …?" sheet. Allow starts the call; Not Now or Esc doesn't. */
export function ProviderConsentSheet({ mode, onAllow, onCancel }: { mode: LiveMode; onAllow: () => void; onCancel: () => void }) {
  const allow = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    allow.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inSelectMenu(event)) {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])
  const who = company(mode)
  return (
    <div className="shortcuts-backdrop" onClick={onCancel}>
      <div className="shortcuts-sheet consent-sheet" role="alertdialog" aria-modal="true" aria-labelledby="consent-title" onClick={e => e.stopPropagation()}>
        <h2 id="consent-title">{t('Send your voice to {company}?', { company: who })}</h2>
        <p>
          {t(
            'During a {mode} call, Conduit sends your microphone audio, the transcript, and the context and tool results Hermes adds to {company}. Their terms and privacy policy apply.',
            { mode: modeName(mode), company: who }
          )}
        </p>
        <p className="meta">{t('Conduit asks once for each provider. You can take it back in Settings > Voice.')}</p>
        <div className="consent-actions">
          <button className="secondary" onClick={onCancel}>
            {t('Not Now')}
          </button>
          <button
            ref={allow}
            className="primary"
            onClick={() => {
              setConsented(mode, true)
              onAllow()
            }}
          >
            {t('Allow')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Settings > Voice: whether this mode may send the call, with Take back. */
export function ProviderConsentRow({ mode }: { mode: LiveMode }) {
  const [granted, setGranted] = useState(() => consented(mode))
  useEffect(() => setGranted(consented(mode)), [mode])
  return (
    <div className="consent-row">
      <div>
        <span>{t('Your voice goes to {company}', { company: company(mode) })}</span>
        <span className="meta">{granted ? t('Allowed') : t('Asks before the first call')}</span>
      </div>
      {granted ? (
        <button
          className="secondary"
          onClick={() => {
            setConsented(mode, false)
            setGranted(false)
          }}
        >
          {t('Take back')}
        </button>
      ) : null}
    </div>
  )
}
