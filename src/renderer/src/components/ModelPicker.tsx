import { useEffect, useMemo, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { t } from '@shared/i18n'
import type { ModelSwitch, OpenChat } from '../state/useChat'
import { REASONING_LEVELS, groupModels, reasoningTitle, type ModelProviderRow } from '../state/models'
import { Icon } from './icons'

interface Props {
  chat: OpenChat
  profile?: string
  onClose: () => void
  setModel: (model: string, provider: string, confirmed?: boolean) => Promise<ModelSwitch>
  setReasoning: (effort: string) => Promise<void>
  setSpeed: (speed: 'normal' | 'fast' | 'ultrafast') => Promise<void>
  setYolo: (on: boolean) => Promise<void>
}

/**
 * The chat's model and run settings, as the phone's Model sheet: every
 * control applies when it's clicked, with no Apply step, and the panel
 * stays open. Esc or a click outside closes it.
 */
export function ModelPicker({ chat, profile, onClose, setModel, setReasoning, setSpeed, setYolo }: Props) {
  const [providers, setProviders] = useState<ModelProviderRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; tone: 'error' | 'info' } | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    const params: Record<string, unknown> = { explicit_only: true }
    if (chat.liveId) params.session_id = chat.liveId
    if (profile) params.profile = profile
    gateway
      .rpc<{ providers?: ModelProviderRow[] }>('model.options', params)
      .then(result => live && setProviders(result.providers ?? []))
      .catch(e => live && setLoadError(e instanceof Error ? e.message : String(e)))
    search.current?.focus()
    return () => {
      live = false
    }
  }, [chat.liveId, profile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // The model chip toggles the panel itself.
      if (panel.current && !panel.current.contains(target) && !target.closest?.('.chip-button')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const groups = useMemo(() => groupModels(providers ?? [], query), [providers, query])
  const current = (model: string, provider: string) => model === chat.model && (!chat.provider || provider === chat.provider)

  async function pick(model: string, provider: string) {
    if (busy || current(model, provider)) return
    setBusy(`${provider}/${model}`)
    setNote(null)
    let outcome = await setModel(model, provider)
    // A model Hermes guards (an expensive one, say) asks on the click; Cancel leaves the chat where it was.
    if (outcome.kind === 'confirm') {
      outcome = window.confirm(outcome.message) ? await setModel(model, provider, true) : { kind: 'switched', deferred: false }
    }
    if (outcome.kind === 'failed') setNote({ text: outcome.message, tone: 'error' })
    else if (outcome.kind === 'switched' && outcome.deferred) setNote({ text: t('Switches to {model} when this reply finishes.', { model }), tone: 'info' })
    setBusy(null)
  }

  async function apply(name: string, write: () => Promise<void>) {
    if (busy) return
    setBusy(name)
    setNote(null)
    try {
      await write()
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const reasoning = (chat.reasoning ?? '').toLowerCase()
  return (
    <div className="model-picker" role="dialog" aria-label={t('Model')} ref={panel}>
      <div className="model-current">
        <span className="model-current-name">{chat.model || t('Model')}</span>
        {chat.provider ? <span className="meta">{providerName(providers, chat.provider)}</span> : null}
        <button className="staged-remove" aria-label={t('Close')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {note ? <div className={`model-note${note.tone === 'error' ? ' error' : ''}`}>{note.text}</div> : null}

      <div className="model-settings">
        <div className="model-setting">
          <span className="model-setting-label">{t('Reasoning')}</span>
          <div className="segmented" role="radiogroup" aria-label={t('Reasoning')}>
            {REASONING_LEVELS.map(level => (
              <button
                key={level}
                role="radio"
                aria-checked={reasoning === level}
                className={reasoning === level ? 'on' : undefined}
                disabled={!!busy}
                onClick={() => void apply('reasoning', () => setReasoning(level))}
              >
                {reasoningTitle(level)}
              </button>
            ))}
          </div>
        </div>
        <div className="model-setting-row">
          {chat.speed === 'ultrafast' ? (
            <div className="model-setting">
              <span className="model-setting-label">{t('Fast mode')}</span>
              <div className="segmented" role="radiogroup" aria-label={t('Fast mode')}>
                {(['normal', 'fast', 'ultrafast'] as const).map(speed => (
                  <button
                    key={speed}
                    role="radio"
                    aria-checked={chat.speed === speed}
                    className={chat.speed === speed ? 'on' : undefined}
                    disabled={!!busy}
                    onClick={() => void apply('speed', () => setSpeed(speed))}
                  >
                    {speed === 'normal' ? t('Off') : speed === 'fast' ? t('Fast') : t('Ultrafast')}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <label className="toggle">
              <input
                type="checkbox"
                checked={chat.speed === 'fast'}
                disabled={!!busy}
                onChange={e => void apply('speed', () => setSpeed(e.target.checked ? 'fast' : 'normal'))}
              />
              {t('Fast mode')}
            </label>
          )}
          <label className="toggle" title={t('YOLO automatically approves tool actions for this conversation only. Set the profile default in Workspace & safety.')}>
            <input type="checkbox" checked={chat.yolo === true} disabled={!!busy} onChange={e => void apply('yolo', () => setYolo(e.target.checked))} />
            {t('YOLO mode')}
          </label>
        </div>
      </div>

      <input
        ref={search}
        className="model-search"
        type="search"
        placeholder={t('Search providers or models')}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          // Return picks the first match, as on the phone.
          if (e.key === 'Enter' && groups[0]?.models[0]) {
            e.preventDefault()
            void pick(groups[0].models[0], groups[0].slug)
          }
        }}
      />
      <div className="model-list">
        {loadError ? <div className="model-note error">{t('Could not load models.')} {loadError}</div> : null}
        {!providers && !loadError ? <div className="model-note">{t('Loading…')}</div> : null}
        {providers && !groups.length ? (
          <div className="model-note">{query.trim() ? t('Nothing matches “{query}”.', { query: query.trim() }) : t('Could not load models.')}</div>
        ) : null}
        {groups.map(group => (
          <section key={group.slug} className="model-group">
            <div className="model-group-name">{group.name}</div>
            {group.models.map(model => {
              const on = current(model, group.slug)
              return (
                <button
                  key={model}
                  className={`model-row${on ? ' on' : ''}`}
                  aria-pressed={on}
                  disabled={!!busy && busy !== `${group.slug}/${model}`}
                  onClick={() => void pick(model, group.slug)}
                >
                  <span className="model-row-name">{model}</span>
                  {busy === `${group.slug}/${model}` ? <Icon name="spinner" style={{ animation: 'spin 1s linear infinite' }} /> : on ? <Icon name="check" /> : null}
                </button>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}

function providerName(providers: ModelProviderRow[] | null, slug: string): string {
  return providers?.find(p => p.slug === slug)?.name ?? slug
}
