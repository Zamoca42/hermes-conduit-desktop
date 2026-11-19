import { describe, expect, it } from 'vitest'
import {
  changedNames,
  followed,
  savedNames,
  speechServerPresets,
  speechServerStatus,
  speechServerTest,
  testMessage,
  withSpeechServer
} from '../src/renderer/src/state/speechServer'

describe('your speech server', () => {
  it('reads what the plugin says is set, and which switches and fields it knows', () => {
    const status = speechServerStatus({
      configured: true,
      available: true,
      url: 'ws://box:8765/v1/realtime',
      has_key: true,
      drive_turns: false,
      own_model: true,
      model: 'gpt-realtime',
      voice: null,
      transcription_model: '',
      reason: null
    })
    expect(status).toMatchObject({
      configured: true,
      url: 'ws://box:8765/v1/realtime',
      hasKey: true,
      driveTurns: false,
      ownModel: true,
      model: 'gpt-realtime',
      voice: null,
      namesItsModel: true
    })
    // A plugin before the switches and the names shows none of them.
    expect(speechServerStatus({ configured: false, url: null })).toMatchObject({
      driveTurns: null,
      ownModel: null,
      namesItsModel: false
    })
  })

  it('lists the known servers and leaves out one without a name', () => {
    const presets = speechServerPresets({
      presets: [
        {
          id: 'openai',
          name: 'OpenAI Realtime',
          url: 'wss://api.openai.com/v1/realtime',
          model: 'gpt-realtime',
          voice: 'marin',
          needs_key: true,
          drive_turns: true
        },
        {
          id: 'azure',
          name: 'Azure',
          url_hint: 'wss://YOUR.openai.azure.com/openai/realtime'
        },
        { id: 'nameless' }
      ]
    })
    expect(presets.map(p => p.id)).toEqual(['openai', 'azure'])
    expect(presets[0]).toMatchObject({
      drivesTurns: true,
      needsKey: true,
      voice: 'marin',
      transcriptionModel: null
    })
    expect(presets[1]).toMatchObject({
      url: null,
      urlHint: 'wss://YOUR.openai.azure.com/openai/realtime',
      drivesTurns: false
    })
    expect(speechServerPresets(null)).toEqual([])
  })

  it('says what the test found', () => {
    expect(testMessage(speechServerTest({ connected: true, latency_ms: 41.6 }))).toBe('Connected. Your speech server answered in 42 ms.')
    expect(testMessage(speechServerTest({ connected: true }))).toBe('Connected to your speech server.')
    expect(testMessage(speechServerTest({ connected: false, reason: 'refused' }))).toBe('refused')
    expect(speechServerTest({ connected: true, abilities: { answers_alone: true } }).answersAlone).toBe(true)
  })

  it('saves under voice.speech_server as the phone does: trimmed, empty removed, a switch off removed', () => {
    const config = {
      voice: {
        tts: 'x',
        speech_server: {
          url: 'ws://old',
          api_key: 'k',
          voice: 'alloy',
          drive_turns: true
        }
      },
      model: 'm'
    }
    const next = withSpeechServer(config, {
      url: ' ws://new ',
      apiKey: '',
      names: { voice: '', model: 'gpt-realtime' },
      driveTurns: false,
      ownModel: true
    })
    expect(next).toEqual({
      voice: {
        tts: 'x',
        speech_server: {
          url: 'ws://new',
          model: 'gpt-realtime',
          own_model: true
        }
      },
      model: 'm'
    })
    expect(config.voice.speech_server.api_key).toBe('k')
    expect(withSpeechServer({}, { driveTurns: true })).toEqual({
      voice: { speech_server: { drive_turns: true } }
    })
  })

  it('sends only the names that changed, and none to a plugin without them', () => {
    const status = speechServerStatus({
      model: 'a',
      voice: null,
      transcription_model: 'c'
    })
    expect(changedNames({ model: 'a', voice: ' marin ', transcription_model: '' }, status)).toEqual({ voice: 'marin', transcription_model: '' })
    expect(changedNames({ model: 'b', voice: '', transcription_model: '' }, speechServerStatus({}))).toEqual({})
    expect(savedNames(null)).toEqual({
      model: '',
      voice: '',
      transcription_model: ''
    })
  })

  it('moves a field nobody touched to the host’s newer value, and keeps one typed meanwhile', () => {
    expect(followed('ws://old', 'ws://old', 'ws://new')).toBe('ws://new')
    expect(followed('ws://typed', 'ws://old', 'ws://new')).toBe('ws://typed')
    expect(followed('', null, 'ws://new')).toBe('ws://new')
    // Typed back to the old value during a save that sent another: a newer edit.
    expect(followed('alloy', 'alloy', 'marin', 'marin')).toBe('alloy')
    expect(followed('marin', 'alloy', 'marin', 'marin')).toBe('marin')
  })
})
