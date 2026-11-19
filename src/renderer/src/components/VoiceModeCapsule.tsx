import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { Icon } from './icons'
import { VOICE_MODES, voiceModeTitle, type VoiceMode } from '../state/gptLive'

/**
 * The mode menu on a call, after the phone's VoiceModeCapsule: the call's
 * mode and a chevron. Picking another ends this call and starts again in
 * that mode, in the same chat, and Voice settings keep it; the call's own
 * mode leaves the call as it is.
 */
export function VoiceModeCapsule({ mode, onPick }: { mode: VoiceMode; onPick: (mode: VoiceMode) => void }) {
  const [open, setOpen] = useState(false)
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
    <span className="voice-mode-capsule-wrap">
      <button
        className="voice-mode-capsule"
        aria-label={`${t('Voice mode')}: ${voiceModeTitle(mode)}`}
        title={t('Ends this call and starts again in the mode you pick, in the same chat. Voice settings keep the new mode.')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={e => {
          e.stopPropagation()
          setOpen(o => !o)
        }}
      >
        {voiceModeTitle(mode)}
        <Icon name="chevronDown" />
      </button>
      {open ? (
        <div className="host-menu message-menu voice-mode-menu" role="menu" aria-label={t('Voice mode')}>
          {VOICE_MODES.map(choice => (
            <button
              key={choice}
              role="menuitemradio"
              aria-checked={choice === mode}
              onClick={() => {
                setOpen(false)
                if (choice !== mode) onPick(choice)
              }}
            >
              <span className="voice-mode-tick">{choice === mode ? <Icon name="check" /> : null}</span>
              {voiceModeTitle(choice)}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  )
}
