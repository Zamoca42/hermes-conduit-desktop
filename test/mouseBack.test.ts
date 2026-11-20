import { describe, expect, it } from 'vitest'
import { currentBack, isBackButton, nearestBack } from '../src/renderer/src/state/mouseBack'

interface Fake {
  name: string
  parentElement: Fake | null
}
const node = (name: string, parentElement: Fake | null = null): Fake => ({ name, parentElement })

describe("the mouse's back button", () => {
  it('is button 3, and nothing answers it with no page open', () => {
    expect(isBackButton({ button: 3 })).toBe(true)
    expect(isBackButton({ button: 4 })).toBe(false)
    expect(isBackButton({ button: 0 })).toBe(false)
    expect(currentBack()).toBeUndefined()
  })

  it('presses the Back nearest the pointer', () => {
    const root = node('root')
    const settings = node('settings', root)
    const settingsBack = node('settings back', node('head', settings))
    const files = node('files', root)
    const filesBack = node('files back', node('viewer head', files))
    const inFiles = node('file text', node('viewer', files))
    expect(nearestBack([settingsBack, filesBack], inFiles)?.name).toBe('files back')
    expect(nearestBack([settingsBack, filesBack], node('row', settings))?.name).toBe('settings back')
  })

  it('takes the last Back on a tie or with no pointer, and none when there are none', () => {
    const root = node('root')
    const a = node('a', root)
    const b = node('b', root)
    expect(nearestBack([a, b], null)?.name).toBe('b')
    expect(nearestBack([a, b], node('elsewhere', root))?.name).toBe('b')
    expect(nearestBack([], root)).toBeUndefined()
  })
})
