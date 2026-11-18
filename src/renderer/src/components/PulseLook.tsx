import { locale, t } from '@shared/i18n'
import { BoardView } from './BoardView'
import { Icon } from './icons'
import { amount, endOfDay, lookStyle, move, pastLimit, relativeDay, relativeTime, statusTitle, type LookBody } from '../state/pulseLook'

const dayFormat = (date: Date, language?: string) => date.toLocaleDateString(language, { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * A Pulse card's body drawn from its pick, after the phone's PulseLookBody:
 * each shape in its own color and place (PulseLookStyle). `framed`: inside the
 * card's frame, which stands a date's day down its edge.
 */
export function PulseLookBody({ body, framed = false }: { body: LookBody; framed?: boolean }) {
  const language = locale()
  const { tint } = lookStyle(body)
  const style = { '--look': tint } as React.CSSProperties
  switch (body.shape) {
    case 'date': {
      const title = [body.whose, body.what].filter(Boolean).join(' · ')
      const date = framed ? '' : dayFormat(body.day, language)
      return (
        <p className="look-line" style={style}>
          {[date, title, relativeDay(body.day, new Date(), language)].filter(Boolean).join(' · ')}
        </p>
      )
    }
    case 'due': {
      const now = new Date()
      // A day with no time is due by that day's end: not late on the day.
      const by = body.hasTime ? body.due : endOfDay(body.due)
      const late = by < now
      const start = body.noticed && by > body.noticed && body.noticed.toDateString() !== body.due.toDateString() ? body.noticed : null
      const progress = start ? Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / (by.getTime() - start.getTime()))) : late ? 1 : 0.5
      const when = body.hasTime ? relativeTime(body.due, now, language) : relativeDay(body.due, now, language)
      const dueText = body.hasTime
        ? body.due.toLocaleString(language, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
        : dayFormat(body.due, language)
      return (
        <div className="look-due" style={style}>
          <div className="look-due-head">
            <Icon name="clock" />
            <strong>{when}</strong>
            <span className="spacer" />
            <span className="meta">{dueText}</span>
          </div>
          {start ? (
            <div className="look-bar" aria-hidden>
              <span style={{ width: `${progress * 100}%` }} />
            </div>
          ) : null}
        </div>
      )
    }
    case 'runs': {
      const failed = body.results.filter(ok => !ok).length
      return (
        <div className="look-runs" style={style}>
          <div className="look-runs-blocks" aria-hidden>
            {body.results.map((ok, i) => (
              <span key={i} className={ok ? 'ok' : 'fail'} />
            ))}
          </div>
          <p className="look-line">
            {[body.job, t('Runs: {count}', { count: String(body.results.length) }), t('Failed: {count}', { count: String(failed) })]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )
    }
    case 'promise': {
      const line = [body.person, body.place, body.when].filter(Boolean).join(' · ')
      return (
        <div className="look-lead" style={style}>
          <span className="look-mark" aria-hidden>
            “
          </span>
          <div>
            <p className="look-said">{body.said}</p>
            {line ? <p className="look-line">{line}</p> : null}
          </div>
        </div>
      )
    }
    case 'status':
      return (
        <div className="look-lead" style={style}>
          <span className="look-mark status" aria-hidden>
            {body.state === 'ok' ? '✓' : body.state === 'warn' ? '!' : '✕'}
          </span>
          <div>
            <p className="look-big">{statusTitle(body.state)}</p>
            <p className="meta">{body.label}</p>
          </div>
        </div>
      )
    case 'steps':
      return (
        <ol
          className="look-steps"
          style={style}
          aria-label={t('Step {index} of {count} · {name}', { index: String(body.at + 1), count: String(body.names.length), name: body.names[body.at]! })}
        >
          {body.names.map((name, i) => (
            <li key={i} className={i < body.at ? 'done' : i === body.at ? 'at' : ''}>
              <span className="look-step-dot" aria-hidden />
              {name}
            </li>
          ))}
        </ol>
      )
    case 'number': {
      const moved = move(body.value, body.was, body.better)
      const past = pastLimit(body.value, body.limit, body.better)
      return (
        <div className="look-number" style={style}>
          <div className="look-number-head">
            <span className="look-big">{amount(body.value, body.unit, language)}</span>
            {moved && body.was !== null ? (
              <span className={`look-move ${moved}`}>
                {body.value > body.was ? '↑' : '↓'} {t('from {amount}', { amount: amount(body.was, body.unit, language) })}
              </span>
            ) : null}
          </div>
          <p className="meta">
            {body.label}
            {body.limit !== null ? (
              <>
                {' · '}
                <span className={past ? 'look-past' : ''}>{t('Limit {amount}', { amount: amount(body.limit, body.unit, language) })}</span>
              </>
            ) : null}
          </p>
        </div>
      )
    }
    case 'waiting':
      return (
        <div className="look-lead" style={style}>
          <span className="look-mark" aria-hidden>
            ⏳
          </span>
          <div>
            <p className="look-big">{body.person}</p>
            <p>{body.what}</p>
            {body.since ? (
              <p className="look-line">
                {t('Since {date} · {relative}', { date: dayFormat(body.since, language), relative: relativeDay(body.since, new Date(), language) })}
              </p>
            ) : null}
          </div>
        </div>
      )
    case 'found':
      return (
        <div className="look-lead" style={style}>
          <span className="look-mark" aria-hidden>
            ◎
          </span>
          <div>
            <p className="look-big">{body.answer}</p>
            <p className="meta">{t('You asked: {asked} · {place}', { asked: body.asked, place: body.place })}</p>
          </div>
        </div>
      )
    case 'drawn':
      return <BoardView board={body.board} />
    default:
      return null
  }
}

/** A date card's day, down its leading edge in the type's color. */
export function PulseDateColumn({ day }: { day: Date }) {
  const language = locale()
  return (
    <div className="look-date-column" aria-label={day.toLocaleDateString(language, { dateStyle: 'full' })}>
      <span>{day.toLocaleDateString(language, { weekday: 'short' }).toUpperCase()}</span>
      <strong>{day.toLocaleDateString(language, { day: 'numeric' })}</strong>
      <span>{day.toLocaleDateString(language, { month: 'short' }).toUpperCase()}</span>
    </div>
  )
}

/** The morning brief in its parts (0.150.0): its summary, what's on today and still open, each counted, and how many held cards it brought. */
export function PulseBriefParts({ summary, today, open, held }: { summary: string; today: string[]; open: string[]; held: number }) {
  const section = (title: string, lines: string[]) => (
    <div className="look-brief-section">
      <h4>{title}</h4>
      <ul>
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  )
  return (
    <div className="look-brief">
      {summary ? <p className="look-brief-summary">{summary}</p> : null}
      {today.length ? section(t('Today ({count})', { count: String(today.length) }), today) : null}
      {open.length ? section(t('Still open ({count})', { count: String(open.length) }), open) : null}
      {held > 0 ? <p className="meta">{t('Held for this morning: {count}', { count: String(held) })}</p> : null}
    </div>
  )
}
