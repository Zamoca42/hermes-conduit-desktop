import { describe, expect, it } from 'vitest'
import {
  advancedSections,
  chatSections,
  resolveTimeZone,
  fieldValue,
  listLines,
  workspaceSections,
  memorySections,
  pluginChoices,
  pluginRouteBody,
  schemaKeys,
  shownFields,
  updateConfig,
  valueAt,
  withChoices,
  withValue,
  type Http
} from '../src/renderer/src/state/profileConfig'

const delegation = () => memorySections().find(s => s.fields.some(f => f.key.startsWith('delegation.')))!

describe('profile config rows', () => {
  it("shows a row only when Hermes' schema lists it, every row when it can't say", () => {
    const schema = schemaKeys({ fields: { 'delegation.max_iterations': {} } })
    const keys = shownFields(delegation(), schema).map(f => f.key)
    expect(keys).toEqual(['delegation.max_concurrent_children', 'delegation.max_iterations'])
    expect(shownFields(delegation(), schemaKeys(null)).length).toBe(delegation().fields.length)
  })

  it("reads a value, or the row's default", () => {
    const field = delegation().fields[0]
    expect(fieldValue({ delegation: { max_concurrent_children: 4 } }, field)).toBe(4)
    expect(fieldValue({ delegation: { max_concurrent_children: '6' } }, field)).toBe(6)
    expect(fieldValue({}, field)).toBe(10)
    const toggle = delegation().fields.find(f => f.key === 'delegation.orchestrator_enabled')!
    expect(fieldValue({ delegation: { orchestrator_enabled: 'yes' } }, toggle)).toBe(true)
    expect(valueAt({ a: { b: null } }, 'a.b')).toBeNull()
    expect(valueAt({ a: 1 }, 'a.b')).toBeUndefined()
  })

  it('sets a nested value without changing the original', () => {
    const config = { delegation: { model: 'x', max_iterations: 250 }, other: [1] }
    const next = withValue(config, 'delegation.max_iterations', 40)
    expect(next).toEqual({ delegation: { model: 'x', max_iterations: 40 }, other: [1] })
    expect(config.delegation.max_iterations).toBe(250)
    expect(withValue({}, 'auxiliary.compression.timeout', 300)).toEqual({ auxiliary: { compression: { timeout: 300 } } })
  })
})

describe('updateConfig', () => {
  it('saves one at a time, each on the config the last one wrote', async () => {
    let stored: Record<string, unknown> = { a: 0 }
    const calls: string[] = []
    const http: Http = async (method, path, body) => {
      calls.push(`${method} ${path}`)
      await new Promise(r => setTimeout(r, 5))
      if (method === 'GET') return structuredClone(stored)
      stored = (body as { config: Record<string, unknown> }).config
      return {}
    }
    await Promise.all([
      updateConfig(http, 'default', c => withValue(c, 'x', 1)),
      updateConfig(http, 'default', c => withValue(c, 'y', 2)),
      updateConfig(http, 'furina', c => c)
    ])
    expect(stored).toEqual({ a: 0, x: 1, y: 2 })
    expect(calls).toEqual([
      'GET /api/config',
      'PUT /api/config',
      'GET /api/config',
      'PUT /api/config',
      'GET /api/config?profile=furina',
      'PUT /api/config?profile=furina'
    ])
  })

  it('keeps the queue going after a save fails', async () => {
    const failing: Http = async () => {
      throw new Error('down')
    }
    await expect(updateConfig(failing, 'default', c => c)).rejects.toThrow('down')
    const ok: Http = async method => (method === 'GET' ? { a: 1 } : {})
    await expect(updateConfig(ok, 'default', c => c)).resolves.toEqual({ a: 1 })
  })
})

describe('plugin choices', () => {
  const hub = {
    providers: {
      memory_options: [
        { name: 'retaindb', status: 'needs_config' },
        { name: 'honcho', status: 'ready' }
      ],
      context_options: [{ name: 'lcm' }]
    }
  }
  it('lists ready memory providers and every context engine', () => {
    expect(pluginChoices(hub)).toEqual({ 'memory.provider': ['honcho'], 'context.engine': ['compressor', 'lcm'] })
    expect(pluginChoices(null)['context.engine']).toEqual(['compressor'])
  })
  it('offers the built-in memory and keeps an unlisted current value', () => {
    const field = memorySections()[0].fields.find(f => f.key === 'memory.provider')!
    const shown = withChoices(field, pluginChoices(hub), 'byterover')
    expect(shown.control.kind === 'options' && shown.control.options.map(o => o.value)).toEqual(['', 'honcho', 'byterover'])
  })
  it('sends the main profile through Hermes’ own route', () => {
    expect(pluginRouteBody('default', 'memory.provider', 'honcho')).toEqual({ memory_provider: 'honcho' })
    expect(pluginRouteBody('nova', 'context.engine', 'lcm')).toBeNull()
    expect(pluginRouteBody('', 'memory.memory_enabled', true)).toBeNull()
  })
})

describe('workspace and advanced rows', () => {
  const field = (key: string) => [...workspaceSections(), ...advancedSections()].flatMap(s => s.fields).find(f => f.key === key)!
  it('reads lists one per line and text as it is', () => {
    expect(fieldValue({ command_allowlist: ['git *', 3, null] }, field('command_allowlist'))).toBe('git *\n3')
    expect(fieldValue({}, field('terminal.env_passthrough'))).toBe('')
    expect(fieldValue({ terminal: { cwd: '/srv' } }, field('terminal.cwd'))).toBe('/srv')
    expect(fieldValue({}, field('approvals.mode'))).toBe('smart')
    expect(fieldValue({}, field('agent.api_max_retries'))).toBe(3)
    const engine = memorySections()[1].fields.find(f => f.key === 'context.engine')!
    expect(fieldValue({ context: { engine: 'default' } }, engine)).toBe('compressor')
    expect(fieldValue({ context: { engine: 'lcm' } }, engine)).toBe('lcm')
  })
  it('saves a list trimmed, blanks left out', () => {
    expect(listLines(' git *\n\n  ls -la \n')).toEqual(['git *', 'ls -la'])
  })
})

describe('chat rows', () => {
  it('offers the built-in personalities and the profile’s own', () => {
    const field = chatSections({ agent: { personalities: { mentor: 'Be wise', helpful: 'x' } } })[0].fields[0]
    const values = field.control.kind === 'options' ? field.control.options.map(o => o.value) : []
    expect(values[0]).toBe('')
    expect(values.filter(v => v === 'helpful')).toHaveLength(1)
    expect(values.at(-1)).toBe('mentor')
  })
  it('resolves time zones as Hermes takes them', () => {
    expect(resolveTimeZone('')).toBe('')
    expect(resolveTimeZone('america/new york')).toBe('America/New_York')
    expect(resolveTimeZone('utc')).toBe('UTC')
    expect(resolveTimeZone('Mars/Olympus')).toBeNull()
  })
})
