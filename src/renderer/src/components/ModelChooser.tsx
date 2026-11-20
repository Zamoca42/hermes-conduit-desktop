import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@shared/i18n'
import { groupModels, typedModelId, typedModelProviders, type ModelProviderRow } from '../state/models'
import { isPinned, pinnedRows, recentRows } from '../state/modelQuickPicks'
import { chooserLines, chooserListed, chooserPick, chooserValue, providerStartsOpen } from '../state/modelChooser'
import { useModelQuickPicks } from './ModelOptions'
import { ProviderLogo } from './ProviderLogo'
import { Icon } from './icons'

interface Props {
  /** "provider\nmodel", or '' for the setting's default. */
  value: string
  onChange: (value: string) => void
  providers: ModelProviderRow[] | null
  /** The setting's own default, first in the list ("Same as chats", "Profile default"); null when the setting has none. */
  defaultLabel: string | null
  /** The row's name when nothing is picked and there's no default to name. */
  emptyLabel?: string
  label: string
  disabled?: boolean
  className?: string
}

/**
 * A model setting's row, naming its model and provider, which opens the
 * Model page: the pick on top, the setting's default first, then search,
 * Quick picks and every provider, closed (the phone's ModelChooserPage,
 * Eric 2026-11-08: no drop-down menus). The setting keeps its own saves;
 * this only hands back a pick.
 */
export function ModelChooser({ value, onChange, providers, defaultLabel, emptyLabel, label, disabled, className }: Props) {
  const [open, setOpen] = useState(false)
  const lines = chooserLines(value, providers, defaultLabel ?? emptyLabel ?? t('Not set'))
  return (
    <>
      <button
        type="button"
        className={`model-chooser-row${className ? ` ${className}` : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="model-chooser-title">{lines.title}</span>
        {lines.detail ? <span className="meta model-chooser-detail">{lines.detail}</span> : null}
        <Icon name="chevron" />
      </button>
      {open ? (
        <ModelChooserPage
          value={value}
          providers={providers}
          defaultLabel={defaultLabel}
          label={label}
          onClose={() => setOpen(false)}
          onPick={next => {
            setOpen(false)
            if (next !== value) onChange(next)
          }}
        />
      ) : null}
    </>
  )
}

function ModelChooserPage({
  value,
  providers,
  defaultLabel,
  label,
  onClose,
  onPick
}: {
  value: string
  providers: ModelProviderRow[] | null
  defaultLabel: string | null
  label: string
  onClose: () => void
  onPick: (value: string) => void
}) {
  const [query, setQuery] = useState('')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => search.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const all = useMemo(() => groupModels(providers ?? [], ''), [providers])
  const groups = useMemo(() => groupModels(providers ?? [], query), [providers, query])
  const quick = useModelQuickPicks()
  const searching = !!query.trim()
  const current = value ? chooserPick(value) : null
  const pinned = searching ? [] : pinnedRows(quick.picks, providers ?? [])
  const recent = searching ? [] : recentRows(quick.picks, providers ?? [], current)
  const typedId = typedModelId(query)
  const typedProviders = typedId && providers ? typedModelProviders(providers, typedId, current?.provider) : []
  const name = (slug: string) => providers?.find(p => p.slug === slug)?.name || slug
  const lines = chooserLines(value, providers, defaultLabel ?? t('Not set'))

  function row(model: string, provider: string, withProvider: boolean) {
    const v = chooserValue(provider, model)
    const on = v === value
    const pin = isPinned(quick.picks, { model, provider })
    return (
      <div key={v} className={`model-row-wrap${pin ? ' pinned' : ''}`}>
        <button className={`model-row${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onPick(v)}>
          <span className="model-row-name">{model}</span>
          {withProvider ? <span className="meta model-row-provider">{name(provider)}</span> : null}
          {on ? <Icon name="check" /> : null}
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

  // On the body, so a settings sheet's transform or overflow never clips it; its clicks stay its own.
  return createPortal(
    <div
      className="shortcuts-backdrop"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="model-picker model-chooser" role="dialog" aria-label={label}>
        <div className="model-current">
          <span className="model-current-name">{lines.title}</span>
          {lines.detail ? <span className="meta">{lines.detail}</span> : null}
          {value && !chooserListed(value, all) ? <span className="meta">{t('Saved')}</span> : null}
          <button className="staged-remove" aria-label={t('Close')} onClick={onClose}>
            <Icon name="close" />
          </button>
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
              onPick(chooserValue(groups[0].slug, groups[0].models[0]))
            }
          }}
        />
        <div className="model-list">
          {defaultLabel !== null && !searching ? (
            <section className="model-group">
              <div className="model-row-wrap">
                <button className={`model-row${!value ? ' on' : ''}`} aria-pressed={!value} onClick={() => onPick('')}>
                  <span className="model-row-name">{defaultLabel}</span>
                  {!value ? <Icon name="check" /> : null}
                </button>
              </div>
            </section>
          ) : null}
          {providers && searching && !groups.length ? <div className="model-note">{t('Nothing matches “{query}”.', { query: query.trim() })}</div> : null}
          {pinned.length || recent.length ? (
            <section className="model-group model-quick" aria-label={t('Quick picks')}>
              {pinned.length ? <div className="model-group-name">{t('Pinned')}</div> : null}
              {pinned.map(p => row(p.model, p.provider, true))}
              {recent.length ? <div className="model-group-name">{t('Recent')}</div> : null}
              {recent.map(p => row(p.model, p.provider, true))}
            </section>
          ) : null}
          {groups.map(group => {
            const opened = toggled[group.slug] ?? providerStartsOpen(group.slug, value, query)
            return (
              <section key={group.slug} className="model-group">
                <button
                  className="model-group-name model-group-toggle"
                  aria-expanded={opened}
                  onClick={() => setToggled(s => ({ ...s, [group.slug]: !opened }))}
                >
                  <ProviderLogo slug={group.slug} title={group.name} size={16} />
                  <span className="model-row-name">{group.name}</span>
                  <span className="meta">{group.models.length}</span>
                  <Icon name={opened ? 'chevronDown' : 'chevron'} />
                </button>
                {opened ? group.models.map(model => row(model, group.slug, false)) : null}
              </section>
            )
          })}
          {typedId && typedProviders.length ? (
            <section className="model-group model-typed" aria-label={t('Use “{id}” as a model ID', { id: typedId })}>
              <div className="model-group-name">{t('Use “{id}” as a model ID', { id: typedId })}</div>
              {typedProviders.map(provider => row(typedId, provider.slug, true))}
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
