import { describe, expect, it } from 'vitest'
import {
  afterReply,
  continuousConversation,
  pushToTalk,
  readAloudSpeed,
  setContinuousConversation,
  setPushToTalk,
  setReadAloudSpeed,
  speedLabel
} from '../src/renderer/src/state/classicVoice'

function memory() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

describe("Classic voice's switches", () => {
  it('starts with push to talk off and Continuous Conversation on, as the phone does', () => {
    const storage = memory()
    expect(pushToTalk(storage)).toBe(false)
    expect(continuousConversation(storage)).toBe(true)
    setPushToTalk(true, storage)
    setContinuousConversation(false, storage)
    expect(pushToTalk(storage)).toBe(true)
    expect(continuousConversation(storage)).toBe(false)
  })

  it('listens again after a reply only when continuous, unmuted and not holding to talk', () => {
    expect(afterReply({ muted: false, pushToTalk: false, continuous: true })).toBe('listen')
    expect(afterReply({ muted: false, pushToTalk: false, continuous: false })).toBe('ready')
    expect(afterReply({ muted: false, pushToTalk: true, continuous: true })).toBe('ready')
    expect(afterReply({ muted: true, pushToTalk: false, continuous: true })).toBe('muted')
  })
})

describe("Read Aloud's speed", () => {
  it("is normal until picked, and the nearest of the phone's speeds otherwise", () => {
    const storage = memory()
    expect(readAloudSpeed(storage)).toBe(1)
    setReadAloudSpeed(1.5, storage)
    expect(readAloudSpeed(storage)).toBe(1.5)
    storage.setItem('conduit.voice.readAloudSpeed', '1.8')
    expect(readAloudSpeed(storage)).toBe(1.75)
    storage.setItem('conduit.voice.readAloudSpeed', 'fast')
    expect(readAloudSpeed(storage)).toBe(1)
    expect(speedLabel(1.25)).toBe('1.25x')
  })
})
