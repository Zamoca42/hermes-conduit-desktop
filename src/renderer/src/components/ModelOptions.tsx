import { useCallback, useContext, useSyncExternalStore } from 'react'
import { SummaryHost } from '../state/useStepSummaries'
import { picksFor, recordSwitch, subscribePicks, togglePin, updatePicks, type ModelPick } from '../state/modelQuickPicks'

/** This host's Quick picks, with Pin/Unpin and a switch's record. */
export function useModelQuickPicks() {
  const host = useContext(SummaryHost)
  const picks = useSyncExternalStore(subscribePicks, () => picksFor(host))
  const toggle = useCallback((pick: ModelPick) => updatePicks(host, p => togglePin(p, pick)), [host])
  const switched = useCallback((to: ModelPick, from?: ModelPick | null) => updatePicks(host, p => recordSwitch(p, to, from)), [host])
  return { picks, toggle, switched }
}
