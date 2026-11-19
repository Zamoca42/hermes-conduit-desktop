import { describe, expect, it } from 'vitest'
import { dashboardProfilePath, dashboardProfileQuery } from '../src/renderer/src/state/dashboardProfile'

describe('routes the dashboard itself answers', () => {
  it('name another profile as conduit_profile, and the dashboard’s own with neither', () => {
    expect(dashboardProfilePath('/api/plugins/conduit_push/local-live/status', 'work')).toBe('/api/plugins/conduit_push/local-live/status?conduit_profile=work')
    expect(dashboardProfilePath('/x?session_id=a', 'my bot')).toBe('/x?session_id=a&conduit_profile=my%20bot')
    expect(dashboardProfilePath('/x', 'default')).toBe('/x')
    expect(dashboardProfilePath('/x', undefined)).toBe('/x')
    expect(dashboardProfileQuery('work')).toEqual({ conduit_profile: 'work' })
    expect(dashboardProfileQuery('default')).toEqual({})
  })
})
