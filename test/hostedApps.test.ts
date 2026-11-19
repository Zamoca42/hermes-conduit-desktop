import { describe, expect, it } from 'vitest'
import { onAppsDirectory, openAppsDirectory, type AppsRequest } from '../src/renderer/src/state/appsDirectory'
import {
  accountNameProblem,
  appOf,
  appsOf,
  carryingLink,
  directoryGroups,
  logoUrl,
  organizationLockedTools,
  parseAccounts,
  parseCatalog,
  parseOperation,
  parsePolicy,
  parseStatuses,
  parseTools,
  policyRevision,
  rowDetail,
  sectionRows,
  titleOf,
  type Snapshot
} from '../src/renderer/src/state/hostedApps'

const layer = (kind: string, body: Record<string, unknown>, revision = 'r1') => ({ kind, revision, body })

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  available: true,
  catalog: parseCatalog({
    connectors: [
      { slug: 'gmail', name: 'Gmail', description: 'Mail', category: 'communication' },
      { slug: 'slack', name: 'Slack', description: 'Chat', category: 'communication' },
      { slug: 'notion', name: 'Notion', description: 'Notes', category: 'productivity', logo_url: 'https://example.com/n.svg' }
    ]
  }),
  statuses: [],
  accounts: [],
  policy: null,
  rulesFailed: false,
  ...over
})

describe('hosted apps', () => {
  it('reads the catalog, statuses and accounts', () => {
    expect(parseCatalog({ connectors: [{ slug: 'google_drive' }, { slug: '' }] })).toEqual([
      { slug: 'google_drive', name: 'Google Drive', description: '', category: '', logo: null }
    ])
    expect(parseStatuses({ available: true, connectors: [{ connector: 'gmail', connected: true, gateway_disabled_tools: ['A'] }] })).toEqual({
      available: true,
      statuses: [{ connector: 'gmail', enabled: true, connected: true, connectionStatus: null, statusReason: null, gatewayDisabledTools: ['A'] }]
    })
    expect(parseStatuses({ connectors: [] }).available).toBe(false)
    const [account] = parseAccounts({ accounts: [{ connection_id: 'c1', connector: 'gmail', label: 'me@x', alias: 'work', disabled: true }] })
    expect(account).toMatchObject({ connectionId: 'c1', status: 'active', alias: 'work', retired: true, active: false })
  })

  it('titles slugs and picks logos', () => {
    expect(titleOf('github_mcp')).toBe('Github MCP')
    expect(logoUrl('gmail', null)).toBe('https://logos.composio.dev/api/gmail')
    expect(logoUrl('notion', 'https://example.com/n.svg')).toBe('https://example.com/n.svg')
    expect(logoUrl('notion', 'http://example.com/n.svg')).toBe('https://logos.composio.dev/api/notion')
  })

  it('reads the rules: the member layer and the organization above', () => {
    const policy = parsePolicy({
      layers: [
        layer('member', { mode: 'deny', disabled_connectors: ['slack'], tools: { gmail: ['GMAIL_SEND'] } }, 'm7'),
        layer('org', { mode: 'allow', connectors: ['gmail', 'slack'] })
      ]
    })!
    expect(policyRevision(policy)).toBe('m7')
    const s = snapshot({ policy, accounts: parseAccounts({ accounts: [{ connection_id: 'c1', connector: 'gmail', label: 'me' }] }) })
    expect(appOf(s, 'gmail')).toMatchObject({ state: 'connected', disabledTools: ['GMAIL_SEND'] })
    expect(appOf(s, 'slack').state).toBe('off')
    expect(appOf(s, 'notion').state).toBe('offByOrganization')
    // A layer it can't read makes the whole answer unreadable.
    expect(parsePolicy({ layers: [layer('member', { mode: 'surprise' })] })).toBeNull()
    expect(parsePolicy({ layers: [layer('org', { mode: 'deny-all' })] })).toEqual({
      member: null,
      others: [{ revision: 'r1', allowed: [], denied: [], tools: {}, enabledTags: [], disabledTags: [] }]
    })
  })

  it('locks the tools the organization keeps off, by name or by tag', () => {
    const policy = parsePolicy({
      layers: [layer('org', { mode: 'deny', disabled_connectors: [], tools: { gmail: ['GMAIL_A'] }, tags: { disable: ['destructiveHint'] } })]
    })!
    const tools = parseTools({
      tools: [
        { slug: 'GMAIL_A', name: 'A' },
        { slug: 'GMAIL_B', name: 'B', hints: ['destructiveHint'], facet: 'destructive' },
        { slug: 'GMAIL_C', name: 'C', facet: 'nope' }
      ]
    })
    expect(tools[2]!.facet).toBe('unclassified')
    expect([...organizationLockedTools(policy, 'gmail', tools)].sort()).toEqual(['GMAIL_A', 'GMAIL_B'])
    const onlyRead = parsePolicy({ layers: [layer('org', { mode: 'deny', disabled_connectors: [], tags: { enable: ['readOnlyHint'] } })] })!
    expect(organizationLockedTools(onlyRead, 'gmail', tools).size).toBe(3)
  })

  it('maps account states and puts the account in use first', () => {
    const s = snapshot({
      accounts: parseAccounts({
        accounts: [
          { connection_id: 'old', connector: 'gmail', label: 'old', status: 'expired', created_at: '2026-01-01' },
          { connection_id: 'new', connector: 'gmail', label: 'new', status: 'expired', created_at: '2026-02-01' },
          { connection_id: 'used', connector: 'gmail', label: 'used', status: 'active', active: true, created_at: '2025-01-01' },
          { connection_id: 'p', connector: 'slack', label: 'p', status: 'pending' },
          { connection_id: 'f', connector: 'notion', label: 'f', status: 'failed' }
        ]
      })
    })
    expect(appOf(s, 'gmail').accounts.map(a => a.connectionId)).toEqual(['used', 'new', 'old'])
    expect(appOf(s, 'gmail').state).toBe('connected')
    expect(appOf(s, 'slack').state).toBe('connecting')
    expect(appOf(s, 'notion').state).toBe('broken')
    expect(rowDetail(appOf(s, 'gmail'))).toBe('used · 3 accounts')
  })

  it('lists your apps first, those to sign in again on top, and finds others only on a search', () => {
    const s = snapshot({
      statuses: parseStatuses({ available: true, connectors: [{ connector: 'zoom', connected: true }] }).statuses,
      accounts: parseAccounts({ accounts: [{ connection_id: 'n', connector: 'notion', label: 'n', status: 'expired' }] })
    })
    const apps = appsOf(s)
    expect(apps.map(a => a.slug)).toEqual(['gmail', 'slack', 'notion', 'zoom'])
    expect(sectionRows(apps, '').yours.map(a => a.slug)).toEqual(['notion', 'zoom'])
    expect(sectionRows(apps, '').found).toEqual([])
    expect(sectionRows(apps, 'chat').found.map(a => a.slug)).toEqual(['slack'])
    expect(directoryGroups(apps, '').map(g => [g.category, g.apps.map(a => a.slug)])).toEqual([
      ['Communication', ['gmail', 'slack']],
      ['Other', ['zoom']],
      ['Productivity', ['notion']]
    ])
  })

  it('reads a sign-in and keeps its page across a status without one', () => {
    const first = parseOperation({
      op_id: 'op',
      seq: 1,
      deadline_at: 1_800_000_000,
      targets: [{ name: 'gmail', state: 'initiated', connect_url: 'https://x.test/a', connection_id: 'c1' }]
    })!
    expect(first.deadline).toBe(1_800_000_000_000)
    const later = parseOperation({ op_id: 'op', seq: 2, targets: [{ name: 'gmail', state: 'initiated' }] })!
    expect(carryingLink(later, first).targets[0]).toMatchObject({ connectUrl: 'https://x.test/a', connectionId: 'c1' })
    expect(parseOperation({ op_id: 'op', targets: [{ name: 'gmail', connect_url: 'javascript:alert(1)' }] })!.targets[0]!.connectUrl).toBeNull()
    expect(parseOperation({ targets: [] })).toBeNull()
  })

  it('checks account names', () => {
    const accounts = parseAccounts({ accounts: [{ connection_id: 'c1', connector: 'gmail', label: 'x', alias: 'work' }] })
    expect(accountNameProblem('home', accounts)).toBeNull()
    expect(accountNameProblem('Work', accounts)).toMatch(/lowercase/)
    expect(accountNameProblem('-a', accounts)).toMatch(/lowercase/)
    expect(accountNameProblem('work', accounts)).toMatch(/already/)
    expect(accountNameProblem('work', accounts, 'c1')).toBeNull()
  })

  it('hands a chat card’s Browse Apps to whoever opens Settings, each ask a new one', () => {
    const asks: AppsRequest[] = []
    const stop = onAppsDirectory(ask => asks.push(ask))
    openAppsDirectory(['slack'], 'furina')
    openAppsDirectory(['slack'], 'furina')
    stop()
    openAppsDirectory(['gmail'])
    expect(asks.map(a => [a.suggested, a.profile])).toEqual([
      [['slack'], 'furina'],
      [['slack'], 'furina']
    ])
    expect(asks[1]!.n).toBe(asks[0]!.n + 1)
  })
})
