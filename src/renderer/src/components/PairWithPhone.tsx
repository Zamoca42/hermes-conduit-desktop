import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { PairEvent, PairHost } from '@shared/ipc'
import { t } from '@shared/i18n'

type Stage =
  | { kind: 'starting' }
  | { kind: 'showing'; qr: string; expires: number }
  | { kind: 'received'; words: string[]; hosts: PairHost[] }
  | { kind: 'signing-in' }
  | { kind: 'ended'; message: string; tone?: 'error' }

function hostLabel(host: PairHost): string {
  try {
    return host.name ?? new URL(host.url).host
  } catch {
    return host.url
  }
}

/**
 * Pair this computer from the phone: a QR code to scan in Conduit on the
 * iPhone, then the four words both screens show, and the sign-in once the
 * person says they match.
 */
export function PairWithPhone({ onBack }: { onBack: () => void }) {
  const [stage, setStage] = useState<Stage>({ kind: 'starting' })
  const [round, setRound] = useState(0)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let live = true
    setStage({ kind: 'starting' })
    void window.conduit.pairStart().then(async result => {
      if (!live) return
      if (!result.ok) return setStage({ kind: 'ended', message: result.error, tone: 'error' })
      const qr = await QRCode.toDataURL(result.link, { margin: 1, width: 520, errorCorrectionLevel: 'M' })
      if (live) setStage({ kind: 'showing', qr, expires: result.expires })
    })
    const off = window.conduit.onPair((event: PairEvent) => {
      if (event.phase === 'received') setStage({ kind: 'received', words: event.words ?? [], hosts: event.hosts ?? [] })
      else if (event.phase === 'signing-in') setStage({ kind: 'signing-in' })
      else if (event.phase === 'expired') setStage({ kind: 'ended', message: t('The code ran out. Make a new one to try again.') })
      else if (event.phase === 'failed') setStage({ kind: 'ended', message: event.error ?? t('Pairing didn’t work.'), tone: 'error' })
      else if (event.phase === 'done' && event.error) setStage({ kind: 'ended', message: `${t('Signed in, except:')}\n${event.error}` })
    })
    return () => {
      live = false
      off()
      void window.conduit.pairCancel()
    }
  }, [round])

  useEffect(() => {
    if (stage.kind !== 'showing') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [stage.kind])

  const left = stage.kind === 'showing' ? Math.max(0, Math.round((stage.expires - now) / 1000)) : 0
  return (
    <div className="signin-card pair-card">
      <h1>{t('Pair with your iPhone')}</h1>
      {stage.kind === 'starting' ? <p>{t('Making a code…')}</p> : null}
      {stage.kind === 'showing' ? (
        <>
          <p>{t('In Conduit on your iPhone, open Settings, then Connection, then Pair a Computer, and scan this code.')}</p>
          <img className="pair-qr" src={stage.qr} alt={t('Pairing code')} />
          <p className="pair-note">
            {t('Your phone sends its sign-ins sealed to this computer. Nobody in between can read them. The code works for {time} more.', {
              time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
            })}
          </p>
        </>
      ) : null}
      {stage.kind === 'received' ? (
        <>
          <p>{t('Check that your iPhone shows these same four words.')}</p>
          <div className="pair-words" aria-label={t('Words to compare')}>
            {stage.words.map(word => (
              <span key={word}>{word}</span>
            ))}
          </div>
          <p>
            {stage.hosts.length === 1
              ? t('It sent a sign-in for {host}.', { host: hostLabel(stage.hosts[0]!) })
              : t('It sent sign-ins for {count} hosts: {hosts}.', { count: stage.hosts.length, hosts: stage.hosts.map(hostLabel).join(', ') })}
          </p>
          <button className="primary" onClick={() => void window.conduit.pairConfirm()}>
            {t('They match, sign in')}
          </button>
          <button className="link-button" onClick={() => setRound(r => r + 1)}>
            {t('They don’t match')}
          </button>
        </>
      ) : null}
      {stage.kind === 'signing-in' ? <p>{t('Signing in…')}</p> : null}
      {stage.kind === 'ended' ? (
        <>
          <p className={stage.tone === 'error' ? 'error-text' : undefined} style={{ whiteSpace: 'pre-line' }}>
            {stage.message}
          </p>
          <button className="primary" onClick={() => setRound(r => r + 1)}>
            {t('Make a new code')}
          </button>
        </>
      ) : null}
      <button className="link-button" onClick={onBack}>
        {t('Type an address instead')}
      </button>
    </div>
  )
}
