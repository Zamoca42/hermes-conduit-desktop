import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { ModelSwitch, OpenChat } from '../state/useChat'
import { REASONING_LEVELS, groupModels, reasoningTitle, typedModelId, typedModelProviders, type ModelProviderRow } from '../state/models'
import { Icon } from './icons'
import { isPinned, pinnedRows, recentRows, type ModelPick } from '../state/modelQuickPicks'
import { ProviderLogo } from './ProviderLogo'
import { useModelQuickPicks } from './ModelOptions'
import { useModelCatalog } from '../state/modelCatalog'
import { ModelCatalogNote, RefreshModelsButton } from './ModelCatalogNote'

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
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; tone: 'error' | 'info' } | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const params = useMemo(() => {
    const params: Record<string, unknown> = { explicit_only: true }
    if (chat.liveId) params.session_id = chat.liveId
    if (profile) params.profile = profile
    return params
  }, [chat.liveId, profile])
  const catalog = useModelCatalog(params)
  const providers = catalog.providers
  useEffect(() => search.current?.focus(), [])

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
  // A model Hermes doesn't list, typed as its id, on any provider (issue 2841).
  const typedId = typedModelId(query)
  const typedProviders = typedId && catalog.answered ? typedModelProviders(providers ?? [], typedId, chat.provider) : []
  const quick = useModelQuickPicks()
  const inUse: ModelPick | null = chat.model ? { model: chat.model, provider: chat.provider ?? '' } : null
  const pinned = query.trim() ? [] : pinnedRows(quick.picks, providers ?? [])
  const recent = query.trim() ? [] : recentRows(quick.picks, providers ?? [], inUse)
  const current = (model: string, provider: string) => model === chat.model && (!chat.provider || provider === chat.provider)

  async function pick(model: string, provider: string) {
    // Kept models wait for Hermes' answer before one is picked.
    if (busy || !catalog.answered || current(model, provider)) return
    setBusy(`${provider}/${model}`)
    setNote(null)
    let outcome = await setModel(model, provider)
    // A model Hermes guards (an expensive one, say) asks on the click; Cancel leaves the chat where it was.
    if (outcome.kind === 'confirm') {
      outcome = window.confirm(outcome.message) ? await setModel(model, provider, true) : { kind: 'switched', deferred: false }
    }
    // A switch leads the recent models, with the one left a click away.
    if (outcome.kind === 'switched') quick.switched({ model, provider }, inUse)
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

  /** A model's row, with Pin or Unpin beside it. Quick picks name the provider too. */
  function row(model: string, provider: string, quickPick: boolean) {
    const on = current(model, provider)
    const key = `${provider}/${model}`
    const pin = isPinned(quick.picks, { model, provider })
    return (
      <div key={key} className={`model-row-wrap${pin ? ' pinned' : ''}`}>
        <button
          className={`model-row${on ? ' on' : ''}`}
          aria-pressed={on}
          disabled={(!!busy && busy !== key) || !catalog.answered}
          onClick={() => void pick(model, provider)}
        >
          <span className="model-row-name">{model}</span>
          {quickPick ? <span className="meta model-row-provider">{providerName(providers, provider)}</span> : null}
          {busy === key ? <Icon name="spinner" style={{ animation: 'spin 1s linear infinite' }} /> : on ? <Icon name="check" /> : null}
        </button>
        <button
          className="model-pin"
          aria-label={pin ? t('Unpin') : t('Pin')}
          title={pin ? t('Unpin') : t('Pin')}
          aria-pressed={pin}
          onClick={() => quick.toggle({ model, provider })}
        >
          <Icon name="pin" />
        </button>
      </div>
    )
  }

  const reasoning = (chat.reasoning ?? '').toLowerCase()
  return (
    <div className="model-picker" role="dialog" aria-label={t('Model')} ref={panel}>
      <div className="model-current">
        <span className="model-current-name">{chat.model || t('Model')}</span>
        {chat.provider ? <span className="meta">{providerName(providers, chat.provider)}</span> : null}
        <RefreshModelsButton catalog={catalog} />
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
          <label
            className="toggle"
            title={t('YOLO automatically approves tool actions for this conversation only. Set the profile default in Workspace & safety.')}
          >
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
        {providers && query.trim() && !groups.length ? <div className="model-note">{t('Nothing matches “{query}”.', { query: query.trim() })}</div> : null}
        {pinned.length || recent.length ? (
          <section className="model-group model-quick" aria-label={t('Quick picks')}>
            {pinned.length ? <div className="model-group-name">{t('Pinned')}</div> : null}
            {pinned.map(p => row(p.model, p.provider, true))}
            {recent.length ? <div className="model-group-name">{t('Recent')}</div> : null}
            {recent.map(p => row(p.model, p.provider, true))}
          </section>
        ) : null}
        <ModelCatalogNote catalog={catalog} />
        {groups.map(group => (
          <section key={group.slug} className="model-group">
            <div className="model-group-name">
              <ProviderLogo slug={group.slug} title={group.name} size={16} />
              {group.name}
            </div>
            {group.models.map(model => row(model, group.slug, false))}
          </section>
        ))}
        {typedId && typedProviders.length ? (
          <section className="model-group model-typed" aria-label={t('Use “{id}” as a model ID', { id: typedId })}>
            <div className="model-group-name">{t('Use “{id}” as a model ID', { id: typedId })}</div>
            {typedProviders.map(provider => row(typedId, provider.slug, true))}
          </section>
        ) : null}
      </div>
    </div>
  )
}

function providerName(providers: ModelProviderRow[] | null, slug: string): string {
  return providers?.find(p => p.slug === slug)?.name ?? slug
}
