import { describe, expect, it } from 'vitest'
import { aspect, holds, installEnding, keysyms, newerLease, parseLease, parseStatus, viewerHash, withLine } from '../src/renderer/src/state/botScreen'

describe('bot screen', () => {
  it('reads display.status, and nothing that isn’t one', () => {
    const status = parseStatus({
      profile: 'default',
      supported: true,
      installed: false,
      missing: ['Xvnc'],
      running: false,
      geometry: '1440x900',
      install_command: 'apt-get install x',
      blocker: '',
      image_switch: { current_image: 'slim', target_image: 'desktop' },
      lease: { holder: 'human', viewer_hash: 'abc', epoch: 3 },
      profile_key: '/home/h'
    })!
    expect(status).toMatchObject({
      supported: true,
      installed: false,
      missing: ['Xvnc'],
      installCommand: 'apt-get install x',
      blocker: undefined,
      profileKey: '/home/h'
    })
    expect(status.imageSwitch).toEqual({ current: 'slim', target: 'desktop' })
    expect(status.lease).toEqual({ holder: 'human', viewerHash: 'abc', epoch: 3 })
    expect(parseStatus({ running: true })).toBeNull()
    expect(parseLease(undefined)).toEqual({ holder: 'agent', viewerHash: undefined, epoch: 0 })
  })

  it('knows its own hold by the viewer hash Hermes writes', async () => {
    const hash = await viewerHash('viewer-1')
    expect(hash).toMatch(/^[0-9a-f]{12}$/)
    expect(holds({ holder: 'human', viewerHash: hash, epoch: 1 }, hash)).toBe(true)
    expect(holds({ holder: 'agent', viewerHash: hash, epoch: 1 }, hash)).toBe(false)
    expect(holds({ holder: 'human', viewerHash: 'other', epoch: 1 }, hash)).toBe(false)
    expect(newerLease({ holder: 'agent', epoch: 4 }, { holder: 'human', epoch: 3 })).toBe(false)
  })

  it('types as the phone’s type bar does, whatever the layout', () => {
    expect(keysyms('a\r\nÿ€\t')).toEqual([0x61, 0xff0d, 0xff, 0x01000000 + 0x20ac, 0xff09])
  })

  it('sizes the frame, ends an install and keeps the log short', () => {
    expect(aspect('1440x900')).toBe(1.6)
    expect(aspect('')).toBe(1.6)
    expect(installEnding(0)).toBe('done')
    expect(installEnding(-2)).toBe('noSudo')
    expect(installEnding(1)).toBe('failed')
    const log = Array.from({ length: 400 }, (_, i) => String(i))
    expect(withLine(log, 'new')).toHaveLength(400)
    expect(withLine(log, 'new').at(-1)).toBe('new')
  })
})
