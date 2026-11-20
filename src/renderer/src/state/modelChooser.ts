import type { ModelProviderRow } from './models'

/**
 * A model setting's value, as each setting keeps it: "provider\nmodel", or ''
 * for the setting's own default ("Same as chats", "Profile default"…).
 */
export function chooserValue(provider: string, model: string): string {
  return provider || model ? `${provider}\n${model}` : ''
}

export function chooserPick(value: string): { provider: string; model: string } {
  const [provider = '', model = ''] = value.split('\n')
  return { provider, model }
}

/** The row's two lines: the model, and its provider's name (the phone's ModelChooserLinkRow.lines). */
export function chooserLines(value: string, providers: ModelProviderRow[] | null, defaultLabel: string): { title: string; detail: string } {
  if (!value) return { title: defaultLabel, detail: '' }
  const { provider, model } = chooserPick(value)
  const name = providers?.find(p => p.slug === provider)?.name || provider
  return { title: model || name, detail: model ? name : '' }
}

/** Whether a pick is one the catalog lists; one it doesn't stays on top as saved. */
export function chooserListed(value: string, groups: { slug: string; models: string[] }[]): boolean {
  if (!value) return true
  const { provider, model } = chooserPick(value)
  return groups.some(g => g.slug === provider && g.models.includes(model))
}

/**
 * Which providers start open: none while nothing is typed (every provider
 * closed, Eric 2026-11-08), except the one holding the setting's pick; every
 * match while searching.
 */
export function providerStartsOpen(slug: string, value: string, query: string): boolean {
  return !!query.trim() || (!!value && chooserPick(value).provider === slug)
}
