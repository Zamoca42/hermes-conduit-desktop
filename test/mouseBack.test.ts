import { describe, expect, it } from 'vitest'
import { currentBack, isBackButton } from '../src/renderer/src/state/mouseBack'

describe("the mouse's back button", () => {
  it('is button 3, and nothing answers it with no page open', () => {
    expect(isBackButton({ button: 3 })).toBe(true)
    expect(isBackButton({ button: 4 })).toBe(false)
    expect(isBackButton({ button: 0 })).toBe(false)
    expect(currentBack()).toBeUndefined()
  })
})
