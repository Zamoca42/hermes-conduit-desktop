/**
 * Getting a profile ready for rooms with other people's agents, after the
 * phone's RoomSetup.swift: rooms reach an agent through Hermes' API server,
 * and the plugin's `/rooms/setup` says what that profile still needs (the
 * server on, a key of its own, the tools rooms may let it use, its approvals
 * back on, a gateway restart) and does it.
 */
import { t } from '../../../shared/i18n'
import { ROOMS_PATH, type Http } from './roomLinks'

export const ROOM_SETUP_CAPABILITY = 'room-setup'
/** The plugin scopes room routes by ?conduit_profile= instead of ?profile=. */
export const ROOM_DASHBOARD_PROFILES_CAPABILITY = 'room-dashboard-profiles'
export const SETUP_PATH = `${ROOMS_PATH}/setup`
const LOOKUP_TOOLSETS = new Set(['session_search', 'vision', 'web', 'x_search'])

export interface SetupChoice {
  id: string
  label: string
  description: string
  /** Rooms that look things up or search past chats use it; the rest only a room set to Custom. */
  lookup: boolean
  never: string[]
}

export interface RoomSetupState {
  ready: boolean
  needs: string[]
  changes: string[]
  blockers: { code: string; message: string }[]
  profile: string
  apiServer: { enabled: boolean; keySet: boolean; profileKeySet: boolean; address: string; running: boolean; error: string | null }
  ceiling: string[]
  choices: SetupChoice[]
  mcpServers: string[]
  /** The MCP servers it can name, or null from a plugin that can't. */
  mcpChoices: string[] | null
}

export interface SetupResult {
  state: RoomSetupState
  restart: { started: boolean; busy: boolean; error: string | null } | null
}

type Row = Record<string, unknown>
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null)
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v) : [])

export function parseSetup(body: unknown): RoomSetupState {
  const o = obj(body)
  const server = obj(o?.api_server)
  if (o?.ok !== true || typeof o.ready !== 'boolean' || !Array.isArray(o.needs) || !server || typeof server.address !== 'string' || !Array.isArray(o.ceiling))
    throw new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))
  return {
    ready: o.ready,
    needs: strings(o.needs),
    changes: strings(o.changes),
    blockers: (Array.isArray(o.blockers) ? o.blockers : []).flatMap(b => {
      const message = obj(b)?.message
      return typeof message === 'string' ? [{ code: typeof obj(b)?.code === 'string' ? (obj(b)!.code as string) : '', message }] : []
    }),
    profile: typeof o.profile === 'string' ? o.profile : '',
    apiServer: {
      enabled: server.enabled === true,
      keySet: server.key_set === true,
      profileKeySet: server.profile_key_set === true,
      address: server.address,
      running: server.running === true,
      error: text(server.error)
    },
    ceiling: strings(o.ceiling),
    choices: (Array.isArray(o.choices) ? o.choices : []).flatMap(c => {
      const r = obj(c)
      const id = typeof r?.id === 'string' ? r.id : ''
      if (!r || !id) return []
      return [
        {
          id,
          label: typeof r.label === 'string' ? r.label : id,
          description: typeof r.description === 'string' ? r.description : '',
          lookup: typeof r.lookup === 'boolean' ? r.lookup : LOOKUP_TOOLSETS.has(id),
          never: strings(r.never)
        }
      ]
    }),
    mcpServers: strings(o.mcp_servers),
    mcpChoices: Array.isArray(o.mcp_choices) ? o.mcp_choices.flatMap(c => (typeof obj(c)?.id === 'string' && obj(c)!.id ? [obj(c)!.id as string] : [])) : null
  }
}

const same = (a: Iterable<string>, b: Iterable<string>) => {
  const x = new Set(a)
  const y = new Set(b)
  return x.size === y.size && [...x].every(v => y.has(v))
}

/** The MCP servers it can name and has off: they stay saved as they are. */
const serversOff = (state: RoomSetupState) => (state.mcpChoices ? state.mcpServers.filter(s => !state.mcpChoices!.includes(s)) : [])
const serversOn = (state: RoomSetupState) => (state.mcpChoices ? state.mcpServers.filter(s => state.mcpChoices!.includes(s)) : [])

function changesServers(state: RoomSetupState, servers: ReadonlySet<string>): boolean {
  if (!state.mcpChoices) return false
  const off = new Set(serversOff(state))
  return !same([...servers].filter(s => !off.has(s)), serversOn(state))
}

/** The tools to save, in the plugin's order, or null when they didn't change. */
export const ceilingToSave = (state: RoomSetupState, picked: ReadonlySet<string>): string[] | null =>
  same(picked, state.ceiling) ? null : state.choices.map(c => c.id).filter(id => picked.has(id))

export const mcpServersToSave = (state: RoomSetupState, servers: ReadonlySet<string>): string[] | null =>
  state.mcpChoices && changesServers(state, servers) ? [...state.mcpChoices.filter(s => servers.has(s)), ...serversOff(state)] : null

/** Whether a save changes what rooms already started hold the agent to. */
export const changesSavedCeiling = (state: RoomSetupState, picked: ReadonlySet<string>, servers: ReadonlySet<string>) =>
  (!same(picked, state.ceiling) || changesServers(state, servers)) && !state.changes.includes('ceiling')

export const mcpServersInUse = serversOn

const list = (items: readonly string[]) => {
  try {
    return new Intl.ListFormat(undefined, { type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

/** What Set up does, one line each, in the order the plugin does it. */
export function setupLines(state: RoomSetupState, name: string): string[] {
  const changes = new Set(state.changes)
  const address = state.apiServer.address
  const lines: string[] = []
  if (changes.has('api_server_key')) lines.push(t("Turn on Hermes' API server at {address}, with a new key that stays on your Hermes", { address }))
  else if (changes.has('api_server_enabled') || changes.has('api_server_port')) lines.push(t("Turn on Hermes' API server at {address}, with the key it has", { address }))
  if (changes.has('profile_key')) lines.push(t("Give {name} its own key for the API server, which serves a profile's agent only with that profile's key", { name }))
  if (changes.has('ceiling')) lines.push(t('Save the tools rooms may let {name} use', { name }))
  if (changes.has('plugin_tools')) lines.push(t('Keep tools that plugins and Hermes updates add out of rooms until you add them here'))
  if (changes.has('approvals')) lines.push(t("Turn {name}'s approvals back on, since rooms refuse an agent that runs tools without asking", { name }))
  if (state.needs.includes('restart')) lines.push(t('Restart the gateway, which starts the API server'))
  return lines
}

export function toolsLine(state: RoomSetupState, name: string): string {
  const labels = state.ceiling.map(id => state.choices.find(c => c.id === id)?.label ?? id)
  if (!labels.length) return t("Rooms can't let {name} use tools: it only talks there.", { name })
  return t('Rooms may let {name} use {list}.', { name, list: list(labels) })
}

export function serversLine(state: RoomSetupState): string | null {
  const used = serversOn(state)
  return used.length ? t("MCP servers too: {list}, in rooms whose Custom choice names their tools.", { list: list(used) }) : null
}

export function customOn(state: RoomSetupState, picked: ReadonlySet<string>): string | null {
  const labels = state.choices.filter(c => !c.lookup && picked.has(c.id)).map(c => c.label)
  return labels.length ? t('On: {list}', { list: list(labels) }) : null
}

export const neverLine = (choice: SetupChoice): string | null => (choice.never.length ? t('Never in rooms: {list}', { list: list(choice.never) }) : null)

/** The plugin's `/rooms/setup`, scoped to the profile. */
export function roomSetupClient(http: Http, conduitProfile: boolean) {
  const path = (profile: string) => (profile === 'default' ? SETUP_PATH : `${SETUP_PATH}?${conduitProfile ? 'conduit_profile' : 'profile'}=${encodeURIComponent(profile)}`)
  return {
    state: async (profile: string) => parseSetup(await http('GET', path(profile))),
    setUp: async (profile: string, ceiling: string[] | null, mcpServers: string[] | null, interrupt = false): Promise<SetupResult> => {
      const body: Row = { interrupt }
      if (ceiling) body.ceiling = ceiling
      if (mcpServers) body.mcp_servers = mcpServers
      const answer = await http('POST', path(profile), body)
      const restart = obj(obj(answer)?.restart)
      return {
        state: parseSetup(answer),
        restart: restart ? { started: restart.started === true, busy: restart.busy === true, error: text(restart.error) } : null
      }
    }
  }
}
