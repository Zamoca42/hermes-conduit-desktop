import { describe, expect, it } from 'vitest'
import { codeAnswer, inputAnswer, inputPromptView, loginAnswer, loginSite } from '../src/renderer/src/state/inputPrompts'
import { isInputPrompt, isNeedsYouRequest } from '../src/shared/ipc'

const view = (method: string, params: Record<string, unknown> = {}) => inputPromptView({ method: method as never, params })

describe('passwords, logins and codes Hermes asks for', () => {
  it('draws a card for each kind', () => {
    expect(view('sudo', { command: 'apt install ffmpeg' })).toMatchObject({
      kind: 'sudo',
      title: 'Hermes needs your sudo password',
      detail: 'apt install ffmpeg',
      masked: true
    })
    expect(view('secret', { env_var: 'OPENAI_API_KEY', prompt: 'Your OpenAI key' })).toMatchObject({ title: 'Your OpenAI key', detail: 'OPENAI_API_KEY' })
    expect(view('secret', { env_var: 'X' })?.title).toBe('Hermes needs a secret value')
    expect(view('vault.unlock_prompt', { backend: 'bitwarden', display_name: 'Bitwarden' })?.title).toBe('Unlock Bitwarden')
    expect(view('vault.unlock_prompt', { backend: 'op' })?.title).toBe('Unlock op')
    expect(view('vault.save_login', { origin: 'https://login.example.com', site: 'Evil Corp' })).toMatchObject({
      title: 'Save your login.example.com login?',
      detail: 'https://login.example.com',
      login: true,
      send: 'Save & sign in',
      skip: "Don't save"
    })
    expect(view('vault.code', { site: 'GitHub', hint: '' })).toMatchObject({ title: 'Verification code for GitHub', masked: false, send: 'Enter code' })
    expect(view('vault.code')?.title).toBe('Verification code')
  })

  it('draws no card for a login with no origin, or another request', () => {
    expect(view('vault.save_login', { site: 'x' })).toBeNull()
    expect(view('approval')).toBeNull()
    expect(loginSite('not a url')).toBe('not a url')
  })

  it('answers as Hermes Desktop does', () => {
    expect(loginAnswer('  me@x.com ', ' pa ss ')).toBe(JSON.stringify({ identifier: 'me@x.com', password: ' pa ss ' }))
    expect(loginAnswer('me', '   ')).toBeNull()
    expect(loginAnswer('', 'pw')).toBeNull()
    expect(codeAnswer('123 45-6')).toBe('123456')
    expect(inputAnswer('vault.code', ' - ')).toBeNull()
    expect(inputAnswer('sudo', '   ')).toBeNull()
    expect(inputAnswer('sudo', ' hunter2 ')).toBe(' hunter2 ')
    expect(inputAnswer('vault.save_login', 'pw', 'me')).toBe('{"identifier":"me","password":"pw"}')
  })

  it('lists them in Needs you', () => {
    for (const method of ['sudo', 'secret', 'vault.unlock_prompt', 'vault.save_login', 'vault.code']) {
      expect(isInputPrompt({ method })).toBe(true)
      expect(isNeedsYouRequest({ method })).toBe(true)
    }
    expect(isInputPrompt({ method: 'display.install.sudo' })).toBe(false)
  })
})
