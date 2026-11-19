import { describe, expect, it } from 'vitest'
import { firstTab, keepTabs, launchPage, syncedTabs } from '../src/renderer/src/state/launchTab'

function memory() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

describe('the page a launch opens on', () => {
  it('is Bots until the phone reorders its tabs', () => {
    expect(firstTab(undefined)).toBe('bots')
    expect(firstTab([])).toBe('bots')
    expect(firstTab(['chats', 'bots', 'tasks', 'settings'])).toBe('chats')
  })

  it('skips hidden tabs, but never hides Sessions or Settings', () => {
    expect(firstTab(['-bots', 'tasks', 'chats', 'settings'])).toBe('tasks')
    expect(firstTab(['-bots', '-tasks', '-chats', 'settings'])).toBe('chats')
  })

  it('opens on Pulse or Artifacts only once the layout turns it on', () => {
    expect(firstTab(['pulse', 'bots'])).toBe('pulse')
    expect(firstTab(['-pulse', 'artifacts', 'bots'])).toBe('artifacts')
  })

  it('passes over names this build doesn’t know', () => {
    expect(firstTab(['someday', 7, 'tasks'])).toBe('tasks')
  })

  it('keeps each dashboard’s layout for its next launch', () => {
    const storage = memory()
    keepTabs('http://a', syncedTabs({ values: { 'app.tabs': { value: ['chats', 'bots'] } } }), storage)
    keepTabs('http://b', syncedTabs({ values: {} }), storage)
    expect(launchPage('http://a', storage)).toBe('chats')
    expect(launchPage('http://b', storage)).toBe('bots')
  })
})
