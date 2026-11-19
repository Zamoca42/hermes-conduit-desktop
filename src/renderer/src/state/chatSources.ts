/**
 * Where a chat came from, after the phone's SessionSource (#1561, #1572):
 * Hermes' `source` on each session row, filed under one source per gateway
 * platform for the row's badge and the Chats list's Sources filter. Chats
 * Conduit or Hermes Desktop start are `desktop` sessions and file as Chat.
 */
import { t } from '../../../shared/i18n'

export type ChatSource =
  | 'chat'
  | 'discord'
  | 'telegram'
  | 'slack'
  | 'whatsapp'
  | 'signal'
  | 'imessage'
  | 'matrix'
  | 'mattermost'
  | 'teams'
  | 'google_chat'
  | 'email'
  | 'sms'
  | 'irc'
  | 'line'
  | 'simplex'
  | 'weixin'
  | 'wecom'
  | 'feishu'
  | 'dingtalk'
  | 'qqbot'
  | 'yuanbao'
  | 'buzz'
  | 'raft'
  | 'ntfy'
  | 'a2a'
  | 'api'
  | 'webhook'
  | 'cron'
  | 'other'

/** The Sources filter's default order: Chat, Discord and Telegram, the other platforms, then the rest. */
export const SOURCE_ORDER: ChatSource[] = [
  'chat',
  'discord',
  'telegram',
  'slack',
  'whatsapp',
  'signal',
  'imessage',
  'matrix',
  'mattermost',
  'teams',
  'google_chat',
  'email',
  'sms',
  'irc',
  'line',
  'simplex',
  'weixin',
  'wecom',
  'feishu',
  'dingtalk',
  'qqbot',
  'yuanbao',
  'buzz',
  'raft',
  'ntfy',
  'a2a',
  'api',
  'webhook',
  'cron',
  'other'
]

const NAMES: Partial<Record<ChatSource, string>> = {
  discord: 'Discord',
  telegram: 'Telegram',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  imessage: 'iMessage',
  matrix: 'Matrix',
  mattermost: 'Mattermost',
  teams: 'Microsoft Teams',
  google_chat: 'Google Chat',
  sms: 'SMS',
  irc: 'IRC',
  line: 'LINE',
  simplex: 'SimpleX',
  weixin: 'WeChat',
  wecom: 'WeCom',
  feishu: 'Feishu',
  dingtalk: 'DingTalk',
  qqbot: 'QQ',
  yuanbao: 'Yuanbao',
  buzz: 'Buzz',
  raft: 'Raft',
  ntfy: 'ntfy',
  a2a: 'A2A',
  api: 'API'
}

export function sourceName(source: ChatSource): string {
  switch (source) {
    case 'chat':
      return t('Chat')
    case 'email':
      return t('Email')
    case 'webhook':
      return t('Webhook')
    case 'cron':
      return t('Cron')
    case 'other':
      return t('Other')
    default:
      return NAMES[source] ?? source
  }
}

/** A platform with two backends is one source; a plugin platform not known yet is Other, not a guess. */
function platform(source: string): ChatSource | null {
  switch (source) {
    case 'whatsapp':
    case 'whatsapp_cloud':
      return 'whatsapp'
    case 'bluebubbles':
    case 'photon':
    case 'imessage':
      return 'imessage'
    case 'wecom':
    case 'wecom_callback':
      return 'wecom'
    case 'webhook':
    case 'msgraph_webhook':
      return 'webhook'
    case 'api':
    case 'api-server':
    case 'api_server':
    case 'server':
      return 'api'
    default:
      return (SOURCE_ORDER as string[]).includes(source) && !['chat', 'cron', 'other'].includes(source) ? (source as ChatSource) : null
  }
}

const CHAT_SOURCES = ['', 'desktop', 'gateway', 'tui', 'chat', 'web', 'dashboard', 'mobile', 'cli', 'local', 'default', 'unknown']

/**
 * A session row's source. A chat handed off to a platform files under it
 * once the handoff completed (a host that reports no state files by the
 * platform); a pending or failed one stays where it started.
 */
export function classifySource(row: Record<string, unknown>): ChatSource {
  const lower = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '')
  const direct = ['source', 'origin', 'platform'].map(key => lower(row[key])).filter(Boolean)
  const handoffState = lower(row.handoff_state)
  const handoff = !handoffState || handoffState === 'completed' ? lower(row.handoff_platform) : ''
  const id = lower(row.session_id ?? row.id)
  const cronMeta = ['cron_job_id', 'cron_run_id', 'scheduled_job_id', 'schedule_id'].some(key => row[key] !== undefined && row[key] !== null)
  const reported = handoff ? [...direct, handoff] : direct
  if (
    cronMeta ||
    /^(?:session[_:-])?cron[_:-]/.test(id) ||
    reported.some(s => s === 'cron' || s === 'scheduled' || s === 'scheduler' || s.startsWith('cron:') || s.startsWith('cron_') || s.startsWith('scheduled:'))
  )
    return 'cron'
  const classified = direct.map(platform).find(Boolean) ?? (handoff ? platform(handoff) : null)
  if (classified) return classified
  return CHAT_SOURCES.includes(direct[0] ?? handoff) ? 'chat' : 'other'
}

/** The sources the rows come from, in the filter's order. */
export function sourcesIn(rows: { sourceKind?: ChatSource }[]): ChatSource[] {
  const present = new Set(rows.map(row => row.sourceKind ?? 'chat'))
  return SOURCE_ORDER.filter(source => present.has(source))
}
