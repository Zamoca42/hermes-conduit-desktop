import { useEffect, useState } from 'react'
import { language, t } from '@shared/i18n'
import { GatewayError, gateway } from '../gateway'
import { withProfile } from '../state/gptLive'
import { KEY_PATH, PLUGIN_MISSING, STATUS_PATH, agentSetupText, localStatus, serverFlags, type LocalStatus } from '../state/localLive'
import { relativeTime } from '../state/pulseLook'
import { LocalLiveAgentSettings } from './LocalLiveAgentSettings'

function CopyRow({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="local-live-copy">
      <span className="meta">{title}</span>
      <code>{value}</code>
      <button
        className="secondary"
        aria-label={t('Copy {title}', { title })}
        onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
      >
        {copied ? t('Copied') : t('Copy')}
      </button>
    </div>
  )
}

/** Settings > Voice > Local Live, after the phone's "Point the server at Hermes": the address and key the speech server uses. */
export function LocalLiveSettings({ profile }: { profile?: string }) {
  const [status, setStatus] = useState<LocalStatus | 'checking' | { failed: string } | null>(null)
  const [rotating, setRotating] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)
  const [setupCopied, setSetupCopied] = useState(false)
  const [load, setLoad] = useState(0)

  useEffect(() => {
    let live = true
    setStatus(current => (current && current !== 'checking' && !('failed' in current) ? current : 'checking'))
    Promise.all([gateway.http('GET', withProfile(STATUS_PATH, profile), undefined, 30_000), window.conduit.status()])
      .then(([body, host]) => live && setStatus(localStatus(body, host.url)))
      .catch((e: unknown) => {
        if (!live) return
        setStatus({ failed: e instanceof GatewayError && e.code === 404 ? PLUGIN_MISSING() : e instanceof Error ? e.message : String(e) })
      })
    return () => {
      live = false
    }
  }, [profile, load])

  const rotate = async () => {
    setRotating(true)
    setRotateError(null)
    try {
      await gateway.http('POST', withProfile(KEY_PATH, profile), {}, 30_000)
      setLoad(n => n + 1)
    } catch (e) {
      setRotateError(e instanceof Error ? e.message : String(e))
    } finally {
      setRotating(false)
    }
  }

  const ready = status && status !== 'checking' && !('failed' in status) ? status : null
  const flags = ready ? serverFlags(ready) : null
  const setup = ready ? agentSetupText(ready) : null
  return (
    <>
      <p className="meta settings-caption">
        {t(
          "A hands-free call through a speech server you run, such as Hugging Face speech-to-speech. Everything you say goes to Hermes as a turn in the call's chat, and Hermes' reply is spoken as it is written."
        )}
      </p>
      {status === 'checking' ? <p className="meta settings-caption">{t('Checking…')}</p> : null}
      {status && status !== 'checking' && 'failed' in status ? <p className="meta settings-caption voice-call-problem">{status.failed}</p> : null}
      {ready ? (
        ready.ownModel && ready.available ? (
          <p className="meta settings-caption">
            {t("This server's own model answers Live calls, and the Conduit plugin runs every other call's turns on it, so there's nothing to set up on it.")}
          </p>
        ) : ready.drivesTurns && ready.available ? (
          <p className="meta settings-caption">
            {t("Hermes answers on this server, so there's nothing to set up on it. The Conduit plugin runs each turn and has the server read the reply aloud.")}
          </p>
        ) : ready.modelAddress && ready.apiKey ? (
          <div className="local-live-setup">
            <p className="meta settings-caption">
              {t(
                "On the speech server, set its language model to this address and key, with the model name {name}. It then reads Hermes' replies aloud instead of writing its own.",
                { name: ready.modelName }
              )}
            </p>
            {setup ? (
              <>
                <button className="secondary" onClick={() => void navigator.clipboard.writeText(setup).then(() => setSetupCopied(true))}>
                  {setupCopied ? t('Copied') : t('Copy setup for your agent')}
                </button>
                <p className="meta settings-caption">
                  {t('One block with the address, key and flags, written for whoever sets up the server, such as your Hermes agent.')}
                </p>
              </>
            ) : null}
            <CopyRow title={t('Model address')} value={ready.modelAddress} />
            <CopyRow title={t('Key')} value={ready.apiKey} />
            {flags ? <CopyRow title={t('Flags for speech-to-speech')} value={flags} /> : null}
            <p className="meta settings-caption">{t('Run it with two pipelines so it can listen and speak at once.')}</p>
            {ready.answersAlone ? (
              <p className="meta settings-caption voice-call-problem">
                {t('Your speech server answered a call by itself, so Hermes never got a turn. Turn on Hermes answers under Your speech server.')}
              </p>
            ) : ready.lastRequestAt ? (
              <p className="meta settings-caption">
                {t("Your speech server last asked for words {when}. It's pointed here.", {
                  when: relativeTime(new Date(ready.lastRequestAt * 1000), new Date(), language())
                })}
              </p>
            ) : (
              <p className="meta settings-caption">{t("Your speech server hasn't asked for words yet. Set the address and key on it, then restart it.")}</p>
            )}
            <div>
              <button className="secondary" disabled={rotating} onClick={() => void rotate()}>
                {rotating ? t('Making a new key…') : t('Make a new key')}
              </button>
            </div>
            {rotateError ? <p className="meta settings-caption voice-call-problem">{rotateError}</p> : null}
          </div>
        ) : null
      ) : null}
      {ready && (!ready.available || (!ready.modelAddress && !ready.drivesTurns)) ? (
        <p className="meta settings-caption voice-call-problem">{ready.reason ?? t("Your Hermes host didn't send a key.")}</p>
      ) : null}
      {ready ? <LocalLiveAgentSettings profile={profile} front={ready.front} onSaved={() => setLoad(n => n + 1)} /> : null}
    </>
  )
}
