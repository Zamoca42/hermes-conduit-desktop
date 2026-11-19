import { describe, expect, it } from 'vitest'
import { MAX_TURN_S, PAUSE_MS, SPEECH_MS, callStep, micScale, type VoiceState } from '../src/renderer/src/state/call'

const start: VoiceState = { heard: false, loudAt: 0, quietSince: 0 }

function run(levels: [number, number][]) {
  let state = start
  for (const [at, level] of levels) {
    // The clock as performance.now() gives it: never 0.
    const step = callStep(state, level, 1000 + at, at / 1000)
    state = step.state
    if (step.done) return at
  }
  return null
}

describe('a Classic call turn', () => {
  it('ends on a pause after speech', () => {
    expect(run([[0, 0.3], [SPEECH_MS + 10, 0.3], [400, 0.01], [400 + PAUSE_MS - 10, 0.01], [400 + PAUSE_MS + 10, 0.01]])).toBe(400 + PAUSE_MS + 10)
  })

  it('never ends on silence alone, or on a click', () => {
    expect(run([[0, 0.01], [5000, 0.01]])).toBeNull()
    expect(run([[0, 0.5], [50, 0.01], [3000, 0.01]])).toBeNull()
  })

  it('keeps listening through a short pause', () => {
    expect(run([[0, 0.3], [400, 0.3], [500, 0.01], [1000, 0.3], [1200, 0.01], [1300, 0.01]])).toBeNull()
  })

  it('stops at the longest turn', () => {
    expect(callStep(start, 0.3, 0, MAX_TURN_S).done).toBe(true)
  })
})

describe('micScale', () => {
  it('rests at 1, shows quiet speech, and stops growing', () => {
    expect(micScale(0)).toBe(1)
    expect(micScale(0.02)).toBeGreaterThan(1.2)
    expect(micScale(1)).toBe(1.9)
    expect(micScale(-1)).toBe(1)
  })
})
