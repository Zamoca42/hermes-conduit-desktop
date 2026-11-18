import type { PendingRequest } from '@shared/ipc'
import { timeLabel } from '../state/chats'
import type { WaitingRow } from '../state/needsYou'
import { Icon } from './icons'
import { RequestCard } from './RequestCard'

interface Props {
  /** Requests this window holds: answered right here. */
  requests: PendingRequest[]
  /** Other chats' waits from the plugin's list: each opens its chat. */
  waiting: WaitingRow[]
  listAvailable: boolean
  titleFor: (sessionId: string) => string | undefined
  onOpen: (row: WaitingRow) => void
  onOpenLive: (sessionId: string) => void
  openLiveId: string | null
}

export function NeedsYou({ requests, waiting, listAvailable, titleFor, onOpen, onOpenLive, openLiveId }: Props) {
  const empty = requests.length === 0 && waiting.length === 0
  return (
    <main className="needs">
      <div className="needs-inner">
        <h1>Needs you</h1>
        <p className="needs-sub">Approvals and questions Hermes is waiting on, in every chat.</p>
        {empty ? (
          <div className="needs-empty">
            <Icon name="check" />
            <span>Nothing is waiting on you.</span>
            {!listAvailable ? (
              <span className="meta">
                Chats you haven’t opened here show up once the Conduit plugin on your host is up to date.
              </span>
            ) : null}
          </div>
        ) : null}
        {requests.map(request => (
          <div key={request.id} className="needs-item">
            <RequestCard request={request} chatTitle={titleFor(request.sessionId)} />
            {request.sessionId === openLiveId ? (
              <button className="link" onClick={() => onOpenLive(request.sessionId)}>
                Go to the chat
              </button>
            ) : null}
          </div>
        ))}
        {waiting.map(row => (
          <button key={row.id} className="needs-row" onClick={() => onOpen(row)}>
            <span className={`needs-kind ${row.kind}`}>
              <Icon name={row.kind === 'approval' ? 'code' : 'chats'} />
            </span>
            <span className="needs-body">
              <span className="needs-top">
                <span className="needs-title">{row.title}</span>
                <span className="meta row-time">{timeLabel(row.at)}</span>
              </span>
              <span className="meta">
                {row.kind === 'approval' ? 'Needs your OK: ' : row.questions > 1 ? `${row.questions} questions: ` : 'Question: '}
                {row.summary}
              </span>
            </span>
          </button>
        ))}
      </div>
    </main>
  )
}
