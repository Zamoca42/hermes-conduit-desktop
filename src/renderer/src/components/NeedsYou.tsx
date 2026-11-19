import type { PendingRequest } from '@shared/ipc'
import { timeLabel } from '../state/chats'
import type { WaitingRow } from '../state/needsYou'
import type { HostBadge, KeptWaitingRow } from '../state/keptHosts'
import { HostBadgeMark } from './CombinedDashboards'
import { Icon } from './icons'
import { RequestCard } from './RequestCard'
import { t } from '@shared/i18n'

interface Props {
  /** Requests this window holds: answered right here. */
  requests: PendingRequest[]
  /** Other chats' waits from the plugin's list: each opens its chat. */
  waiting: WaitingRow[]
  listAvailable: boolean
  titleFor: (sessionId: string) => string | undefined
  onOpen: (row: WaitingRow) => void
  /** Combined dashboards: the other hosts' waits, each with its host's badge; one opens by switching there. */
  otherWaiting?: KeptWaitingRow[]
  badgeFor?: (url: string) => HostBadge | null
  onOpenOther?: (row: KeptWaitingRow) => void
  onOpenLive: (sessionId: string) => void
  openLiveId: string | null
}

export function NeedsYou({ requests, waiting, listAvailable, titleFor, onOpen, otherWaiting = [], badgeFor, onOpenOther, onOpenLive, openLiveId }: Props) {
  const empty = requests.length === 0 && waiting.length === 0 && otherWaiting.length === 0
  const rows: (WaitingRow | KeptWaitingRow)[] = [...waiting, ...otherWaiting].sort((a, b) => b.at - a.at)
  return (
    <main className="needs">
      <div className="needs-inner">
        <h1>{t('Needs you')}</h1>
        <p className="needs-sub">{t('Approvals and questions Hermes is waiting on, in every chat.')}</p>
        {empty ? (
          <div className="needs-empty">
            <Icon name="check" />
            <span>{t('Nothing is waiting on you.')}</span>
            {!listAvailable ? (
              <span className="meta">
                {t('Chats you haven’t opened here show up once the Conduit plugin on your host is up to date.')}
              </span>
            ) : null}
          </div>
        ) : null}
        {requests.map(request => (
          <div key={request.id} className="needs-item">
            <RequestCard request={request} chatTitle={titleFor(request.sessionId)} />
            {request.sessionId === openLiveId ? (
              <button className="link" onClick={() => onOpenLive(request.sessionId)}>
                {t('Go to the chat')}
              </button>
            ) : null}
          </div>
        ))}
        {rows.map(row => {
          const badge = 'host' in row ? (badgeFor?.(row.host) ?? null) : null
          return (
          <button key={'host' in row ? `${row.host}\n${row.id}` : row.id} className="needs-row" onClick={() => ('host' in row ? onOpenOther?.(row) : onOpen(row))}>
            <span className={`needs-kind ${row.kind}`}>
              <Icon name={row.kind === 'approval' ? 'code' : 'chats'} />
              {badge ? <HostBadgeMark badge={badge} /> : null}
            </span>
            <span className="needs-body">
              <span className="needs-top">
                <span className="needs-title">{row.title}</span>
                <span className="meta row-time">{timeLabel(row.at)}</span>
              </span>
              <span className="meta">
                {row.kind === 'approval'
                  ? t('Needs your OK: {summary}', { summary: row.summary })
                  : row.questions > 1
                    ? t('{count} questions: {summary}', { count: row.questions, summary: row.summary })
                    : t('Question: {summary}', { summary: row.summary })}
              </span>
            </span>
          </button>
          )
        })}
      </div>
    </main>
  )
}
