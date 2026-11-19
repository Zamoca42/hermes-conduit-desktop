import { useEffect, useState } from 'react'
import { language, t } from '@shared/i18n'
import type { WakeListenerState, WakeModelsState } from '../../../shared/ipc'
import { isUsableWakePhrase } from '../../../shared/wakePhrase'
import { WAKE_EVENT, modelLangFor, setWakeProfile, suggestedPhrase, wakeProfiles } from '../state/wakeSettings'

const megabytes = (bytes: number) => Math.max(1, Math.round(bytes / 1_000_000))

/**
 * Settings > Wake phrase, after the phone's: this profile's phrases, kept on
 * this computer per dashboard. Vosk listens offline, with the model for the
 * language the person picks, downloaded once from Vosk's site.
 */
export function WakePhraseSettings({ host, profile }: { host: string; profile: string }) {
  const read = () => wakeProfiles(host)[profile] ?? null
  const [saved, setSaved] = useState(read)
  const [enabled, setEnabled] = useState(() => !!read())
  const [text, setText] = useState(() => (read()?.phrases ?? []).join('\n'))
  const [models, setModels] = useState<WakeModelsState | null>(null)
  const [listener, setListener] = useState<WakeListenerState>({ state: 'off' })
  const [lang, setLang] = useState<string | null>(null)
  const suggestion = suggestedPhrase(profile === 'default' ? 'Hermes' : profile)

  useEffect(() => {
    const now = read()
    setSaved(now)
    setEnabled(!!now)
    setText((now?.phrases ?? []).join('\n'))
    const changed = () => setSaved(read())
    window.addEventListener(WAKE_EVENT, changed)
    return () => window.removeEventListener(WAKE_EVENT, changed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, profile])

  useEffect(() => {
    let live = true
    const take = (state: WakeModelsState) => {
      if (!live) return
      setModels(state)
      if (state.listener) setListener(state.listener)
    }
    void window.conduit.wake.models().then(take, () => undefined)
    const offModels = window.conduit.wake.onModels(take)
    const offListener = window.conduit.wake.onListener(state => live && setListener(state))
    return () => {
      live = false
      offModels()
      offListener()
    }
  }, [])

  const choices = models?.choices ?? null
  const picked = lang ?? models?.installed?.lang ?? (choices ? modelLangFor(language(), choices) : null) ?? choices?.[0]?.lang ?? null
  const choice = choices?.find(c => c.lang === picked) ?? null
  const installed = models?.installed ?? null
  const downloading = models?.downloading ?? null

  const save = (phrases: string[], fresh = saved?.fresh ?? true) => {
    setWakeProfile(host, profile, phrases.length ? { phrases, fresh } : null)
    setSaved(read())
  }
  const phrasesOf = (value: string) => value.split('\n').map(p => p.trim()).filter(Boolean)
  const lines = phrasesOf(text)

  return (
    <div className="voice-mode-settings wake-settings">
      <label className="toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => {
            setEnabled(e.target.checked)
            if (e.target.checked) {
              const start = lines.length ? lines : [suggestion]
              setText(start.join('\n'))
              save(start)
            } else save([])
          }}
        />
        {t('Listen for a wake phrase')}
      </label>
      <p className="meta settings-caption">
        {t(
          'Say the phrase while Conduit is open to start voice on this profile, in whichever voice mode it uses. Listening runs on this computer with an offline speech model, and stops during calls and while Conduit is hidden.'
        )}
      </p>
      {enabled ? (
        <>
          <label className="voice-mode-pick">
            <span className="meta">{t('Language')}</span>
            <select
              className="language-select"
              value={picked ?? ''}
              disabled={!choices || !!downloading}
              onChange={e => setLang(e.target.value)}
              aria-label={t('Language')}
            >
              {!choices && installed ? <option value={installed.lang}>{installed.label}</option> : null}
              {(choices ?? []).map(c => (
                <option key={c.lang} value={c.lang}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {downloading ? (
            <div className="wake-download">
              <progress max={downloading.total ?? undefined} value={downloading.total ? downloading.received : undefined} />
              <span className="meta">
                {downloading.total
                  ? t('{done} of {total} MB', { done: megabytes(downloading.received), total: megabytes(downloading.total) })
                  : t('{done} MB', { done: megabytes(downloading.received) })}
              </span>
              <button className="link" onClick={() => window.conduit.wake.cancelDownload()}>
                {t('Cancel')}
              </button>
            </div>
          ) : installed && installed.lang === picked ? (
            <p className="meta settings-caption">
              {t('Speech model: {language}, on this computer.', { language: installed.label })}{' '}
              <button className="link" onClick={() => void window.conduit.wake.remove()}>
                {t('Remove')}
              </button>
            </p>
          ) : choice ? (
            <p className="meta settings-caption">
              <button className="link" onClick={() => void window.conduit.wake.download(choice.lang)}>
                {choice.bytes ? t('Download the speech model ({size} MB)', { size: megabytes(choice.bytes) }) : t('Download the speech model')}
              </button>
              {installed ? ` ${t('It replaces the {language} model.', { language: installed.label })}` : null}
            </p>
          ) : null}
          {models?.error && !(installed && installed.lang === picked) ? (
            <p className="meta settings-caption warns">{t('Couldn’t reach Vosk’s list of speech models ({error}).', { error: models.error })}</p>
          ) : null}
          {choices && picked === null ? <p className="meta settings-caption warns">{t('No offline speech model is offered for this language yet.')}</p> : null}
          <div className="pset-rules">
            <label className="pset-rules-label" htmlFor="wake-phrases">
              {t('Wake phrases')}
            </label>
            <textarea
              id="wake-phrases"
              rows={2}
              value={text}
              placeholder={suggestion}
              onChange={e => setText(e.target.value)}
              onBlur={() => save(phrasesOf(text))}
            />
            <p className="meta">
              {t('Use at least two words, such as "{phrase}". Add a second spelling if Conduit mishears a name.', { phrase: suggestion })}{' '}
              {t('One phrase per line.')}
            </p>
            {lines.some(line => !isUsableWakePhrase(line)) ? <p className="meta warns">{t('Phrases with a single word are ignored.')}</p> : null}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={saved?.fresh ?? true} disabled={!saved} onChange={e => save(saved?.phrases ?? [], e.target.checked)} />
            {t('Start a new conversation')}
          </label>
          <p className="meta settings-caption">
            {t(
              'Off: the phrase continues the chat you were in last, as the chat’s voice button does, and the call starts knowing what was said there. On: each phrase starts a new conversation.'
            )}
          </p>
          {listener.state === 'listening' ? <p className="meta settings-caption">{t('Listening for your wake phrases.')}</p> : null}
          {listener.state === 'failed' ? (
            <p className="meta settings-caption warns">{t('The wake phrase stopped: {error}', { error: listener.error })}</p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
