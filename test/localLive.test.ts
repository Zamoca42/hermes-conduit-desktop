import { describe, expect, it } from 'vitest'
import {
  SpokenSplitter,
  agentConfigure,
  agentFrame,
  frontModel,
  lateResultText,
  toolResult,
  agentSetupText,
  deltaChunks,
  heldFrom,
  localStatus,
  modelAddress,
  plainDecision,
  readinessCheck,
  serverFlags,
  sessionUpdate,
  shellQuoted,
  spokenChoice,
  spokenQuestion,
  stopsPlayback,
  turnDelta,
  turnDone,
  turnFrame
} from '../src/renderer/src/state/localLive'

const say = (parts: string[]) => {
  const s = new SpokenSplitter()
  return { text: parts.map(p => s.feed(p)).join('') + s.finish(), leftOut: s.leftOut }
}

describe('Local Live protocol', () => {
  it('sets up a session with no instructions or tools, at 24 kHz both ways', () => {
    const update = sessionUpdate() as { session: Record<string, unknown> }
    expect(update).toMatchObject({ type: 'session.update' })
    expect(update.session).not.toHaveProperty('instructions')
    expect(update.session).not.toHaveProperty('tools')
    expect(update.session).toEqual({
      type: 'realtime',
      output_modalities: ['audio'],
      audio: {
        input: { format: { type: 'audio/pcm', rate: 24000 }, turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true } },
        output: { format: { type: 'audio/pcm', rate: 24000 } }
      }
    })
  })

  it('asks the readiness marker out of band', () => {
    expect(readinessCheck('conduit-ready-x')).toEqual({
      type: 'response.create',
      response: { conversation: 'none', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'conduit-ready-x' }] }] }
    })
  })

  it('reads turn frames and nothing else', () => {
    expect(turnFrame('{"type":"conduit.turn","turn_id":"t1","text":"hi"}')).toEqual({ type: 'turn', id: 't1', text: 'hi' })
    expect(turnFrame('{"type":"conduit.turn.cancel","turn_id":"t1"}')).toEqual({ type: 'cancel', id: 't1' })
    expect(turnFrame('{"type":"conduit.turn"}')).toBeNull()
    expect(turnFrame('{"type":"response.done"}')).toBeNull()
    expect(turnDelta('t', 'a')).toEqual({ type: 'conduit.turn.delta', turn_id: 't', text: 'a' })
    expect(turnDone('t')).toEqual({ type: 'conduit.turn.done', turn_id: 't' })
  })

  it('stops playback when the server clears or cancels its reply', () => {
    expect(stopsPlayback('{"type":"output_audio_buffer.clear"}')).toBe(true)
    expect(stopsPlayback('{"type":"response.cancelled"}')).toBe(true)
    expect(stopsPlayback('{"type":"response.done","response":{"status":"cancelled"}}')).toBe(true)
    expect(stopsPlayback('{"type":"response.done","response":{"status":"completed"}}')).toBe(false)
  })

  it('splits long deltas by code point', () => {
    expect(deltaChunks('')).toEqual([])
    const long = '😀'.repeat(4001)
    const chunks = deltaChunks(long)
    expect(chunks).toHaveLength(2)
    expect([...chunks[0]!]).toHaveLength(4000)
  })
})

describe('Local Live status', () => {
  const body = {
    ok: true,
    available: true,
    reason: null,
    model_path: '/api/plugins/conduit_push/local-live/v1',
    model_name: 'conduit',
    api_key: 'k1',
    speech_server: { url: 'ws://10.0.0.5:8765', available: true },
    last_request_at: 1700000000,
    answers_alone: false
  }

  it('joins the dashboard address with the model path', () => {
    const status = localStatus(body, 'http://host:9119/')
    expect(status.modelAddress).toBe('http://host:9119/api/plugins/conduit_push/local-live/v1')
    expect(status.apiKey).toBe('k1')
    expect(status.drivesTurns).toBe(false)
    expect(modelAddress(null, '/x')).toBeNull()
    expect(localStatus({ ...body, api_key: null }, 'http://h').modelAddress).toBeNull()
    expect(localStatus({ ...body, speech_server: { own_model: true } }, 'http://h').drivesTurns).toBe(true)
  })

  it('writes the server flags and the setup block', () => {
    const status = localStatus(body, 'http://host:9119')
    expect(serverFlags(status)).toBe(
      '--llm_backend chat-completions --responses_api_base_url http://host:9119/api/plugins/conduit_push/local-live/v1 --responses_api_api_key k1 --model_name conduit --stream_batch_sentences 1 --num_pipelines 2'
    )
    expect(agentSetupText(status)).toContain('Speech server: ws://10.0.0.5:8765')
    expect(shellQuoted("it's")).toBe("'it'\\''s'")
  })
})

describe('what Local Live says', () => {
  it('leaves code, tables, pictures and addresses out, and says links by their titles', () => {
    const r = say(['Here it is.\n```bash\nls -la\n```\n| a | b |\n|---|---|\nSee [the docs](https://x.y/z) or https://a.b/c.\n![pic](https://p/q.png)\nDone.'])
    expect(r.text).toBe('Here it is.\nSee the docs or .\nDone.')
    expect(r.leftOut).toBe(true)
  })

  it('speaks prose as it streams, holding what may become a link', () => {
    const s = new SpokenSplitter()
    expect(s.feed('Hello there, ')).toBe('Hello there, ')
    expect(s.feed('look at [this')).toBe('look at ')
    expect(s.feed('](https://x)')).toBe('this')
    expect(s.feed(' and ht')).toBe(' and ')
    expect(s.finish()).toBe('ht')
    expect(heldFrom('Hello!')).toBe(6)
    expect(heldFrom('Hi !')).toBe(3)
  })

  it('holds a line that may open a block until it ends', () => {
    const s = new SpokenSplitter()
    expect(s.feed('``')).toBe('')
    expect(s.feed('`\ncode\n```\nok')).toBe('')
    expect(s.finish()).toBe('ok')
    expect(say(['Plain answer.']).leftOut).toBe(false)
  })

  it("doesn't say emphasis, code, heading or list marks", () => {
    expect(say(['## Plan\n- The command printed **hel', 'lo** and `ls`.\n'])).toEqual({ text: 'Plan\nThe command printed hello and ls.\n', leftOut: false })
    const s = new SpokenSplitter()
    expect(s.feed('Say *')).toBe('Say ')
    expect(s.feed('*this**')).toBe('this')
  })

  it('leaves file tags out', () => {
    expect(say(['Made it.\nMEDIA:/tmp/a.png\n']).text).toBe('Made it.\n')
  })
})

describe('spoken answers', () => {
  it('takes a plain yes or no', () => {
    expect(plainDecision('Yes.')).toBe('once')
    expect(plainDecision('yeah go ahead')).toBe(null)
    expect(plainDecision('Go ahead!')).toBe('once')
    expect(plainDecision('um, okay')).toBe('once')
    expect(plainDecision('No thanks.')).toBe('deny')
    expect(plainDecision('no, delete the other one instead')).toBe(null)
    expect(plainDecision('what does it do?')).toBe(null)
  })

  it('reads spoken choice numbers', () => {
    expect(spokenChoice('Two.')).toBe('2')
    expect(spokenChoice('number 3')).toBe('3')
    expect(spokenChoice('the first one')).toBe('1')
    expect(spokenChoice('one and three')).toBe('1, 3')
    expect(spokenChoice('the blue one')).toBe('the blue one')
    expect(spokenChoice('Tuesday works')).toBe('Tuesday works')
  })

  it('reads a question out with its numbered choices', () => {
    expect(spokenQuestion({ qid: 'q', question: 'Which day?', choices: ['Mon', 'Tue'], multiSelect: false })).toBe(
      'Hermes asks: Which day?\n1. Mon\n2. Tue\nSay the number of your choice, or answer in your own words.'
    )
    expect(spokenQuestion({ qid: 'q', question: 'Why?', choices: [], multiSelect: false }, true)).toBe(
      'Hermes asks: Why?\nAnswer in your own words. Or say skip to leave it blank.'
    )
  })
})

describe('Local Live agent mode', () => {
  it('reads the host fast model', () => {
    expect(frontModel({ front_model: { configured: true, available: true, base_url: 'http://h/v1', model: 'm', has_key: false } })).toEqual({
      configured: true,
      available: true,
      baseUrl: 'http://h/v1',
      model: 'm',
      hasKey: false,
      reason: null
    })
    expect(frontModel({})).toBeNull()
  })

  it('configures the plugin and answers its tool calls', () => {
    expect(agentConfigure('be brief', [{ type: 'function', name: 'ask_thread' }])).toEqual({
      type: 'conduit.agent',
      instructions: 'be brief',
      tools: [{ type: 'function', name: 'ask_thread' }]
    })
    expect(toolResult('c1', { status: 'sent', message: 'ok' })).toEqual({
      type: 'conduit.tool.result',
      call_id: 'c1',
      output: '{"message":"ok","status":"sent"}',
      speak: false
    })
    expect(agentFrame('{"type":"conduit.tool.call","call_id":"c1","name":"ask_thread","arguments":"{\\"request\\":\\"check mail\\"}"}')).toEqual({
      type: 'toolCall',
      id: 'c1',
      name: 'ask_thread',
      args: { request: 'check mail' }
    })
    expect(agentFrame('{"type":"conduit.tool.call","call_id":"c2","name":"x","arguments":"nope"}')).toMatchObject({ args: { invalid_arguments: 'true' } })
    expect(agentFrame('{"type":"conduit.tool.late","call_id":"c1"}')).toEqual({ type: 'late', id: 'c1' })
    expect(agentFrame('{"type":"conduit.turn","turn_id":"t"}')).toBeNull()
    expect(lateResultText('answer_approval', { status: 'sent', message: 'Allowed' })).toBe(
      'Update from answer_approval, which answered late:\nmessage: Allowed\nstatus: sent\nTell the user what matters from it, briefly.'
    )
  })
})
