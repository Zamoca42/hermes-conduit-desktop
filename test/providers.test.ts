import { describe, expect, it } from 'vitest'
import {
  ProviderService,
  blocksSave,
  buildEntries,
  endpointID,
  isBaseURL,
  keyOrderFrom,
  keyOrderKey,
  keyState,
  parseCheck,
  parseOutcome,
  parseSignIn,
  providerStatus,
  showsKeyOrder,
  takenEndpointIDs,
  type Requester
} from '../src/renderer/src/state/providers'

const env = {
  OPENROUTER_API_KEY: {
    category: 'provider',
    is_password: true,
    is_set: false,
    provider: 'openrouter',
    provider_label: 'OpenRouter',
    provider_primary: true,
    url: 'https://openrouter.ai/keys'
  },
  ANTHROPIC_API_KEY: { category: 'provider', is_password: true, is_set: true, provider: 'anthropic', provider_label: 'Anthropic', provider_primary: true },
  NOUS_BASE_URL: { category: 'provider', is_password: false, is_set: false, provider: '', provider_profiles: [] },
  ZAI_BASE_URL: {
    category: 'provider',
    is_password: false,
    is_set: true,
    provider: 'zai',
    provider_label: 'Z.AI',
    provider_primary: false,
    description: 'Base URL'
  },
  SHARED_KEY: {
    category: 'provider',
    is_password: true,
    is_set: true,
    provider_profiles: [
      { provider: 'kimi', provider_label: 'Kimi', primary: true },
      { provider: 'moonshot', provider_label: 'Moonshot', primary: true }
    ]
  },
  BORROWED: { category: 'provider', is_password: true, is_set: false, provider_profiles: [{ provider: 'lender', provider_label: 'Lender', primary: false }] },
  TELEGRAM_TOKEN: { category: 'messaging', is_password: true, is_set: true }
}
const accounts = {
  providers: [
    { id: 'nous', name: 'Nous Portal', flow: 'device_code', cli_command: 'hermes auth add nous', disconnectable: true, status: { logged_in: true } },
    { id: 'qwen-oauth', name: 'Qwen', flow: 'external', disconnectable: false, status: { logged_in: false } },
    { id: 'weird', flow: 'magic' }
  ]
}
const endpoints = {
  endpoints: [{ id: 'lab', name: 'Lab vLLM', base_url: 'http://lab:8000/v1', model: 'qwen', models: ['qwen'], has_api_key: true, is_current: true }]
}
const sharedPool = {
  providers: [
    {
      provider: 'openrouter',
      entries: [
        { id: 'env1', index: 1, label: 'OPENROUTER_API_KEY', source: 'env:OPENROUTER_API_KEY', auth_type: 'api_key' },
        { id: 's1', index: 2, label: 'Conduit (all profiles)', source: 'manual', auth_type: 'api_key' }
      ]
    }
  ]
}

const byID = (list: ReturnType<typeof buildEntries>) => new Map(list.map(e => [e.id, e]))

describe('buildEntries', () => {
  it('reads keys, settings, sign-ins and endpoints, by name', () => {
    const list = buildEntries({ env, accounts, endpoints, sharedPool, onMainProfile: true })
    const m = byID(list)
    expect(list.map(e => e.name)).toEqual(['Anthropic', 'Kimi', 'Lab vLLM', 'Lender', 'Moonshot', 'Nous Portal', 'OpenRouter', 'Qwen', 'Z.AI'])
    expect(providerStatus(m.get('openrouter')!)).toBe('sharedKey')
    expect(m.get('openrouter')!.key!.sharedRows.map(r => r.id)).toEqual(['s1'])
    expect(providerStatus(m.get('anthropic')!)).toBe('mainProfileOnly')
    expect(providerStatus(m.get('nous')!)).toBe('signedIn')
    expect(providerStatus(m.get('qwen-oauth')!)).toBe('notConnected')
    expect(providerStatus(m.get('endpoint:lab')!)).toBe('customEndpoint')
    expect(providerStatus(m.get('zai')!)).toBe('configured')
    expect(m.get('lender')!.key!.borrowedOnly).toBe(true)
    // A variable two providers read as their own is held: never removed for either.
    expect(m.get('kimi')!.key!.heldVars).toEqual(['SHARED_KEY'])
    expect(m.has('weird')).toBe(false)
  })

  it("tells another profile's key apart: shared, its own, an old copy", () => {
    const shared = buildEntries({ env, sharedPool, profilePool: { providers: [] }, onMainProfile: false })
    expect(keyState(byID(shared).get('openrouter')!)).toBe('shared')
    const own = buildEntries({
      env,
      sharedPool,
      profilePool: { providers: [{ provider: 'openrouter', entries: [{ id: 'p1', index: 1, label: 'Conduit (this profile)', source: 'manual' }] }] },
      onMainProfile: false
    })
    expect(keyState(byID(own).get('openrouter')!)).toBe('own')
    const copy = buildEntries({
      env,
      sharedPool,
      profilePool: { providers: [{ provider: 'openrouter', entries: [{ id: 'old', index: 1, label: 'Conduit (all profiles)', source: 'manual' }] }] },
      onMainProfile: false
    })
    expect(providerStatus(byID(copy).get('openrouter')!)).toBe('oldCopy')
    const copied = buildEntries({
      env,
      sharedPool,
      profilePool: { providers: [{ provider: 'openrouter', entries: [{ id: 's1', index: 1, label: 'Conduit (all profiles)', source: 'manual' }] }] },
      onMainProfile: false
    })
    expect(keyState(byID(copied).get('openrouter')!)).toBe('shared')
  })
})

describe('answers', () => {
  it('reads a check, a sign-in and its outcome', () => {
    expect(blocksSave(parseCheck({ ok: false, reachable: true, message: 'bad key' }))).toBe(true)
    expect(blocksSave(parseCheck({ ok: false, reachable: false }))).toBe(false)
    expect(parseCheck({ ok: true, models: ['a', 2] }).models).toEqual(['a'])
    expect(parseSignIn({ session_id: 's', user_code: 'ABCD', verification_url: 'https://x.test/device', poll_interval: 0 })).toEqual({
      sessionID: 's',
      userCode: 'ABCD',
      verificationURL: 'https://x.test/device',
      pollInterval: 1
    })
    expect(parseSignIn({ session_id: 's', verification_url: 'javascript:alert(1)' })?.verificationURL).toBeUndefined()
    expect(parseSignIn({})).toBeNull()
    expect(parseOutcome({ status: 'approved' }).kind).toBe('approved')
    expect(parseOutcome({}).kind).toBe('pending')
    expect(parseOutcome({ status: 'error', error_message: 'nope' })).toEqual({ kind: 'failed', message: 'nope' })
  })

  it('names a new endpoint clear of every taken name', () => {
    const taken = takenEndpointIDs(buildEntries({ env, endpoints, onMainProfile: true }), ['custom:together', 'OpenAI'])
    expect(endpointID('Lab', taken)).toBe('lab-2')
    expect(endpointID('Together', taken)).toBe('together-2')
    expect(endpointID('openai', taken)).toBe('openai-2')
    expect(endpointID('My Box!', taken)).toBe('my-box')
    expect(endpointID('  ', taken)).toBe('endpoint')
  })
})

function fake(pools: Record<string, { providers: { provider: string; entries: Record<string, unknown>[] }[] }>) {
  const calls: string[] = []
  const request: Requester = async (method, path, body) => {
    calls.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`)
    const profile = new URL(`http://x${path}`).searchParams.get('profile') ?? 'default'
    if (method === 'GET' && path.startsWith('/api/credentials/pool')) return pools[profile] ?? { providers: [] }
    if (method === 'DELETE' && path.startsWith('/api/credentials/pool/')) {
      const index = Number(path.split('?')[0].split('/').pop())
      for (const p of pools[profile]?.providers ?? []) p.entries = p.entries.filter(e => e.index !== index)
    }
    return {}
  }
  return { calls, request }
}

describe('ProviderService', () => {
  it('shares a key: adds the row, then drops the replaced one and its copies, last place first', async () => {
    const { calls, request } = fake({
      default: {
        providers: [
          {
            provider: 'openrouter',
            entries: [
              { id: 'env1', index: 1 },
              { id: 's1', index: 2 }
            ]
          }
        ]
      },
      furina: { providers: [{ provider: 'openrouter', entries: [{ id: 's1', index: 1 }] }] }
    })
    const service = new ProviderService(request, 'default', ['default', 'furina'])
    const entry = byID(buildEntries({ env, sharedPool, onMainProfile: true })).get('openrouter')!
    expect(await service.share(' sk-new ', entry)).toBe(true)
    expect(calls[0]).toBe('POST /api/credentials/pool?profile=default {"provider":"openrouter","api_key":"sk-new","label":"Conduit (all profiles)"}')
    expect(calls).toContain('DELETE /api/credentials/pool/openrouter/2?profile=default')
    expect(calls).toContain('DELETE /api/credentials/pool/openrouter/1?profile=furina')
    expect(calls.some(c => c.includes('pool/openrouter/1?profile=default'))).toBe(false)
  })

  it('overrides on another profile: its own row, then the shared copies and its .env key go', async () => {
    const { calls, request } = fake({
      nahida: { providers: [{ provider: 'anthropic', entries: [{ id: 'e', index: 1, source: 'env:ANTHROPIC_API_KEY' }] }] }
    })
    const service = new ProviderService(request, 'nahida', ['default', 'nahida'])
    const entry = byID(
      buildEntries({
        env,
        profilePool: { providers: [{ provider: 'anthropic', entries: [{ id: 'e', index: 1, label: '', source: 'env:ANTHROPIC_API_KEY' }] }] },
        onMainProfile: false
      })
    ).get('anthropic')!
    expect(await service.override('sk-mine', entry)).toBe(true)
    expect(calls[0]).toContain('POST /api/credentials/pool?profile=nahida')
    expect(calls[0]).toContain('"label":"Conduit (this profile)"')
    expect(calls).toContain('DELETE /api/credentials/pool/anthropic/1?profile=nahida')
    expect(calls).toContain('DELETE /api/env?profile=nahida {"key":"ANTHROPIC_API_KEY","profile":"nahida"}')
  })

  it('reports a cleanup that failed as false, the key saved', async () => {
    const request: Requester = async (method, path) => {
      if (method === 'GET' && path.startsWith('/api/credentials/pool')) throw new Error('down')
      return {}
    }
    const service = new ProviderService(request, 'default', ['default'])
    const entry = byID(buildEntries({ env, sharedPool, onMainProfile: true })).get('openrouter')!
    expect(await service.share('sk', entry)).toBe(false)
  })

  it('reads all or nothing, a route an older Hermes lacks as none', async () => {
    const missing = Object.assign(new Error('nope'), { code: 404 })
    const request: Requester = async (_m, path) => {
      if (path.startsWith('/api/env')) return env
      throw missing
    }
    const list = await new ProviderService(request, 'default', []).read()
    expect(list.some(e => e.id === 'openrouter')).toBe(true)
    const failing: Requester = async (_m, path) => {
      if (path.startsWith('/api/env')) return env
      throw Object.assign(new Error('boom'), { code: 500 })
    }
    await expect(new ProviderService(failing, 'default', []).read()).rejects.toThrow('boom')
  })
})

describe('key order', () => {
  it('counts the keys Hermes takes turns over on each profile', () => {
    const main = byID(buildEntries({ env, sharedPool, onMainProfile: true })).get('openrouter')!
    // The main profile reads its whole pool, `.env` rows included.
    expect(main.key!.keysInUse).toBe(2)
    expect(showsKeyOrder(main)).toBe(true)
    // Another profile on the shared key reads only the pasted rows.
    const other = byID(buildEntries({ env, sharedPool, profilePool: { providers: [] }, onMainProfile: false })).get('openrouter')!
    expect(other.key!.keysInUse).toBe(1)
    expect(showsKeyOrder(other)).toBe(false)
    const own = byID(
      buildEntries({
        env,
        sharedPool,
        profilePool: {
          providers: [
            {
              provider: 'openrouter',
              entries: [
                { id: 'p1', index: 1, label: 'a', source: 'manual' },
                { id: 'p2', index: 2, label: 'b', source: 'device_code', auth_type: 'oauth' }
              ]
            }
          ]
        },
        onMainProfile: false
      })
    ).get('openrouter')!
    expect([own.key!.keysInUse, own.key!.signInsInUse]).toEqual([2, 1])
  })
  it('reads the stored order as Hermes does', () => {
    expect(keyOrderFrom(' Round_Robin ')).toBe('round_robin')
    expect(keyOrderFrom('nonsense')).toBe('fill_first')
    expect(keyOrderFrom(undefined)).toBe('fill_first')
    expect(keyOrderKey('openrouter')).toBe('credential_pool_strategies.openrouter')
    expect(keyOrderKey('custom:together.ai')).toBeNull()
    expect(isBaseURL('OPENROUTER_BASE_URL')).toBe(true)
  })
})
