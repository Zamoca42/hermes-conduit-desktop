import { beforeEach, describe, expect, it } from 'vitest'
import {
  KEPT_ROUTES,
  answerKeeper,
  forgetKeptAnswers,
  isCredentialName,
  keptAnswer,
  setKeptAnswersHost,
  withoutCredentials
} from '../src/renderer/src/state/keptAnswers'

class Store {
  map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
}

let store: Store
beforeEach(() => {
  store = new Store()
  setKeptAnswersHost('')
  setKeptAnswersHost('https://a')
})

describe('kept answers', () => {
  it('keep an answer per dashboard and route, and give it back on the next run', () => {
    answerKeeper('/api/skills', store)([{ name: 'web' }])
    expect(keptAnswer('/api/skills', store)).toEqual([{ name: 'web' }])
    setKeptAnswersHost('https://b')
    expect(keptAnswer('/api/skills', store)).toBeUndefined()
    setKeptAnswersHost('https://a')
    expect(keptAnswer('/api/skills', store)).toEqual([{ name: 'web' }])
  })

  it('drop an answer that lands after a switch to another dashboard', () => {
    const keep = answerKeeper('/api/skills', store)
    setKeptAnswersHost('https://b')
    keep(['late'])
    expect(keptAnswer('/api/skills', store)).toBeUndefined()
    setKeptAnswersHost('https://a')
    expect(keptAnswer('/api/skills', store)).toBeUndefined()
  })

  it('keep the newest routes only', () => {
    for (let i = 0; i < KEPT_ROUTES + 5; i++) answerKeeper(`/r/${i}`, store)(i)
    expect(keptAnswer('/r/0', store)).toBeUndefined()
    expect(keptAnswer(`/r/${KEPT_ROUTES + 4}`, store)).toBe(KEPT_ROUTES + 4)
  })

  it('go with a dashboard that was signed out', () => {
    answerKeeper('/api/skills', store)([1])
    forgetKeptAnswers(['https://b'], store)
    expect(store.length).toBe(0)
    expect(keptAnswer('/api/skills', store)).toBeUndefined()
  })
})

describe('credentials', () => {
  it('are names ending in key, token, secret, cookie or auth, or naming a password', () => {
    for (const name of ['api_key', 'OPENAI_API_KEY', 'keys', 'access_token', 'client_secret', 'cookie', 'oauth', 'Authorization', 'auth_header', 'password', 'db_passwd', 'credentials'])
      expect(isCredentialName(name), name).toBe(true)
    for (const name of ['name', 'model', 'provider', 'monkeys_count', 'enabled']) expect(isCredentialName(name), name).toBe(false)
  })

  it('are left out at any depth, with a URL’s user, password and keyed query, but counts stay', () => {
    expect(
      withoutCredentials({
        model: 'gpt',
        api_key: 'sk-1',
        input_tokens: 120,
        has_key: true,
        providers: [{ name: 'x', token: 'abc', base_url: 'https://me:pw@host/v1?api_key=s&x=1' }],
        headers: [{ name: 'Authorization', value: 'Bearer t' }, { name: 'Accept', value: 'json' }]
      })
    ).toEqual({
      model: 'gpt',
      input_tokens: 120,
      has_key: true,
      providers: [{ name: 'x', base_url: 'https://host/v1?x=1' }],
      headers: [{ name: 'Authorization' }, { name: 'Accept', value: 'json' }]
    })
  })

  it('never reach the kept file', () => {
    answerKeeper('/api/config', store)({ api_key: 'sk-secret', model: 'm' })
    expect([...store.map.values()].join()).not.toContain('sk-secret')
  })
})
