import { describe, expect, it } from 'vitest'
import { atEnd } from '../src/renderer/src/components/JumpToLatest'

describe('the jump-to-latest button', () => {
  it('shows once the reader is more than a little way up from the end', () => {
    expect(atEnd({ scrollHeight: 2000, scrollTop: 1000, clientHeight: 1000 })).toBe(true)
    expect(atEnd({ scrollHeight: 2000, scrollTop: 960, clientHeight: 1000 })).toBe(true)
    expect(atEnd({ scrollHeight: 2000, scrollTop: 900, clientHeight: 1000 })).toBe(false)
    expect(atEnd({ scrollHeight: 500, scrollTop: 0, clientHeight: 1000 })).toBe(true)
  })
})
