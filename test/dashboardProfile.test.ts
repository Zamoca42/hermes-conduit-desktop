import { beforeEach, describe, expect, it } from 'vitest'
import {
  dashboardProfilePath,
  dashboardProfileQuery,
  noteDashboardProfiles,
  setDashboardProfilesHost
} from '../src/renderer/src/state/dashboardProfile'

beforeEach(() => {
  setDashboardProfilesHost('')
  setDashboardProfilesHost('https://a')
})

describe('routes the dashboard itself answers', () => {
  it('name another profile as conduit_profile, and the dashboard’s own with neither', () => {
    expect(dashboardProfilePath('/api/plugins/conduit_push/local-live/status', 'work')).toBe('/api/plugins/conduit_push/local-live/status?conduit_profile=work')
    expect(dashboardProfilePath('/x?session_id=a', 'my bot')).toBe('/x?session_id=a&conduit_profile=my%20bot')
    expect(dashboardProfilePath('/x', 'default')).toBe('/x')
    expect(dashboardProfilePath('/x', undefined)).toBe('/x')
    expect(dashboardProfileQuery('work')).toEqual({ conduit_profile: 'work' })
    expect(dashboardProfileQuery('default')).toEqual({})
  })

  it('keep ?profile= for a plugin that doesn’t list dashboard-profiles, or too old to say', () => {
    noteDashboardProfiles('https://a', ['memory'])
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?profile=work')
    expect(dashboardProfileQuery('work')).toEqual({ profile: 'work' })
    expect(dashboardProfilePath('/x', 'default')).toBe('/x')
    noteDashboardProfiles('https://a', ['dashboard-profiles'])
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?conduit_profile=work')
    noteDashboardProfiles('https://a', null)
    expect(dashboardProfileQuery('work')).toEqual({ profile: 'work' })
  })

  it('ask again on another dashboard, never taking a late answer from the last one', () => {
    noteDashboardProfiles('https://a', [])
    setDashboardProfilesHost('https://b')
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?conduit_profile=work')
    noteDashboardProfiles('https://a', [])
    expect(dashboardProfilePath('/x', 'work')).toBe('/x?conduit_profile=work')
  })
})
