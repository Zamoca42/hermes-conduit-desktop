import { describe, expect, it } from 'vitest'
import { classifySource, sourcesIn } from '../src/renderer/src/state/chatSources'

describe('chat sources', () => {
  it('files each platform by name, two backends as one', () => {
    expect(classifySource({ source: 'telegram' })).toBe('telegram')
    expect(classifySource({ source: 'whatsapp_cloud' })).toBe('whatsapp')
    expect(classifySource({ source: 'bluebubbles' })).toBe('imessage')
    expect(classifySource({ source: 'msgraph_webhook' })).toBe('webhook')
    expect(classifySource({ source: 'api_server' })).toBe('api')
    expect(classifySource({ source: 'qqbot' })).toBe('qqbot')
  })

  it("files Conduit's and Hermes Desktop's chats as Chat, and a platform it doesn't know as Other", () => {
    expect(classifySource({ source: 'desktop' })).toBe('chat')
    expect(classifySource({ source: 'cli' })).toBe('chat')
    expect(classifySource({})).toBe('chat')
    expect(classifySource({ source: 'someplugin' })).toBe('other')
  })

  it('files a handoff under its platform only once it completed', () => {
    expect(classifySource({ source: 'desktop', handoff_platform: 'telegram', handoff_state: 'completed' })).toBe('telegram')
    expect(classifySource({ source: 'desktop', handoff_platform: 'telegram', handoff_state: 'pending' })).toBe('chat')
    expect(classifySource({ source: 'desktop', handoff_platform: 'slack' })).toBe('slack')
  })

  it('knows a cron run however it says so', () => {
    expect(classifySource({ source: 'desktop', cron_job_id: 'j1' })).toBe('cron')
    expect(classifySource({ id: 'cron_abc_123' })).toBe('cron')
    expect(classifySource({ source: 'scheduled:daily' })).toBe('cron')
  })

  it("lists the rows' sources in the filter's order", () => {
    expect(sourcesIn([{ sourceKind: 'telegram' }, {}, { sourceKind: 'discord' }, { sourceKind: 'telegram' }])).toEqual(['chat', 'discord', 'telegram'])
  })
})
