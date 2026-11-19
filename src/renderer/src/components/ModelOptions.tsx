import { t } from '@shared/i18n'
import type { ModelProviderRow } from '../state/models'
import { useCallback, useContext, useSyncExternalStore } from 'react'
import { SummaryHost } from '../state/useStepSummaries'
import { picksFor, pinnedRows, recentRows, recordSwitch, subscribePicks, togglePin, updatePicks, type ModelPick } from '../state/modelQuickPicks'

/** This host's Quick picks, with Pin/Unpin and a switch's record. */
export function useModelQuickPicks() {
  const host = useContext(SummaryHost)
  const picks = useSyncExternalStore(subscribePicks, () => picksFor(host))
  const toggle = useCallback((pick: ModelPick) => updatePicks(host, p => togglePin(p, pick)), [host])
  const switched = useCallback((to: ModelPick, from?: ModelPick | null) => updatePicks(host, p => recordSwitch(p, to, from)), [host])
  return { picks, toggle, switched }
}

/**
 * A model setting's list: Pinned and Recent first, then every provider, as
 * the phone's shared Model page lists them (#1992). Each option's value is
 * "provider\nmodel".
 */
export function ModelOptions({ providers, groups }: { providers: ModelProviderRow[]; groups: { slug: string; name: string; models: string[] }[] }) {
  const { picks } = useModelQuickPicks()
  const pinned = pinnedRows(picks, providers)
  const recent = recentRows(picks, providers)
  const name = (slug: string) => providers.find(p => p.slug === slug)?.name || slug
  return (
    <>
      {pinned.length ? (
        <optgroup label={t('Pinned')}>
          {pinned.map(p => (
            <option key={`${p.provider}\n${p.model}`} value={`${p.provider}\n${p.model}`}>
              {`${p.model} · ${name(p.provider)}`}
            </option>
          ))}
        </optgroup>
      ) : null}
      {recent.length ? (
        <optgroup label={t('Recent')}>
          {recent.map(p => (
            <option key={`${p.provider}\n${p.model}`} value={`${p.provider}\n${p.model}`}>
              {`${p.model} · ${name(p.provider)}`}
            </option>
          ))}
        </optgroup>
      ) : null}
      {groups.map(group => (
        <optgroup key={group.slug} label={group.name}>
          {group.models.map(model => (
            <option key={model} value={`${group.slug}\n${model}`}>
              {model}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}
