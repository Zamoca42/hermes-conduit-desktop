import { describe, expect, it } from 'vitest'
import { callRunning, setRunningCall, switchEndingCall } from '../src/renderer/src/state/callSwitch'

describe('a dashboard picked during a call', () => {
  it('switches at once with no call running', () => {
    setRunningCall(null)
    expect(
      switchEndingCall('home', () => {
        throw new Error('asked')
      })
    ).toBe(true)
  })

  it('asks first, ends the call on End Call and Switch, and leaves both on Cancel', () => {
    let ended = 0
    setRunningCall(() => ended++)
    const asked: string[] = []
    expect(switchEndingCall('home', message => (asked.push(message), false))).toBe(false)
    expect(ended).toBe(0)
    expect(callRunning()).toBe(true)
    expect(asked[0]).toContain('End the call and switch?')
    expect(asked[0]).toContain("Switching to home ends the call that's running.")

    expect(switchEndingCall(null, message => (asked.push(message), true))).toBe(true)
    expect(asked[1]).toBe('End the call and switch?')
    expect(ended).toBe(1)
    expect(callRunning()).toBe(false)
  })
})
