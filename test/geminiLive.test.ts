import { describe, expect, it } from 'vitest'
import { mintedSocket } from '../src/shared/ipc'
import {
  availability,
  audioMessage,
  decode,
  functionDeclarations,
  instructions,
  qualifiedModel,
  setupMessage,
  textTurn,
  toolResponse
} from '../src/renderer/src/state/geminiLive'
import { recallAnswer } from '../src/renderer/src/state/liveCall'

describe('Gemini Live on the host', () => {
  it('reads the status and the minted socket', () => {
    expect(availability({ ok: true, available: true, model: 'gemini-3.8-live' })).toEqual({ ok: true, model: 'gemini-3.8-live' })
    expect(availability({ ok: true, available: false, reason: 'no_api_key' })).toEqual({ ok: false, reason: 'no_api_key' })
    expect(mintedSocket({ ok: true, token: 'auth_tokens/abc', websocket_url: 'wss://g.example/ws/x', model: 'm', voice: 'Puck' })).toEqual({
      ok: true,
      url: 'wss://g.example/ws/x?access_token=auth_tokens%2Fabc',
      model: 'm',
      voice: 'Puck'
    })
    expect(mintedSocket({ ok: true, token: 't', websocket_url: 'https://g.example/ws' })).toEqual({ ok: false, error: 'malformed' })
    expect(mintedSocket({ ok: false, reason: 'no key' })).toEqual({ ok: false, error: 'no key' })
  })
})

describe('Gemini Live session', () => {
  it('sets up audio replies, the tools with Google Search, transcriptions and the voice', () => {
    const setup = (setupMessage('gemini-3.8-live', 'Be brief.', 'Kore', true) as { setup: Record<string, any> }).setup
    expect(setup.model).toBe('models/gemini-3.8-live')
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore')
    expect(setup.systemInstruction.parts[0].text).toBe('Be brief.')
    expect(setup.tools[1]).toEqual({ googleSearch: {} })
    expect(setup.tools[0].functionDeclarations.map((d: Record<string, string>) => `${d.name}:${d.behavior}`)).toEqual([
      'ask_thread:NON_BLOCKING',
      'read_last_reply:NON_BLOCKING',
      'end_conversation:BLOCKING',
      'answer_approval:NON_BLOCKING',
      'answer_question:NON_BLOCKING',
      'recall_memory:NON_BLOCKING'
    ])
    expect(setup.realtimeInputConfig.activityHandling).toBe('START_OF_ACTIVITY_INTERRUPTS')
    expect(setupMessage('m', 'x').setup).not.toHaveProperty('generationConfig.speechConfig')
    expect((functionDeclarations()[0]!.parameters as Record<string, any>).properties.request.type).toBe('STRING')
    expect(qualifiedModel('models/x')).toBe('models/x')
  })

  it('announces requests, uses Google Search, and offers recall only when the host can search memory', () => {
    const text = instructions({ language: 'fr', memory: 'Likes tea.', recall: true })
    expect(text).toContain('Every time you call ask_thread, first acknowledge it out loud.')
    expect(text).toContain('use Google Search')
    expect(text).toContain('call recall_memory first')
    expect(text).toContain('Likes tea.')
    expect(text).toMatch(/Language: speak French/)
    expect(instructions({})).not.toContain('recall_memory')
  })

  it('encodes audio, text and tool answers', () => {
    const audio = audioMessage(new Float32Array([0, 0.5])) as { realtimeInput: { audio: { mimeType: string; data: string } } }
    expect(audio.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000')
    expect(textTurn('hi')).toEqual({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'hi' }] }], turnComplete: true } })
    expect(toolResponse('c1', 'ask_thread', { result: 'done' }, 'WHEN_IDLE')).toEqual({
      toolResponse: { functionResponses: [{ id: 'c1', name: 'ask_thread', scheduling: 'WHEN_IDLE', response: { result: 'done', scheduling: 'WHEN_IDLE' } }] }
    })
    expect(recallAnswer({ ok: true, results: ' tea ' })).toEqual({ status: 'ok', results: 'tea' })
    expect(recallAnswer({ ok: false, detail: 'off' })).toEqual({ status: 'error', error: 'off' })
  })
})

describe('Gemini Live events', () => {
  it('decodes several events from one frame', () => {
    const frame = JSON.stringify({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAA=' } }] },
        outputTranscription: { text: 'Hi' },
        turnComplete: true
      }
    })
    expect(decode(frame)).toEqual([{ type: 'audio', pcm: 'AAA=' }, { type: 'output', text: 'Hi' }, { type: 'turnComplete' }])
    expect(decode('{"setupComplete":{}}')).toEqual([{ type: 'ready' }])
    expect(decode('{"serverContent":{"interrupted":true,"inputTranscription":{"text":"wait"}}}')).toEqual([
      { type: 'input', text: 'wait' },
      { type: 'interrupted' }
    ])
    expect(decode('{"toolCall":{"functionCalls":[{"id":"c1","name":"ask_thread","args":{"request":"check","n":2}}]}}')).toEqual([
      { type: 'toolCall', id: 'c1', name: 'ask_thread', args: { request: 'check', n: '2' } }
    ])
    expect(decode('{"toolCallCancellation":{"ids":["c1"]}}')).toEqual([{ type: 'toolCancel', ids: ['c1'] }])
    expect(decode('nope')).toEqual([])
  })
})
