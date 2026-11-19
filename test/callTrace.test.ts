import { describe, expect, it } from 'vitest'
import { CallTrace, MAX_STEPS, startCallTrace, lastCallTrace, startReadingTrace, lastReadingTrace } from '../src/renderer/src/state/callTrace'

describe('call trace', () => {
  it('keeps the first 20 steps and the newest, up to 200', () => {
    const trace = new CallTrace('Grok Live', 0)
    for (let i = 0; i < 250; i++) trace.step(`s${i}`, i)
    const steps = trace.steps
    expect(steps).toHaveLength(MAX_STEPS + 1)
    expect(steps[19]!.text).toBe('s19')
    expect(steps[20]!.text).toBe('… 50 steps left out …')
    expect(steps.at(-1)!.text).toBe('s249')
  })

  it('reports a turn’s length and microphone levels, never its words', () => {
    const trace = new CallTrace('Local Live', 0)
    trace.speechStarted(1000)
    trace.audio(new Float32Array(1600).fill(0.1), 16000, 1100)
    trace.audio(new Float32Array(1600).fill(0.01), 16000, 1200)
    trace.speechStopped(3500)
    expect(trace.steps.at(-1)!.text).toBe('Speech stopped (server) after 2.5 s, mic -20 dBFS loudest, -40 dBFS quietest')
  })

  it('says once when 15 s of audio pass with no start of speech', () => {
    const trace = new CallTrace('Qwen Live', 0)
    for (let i = 0; i < 200; i++) trace.audio(new Float32Array(1600), 16000, i * 100)
    expect(trace.steps.filter(s => s.text.startsWith('No start of speech'))).toHaveLength(1)
  })

  it('stops at its end and reads as text for an issue', () => {
    const trace = new CallTrace('GPT-Live', Date.UTC(2026, 10, 19, 9, 0, 0))
    trace.step('Socket open', Date.UTC(2026, 10, 19, 9, 0, 1))
    trace.end('hung up', Date.UTC(2026, 10, 19, 9, 0, 2))
    trace.step('late', Date.UTC(2026, 10, 19, 9, 0, 3))
    expect(trace.isEnded).toBe(true)
    expect(trace.report()).toBe('GPT-Live call, started 2026-11-19 09:00:00 UTC\n+1.0s Socket open\n+2.0s Ended: hung up')
  })

  it('a new call ends the last one', () => {
    const first = startCallTrace('Grok Live')
    const second = startCallTrace('Local Live')
    expect(first.isEnded).toBe(true)
    expect(lastCallTrace()).toBe(second)
  })

  it('keeps the last Read Aloud reading apart from the calls', () => {
    const call = startCallTrace('Grok Live')
    const first = startReadingTrace('Reading a reply: 12 of its 20 characters to speak')
    expect(first.report()).toMatch(/^Read Aloud reading, started /)
    expect(first.report()).toContain('+0.0s Reading a reply: 12 of its 20 characters to speak')
    const second = startReadingTrace('Reading a reply: 3 of its 3 characters to speak')
    expect(first.isEnded).toBe(true)
    expect(first.steps.at(-1)?.text).toBe('Ended: another reading started')
    expect(lastReadingTrace()).toBe(second)
    expect(lastCallTrace()).toBe(call)
    expect(call.isEnded).toBe(false)
  })
})
