import { describe, expect, it } from 'vitest'
import { fieldProblem, rowProviderId, selectedProvider, speechFields, speechProviders, withFields, withProvider } from '../src/renderer/src/state/hermesSpeech'

const toolset = {
  providers: [
    { name: 'Microsoft Edge TTS', tts_provider: 'edge', status: 'ready', env_vars: [] },
    { name: 'OpenAI TTS', tts_provider: 'openai', status: 'needs_keys', env_vars: [{ key: 'VOICE_TOOLS_OPENAI_KEY', is_set: false, prompt: 'OpenAI API key' }] },
    { name: 'Nous Subscription', managed_nous_feature: 'tts', status: 'needs_auth', env_vars: [] },
    { name: 'ElevenLabs', status: { state: 'ready' }, env_vars: [{ key: 'ELEVENLABS_API_KEY', is_set: true }] }
  ]
}

describe("Hermes' speech providers", () => {
  it('names each row by the id Hermes writes, the managed Nous route apart from OpenAI', () => {
    expect(rowProviderId({ name: 'Nous Subscription', tts_provider: 'openai' }, 'tts')).toBe('nous')
    expect(rowProviderId({ name: 'Local Whisper' }, 'stt')).toBe('local')
    expect(rowProviderId({ name: 'xAI TTS' }, 'tts')).toBe('xai')
    expect(rowProviderId({ name: 'My Plugin Voice' }, 'tts')).toBe('my_plugin_voice')
  })

  it("lists the schema's choices, the rows and the one set now, each once, with its status and keys", () => {
    const providers = speechProviders('tts', toolset, { tts: { provider: 'kokoro' } }, { fields: { 'tts.provider': { options: ['edge', 'openai'] } } })
    expect(providers.map(p => p.id)).toEqual(['edge', 'openai', 'nous', 'elevenlabs', 'kokoro'])
    expect(providers[1]).toMatchObject({ status: 'needs_keys', row: 'OpenAI TTS', keys: [{ key: 'VOICE_TOOLS_OPENAI_KEY', isSet: false, prompt: 'OpenAI API key' }] })
    expect(providers[3]).toMatchObject({ name: 'ElevenLabs', status: 'ready' })
    expect(providers[4]).toMatchObject({ name: 'Kokoro', status: null, row: null })
  })

  it("judges an older Hermes' rows by their keys", () => {
    const [row] = speechProviders('stt', { providers: [{ name: 'Groq', stt_provider: 'groq', env_vars: [{ key: 'GROQ_API_KEY', is_set: false }] }] }, {}, null)
    expect(row).toMatchObject({ id: 'groq', status: 'needs_keys' })
  })

  it("takes Hermes' defaults when none is set", () => {
    expect(selectedProvider('stt', {})).toBe('local')
    expect(selectedProvider('tts', { tts: { provider: ' ' } })).toBe('edge')
  })

  it('edits the keys Hermes reads: Nous through OpenAI, ElevenLabs by id', () => {
    expect(speechFields('nous', 'tts').map(f => f.key)).toEqual(['tts.openai.model', 'tts.openai.language', 'tts.openai.voice', 'tts.openai.base_url', 'tts.openai.speed'])
    expect(speechFields('elevenlabs', 'tts').map(f => f.key)).toEqual(['tts.elevenlabs.voice_id', 'tts.elevenlabs.model_id', 'tts.elevenlabs.base_url'])
    expect(speechFields('elevenlabs', 'stt').map(f => f.key)).toEqual(['stt.elevenlabs.model_id', 'stt.elevenlabs.language'])
    expect(speechFields('xiaomi_mimo', 'tts').map(f => f.key)).toContain('tts.xiaomi_mimo.delivery_instructions')
    expect(speechFields('local', 'stt')[0]!.suggestions).toContain('large-v3')
  })

  it("saves typed values trimmed, a speed as a number, and a blank one taken out so Hermes' default applies", () => {
    const fields = speechFields('openai', 'tts')
    const config = { tts: { provider: 'openai', openai: { voice: 'nova', model: 'gpt-4o-mini-tts' } }, other: 1 }
    const next = withFields(config, fields, { 'tts.openai.voice': ' alloy ', 'tts.openai.model': '', 'tts.openai.speed': '1,5' })
    expect(next).toEqual({ tts: { provider: 'openai', openai: { voice: 'alloy', speed: 1.5 } }, other: 1 })
    expect(config.tts.openai.model).toBe('gpt-4o-mini-tts')
    const emptied = withFields({ stt: { groq: { model: 'x' } } }, speechFields('groq', 'stt'), { 'stt.groq.model': '' })
    expect(emptied).toEqual({})
  })

  it('refuses a speed outside what Hermes takes', () => {
    const speed = speechFields('openai', 'tts').find(f => f.key.endsWith('speed'))!
    expect(fieldProblem(speed, '5')).not.toBeNull()
    expect(fieldProblem(speed, 'fast')).not.toBeNull()
    expect(fieldProblem(speed, '0,5')).toBeNull()
    expect(fieldProblem(speed, '')).toBeNull()
  })

  it('writes a provider with no row as its section, leaving no gateway routing behind', () => {
    expect(withProvider({ stt: { provider: 'local', use_gateway: true, local: { model: 'base' } } }, 'stt', 'groq')).toEqual({ stt: { provider: 'groq', local: { model: 'base' } } })
  })
})
