import { useCallback, useEffect, useState } from 'react'
import { locale, t } from '@shared/i18n'
import { gateway } from '../gateway'
import { PULSE, refusalText, stamp, topicTint, topicTitle } from '../state/pulse'
import {
  LEVELS,
  causeText,
  isKeptOut,
  isLookAhead,
  kindName,
  leftOutReason,
  lessonText,
  levelTitle,
  parseLearned,
  parseLeftOut,
  preferenceDetail,
  subject,
  type Learned,
  type LeftOut,
  type Preference
} from '../state/pulseLearned'
import { Icon } from './icons'
import { useMouseBack } from '../state/mouseBack'
import { ask } from '../state/dialogs'
import { Select } from './Select'

function Head({ title, onBack }: { title: string; onBack: () => void }) {
  useMouseBack(onBack)
  return (
    <div className="pulse-head">
      <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
        <Icon name="back" />
      </button>
      <h1>{title}</h1>
    </div>
  )
}

function PreferenceLine({ preference, headed }: { preference: Preference; headed: boolean }) {
  const language = locale()
  return (
    <div className="pset-pref">
      {headed ? <strong className="pset-label">{t('What Pulse learned')}</strong> : null}
      <div>{subject(preference.scope, preference.value, preference.chatTitle)}</div>
      <div className="meta">{preferenceDetail(preference, language)}</div>
    </div>
  )
}

/**
 * What Pulse learned: each kind's loudness, what learning holds with Reset
 * and Start over, and the lessons ratings and resets made, each with Undo.
 */
export function PulseLearnedView({ onBack, onChanged }: { onBack: () => void; onChanged: () => void }) {
  const [learned, setLearned] = useState<Learned | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    try {
      setLearned(parseLearned(await gateway.http('GET', `${PULSE}/learned`)))
      setError(null)
    } catch (e) {
      setError(refusalText(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (step: () => Promise<unknown>) => {
    setWorking(true)
    try {
      setLearned(parseLearned(await step()))
      setError(null)
      onChanged()
    } catch (e) {
      setError(/pulse_off/.test(String(e)) ? t('Pulse is off') : refusalText(e))
    } finally {
      setWorking(false)
    }
  }

  const reset = (preference: Preference | null) =>
    run(() =>
      gateway.http('POST', `${PULSE}/learned/reset`, preference ? { scope: preference.scope, value: preference.value } : { scope: 'everything', value: '' })
    )

  return (
    <div className="pset">
      <Head title={t('What Pulse learned')} onBack={onBack} />
      {error ? <p className="error-text">{error}</p> : null}
      {!learned ? (
        error ? null : (
          <p className="meta">{t('Loading…')}</p>
        )
      ) : (
        <>
          <section className="pset-section">
            <h2>{t('How Pulse tells you')}</h2>
            {Object.keys(learned.levels)
              .sort()
              .map(kind => (
                <div key={kind} className="pset-row">
                  <span>{kindName(kind)}</span>
                  <Select
                    className="language-select"
                    value={learned.levels[kind]}
                    disabled={working}
                    onChange={picked => void run(() => gateway.http('PUT', `${PULSE}/levels`, { kind, level: picked }))}
                  >
                    {LEVELS.map(level => (
                      <option key={level} value={level}>
                        {levelTitle(level)}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            <p className="meta">{t('The loudest Pulse gets for each. Within that, your thumbs, Do it and Done teach it what to bring up and how loudly.')}</p>
          </section>

          <section className="pset-section">
            <h2>{t('From your thumbs, Do it and Done')}</h2>
            {learned.preferences.length === 0 ? (
              <p className="meta">{t('Nothing stands out yet. The more you use thumbs, Do it and Done, the more Pulse learns what to bring up.')}</p>
            ) : null}
            {learned.preferences.map(preference => (
              <div key={`${preference.scope}|${preference.value}`} className="pset-item">
                <PreferenceLine preference={preference} headed={false} />
                {preference.scope !== 'all' ? (
                  <button
                    className="secondary"
                    disabled={working}
                    aria-label={t('Reset what Pulse learned: {subject}', { subject: subject(preference.scope, preference.value, preference.chatTitle) })}
                    onClick={() => void reset(preference)}
                  >
                    {t('Reset')}
                  </button>
                ) : null}
              </div>
            ))}
            {learned.preferences.length ? (
              <button
                className="link danger pset-start-over"
                disabled={working}
                onClick={async () => {
                  if (
                    await ask(
                      `${t('Forget everything Pulse learned?')}\n\n${t('Pulse forgets what your thumbs, Do it and Done taught it so far and learns again from what you do next. The levels you set and the lessons from your reasons stay, and Undo takes it back.')}`
                    )
                  )
                    void reset(null)
                }}
              >
                {t('Start over')}
              </button>
            ) : null}
            <p className="meta">
              {t(
                'Reset makes Pulse forget what it learned about one of these, and Start over forgets all of it. Undo takes either back, under Learned from your ratings.'
              )}
            </p>
          </section>

          <section className="pset-section">
            <h2>{t('Learned from your ratings')}</h2>
            {learned.lessons.length === 0 ? (
              <p className="meta">{t('Nothing yet. When you give a reason with a thumbs down, what it changes shows up here.')}</p>
            ) : null}
            {learned.lessons.map(lesson => {
              const text = lessonText(lesson)
              const cause = causeText(lesson.cause)
              return (
                <div key={lesson.id} className="pset-item">
                  <div>
                    <div>{text}</div>
                    {cause ? <div className="meta">{cause}</div> : null}
                  </div>
                  <button
                    className="secondary"
                    disabled={working}
                    aria-label={t('Undo: {lesson}', { lesson: text })}
                    onClick={() => void run(() => gateway.http('POST', `${PULSE}/learned/undo`, { id: lesson.id }))}
                  >
                    {t('Undo')}
                  </button>
                </div>
              )
            })}
          </section>
        </>
      )}
    </div>
  )
}

/**
 * What Pulse left out: what the latest reports and look ahead considered
 * and didn't bring up, and why, each with Bring it up.
 */
export function PulseLeftOutView({ onBack, onBroughtUp }: { onBack: () => void; onBroughtUp: () => void }) {
  const [entries, setEntries] = useState<LeftOut[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bringing, setBringing] = useState<number | null>(null)
  const language = locale()

  const load = useCallback(async () => {
    try {
      setEntries(parseLeftOut(await gateway.http('GET', `${PULSE}/left_out`)))
      setError(null)
    } catch (e) {
      setError(refusalText(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const bringUp = async (entry: LeftOut) => {
    setBringing(entry.id)
    try {
      const answer = (await gateway.http('POST', `${PULSE}/left_out/bring_up`, { id: entry.id })) as { card?: { id?: unknown } } | null
      const cardId = typeof answer?.card?.id === 'number' ? answer.card.id : -1
      setEntries(current => current?.map(other => (other.id === entry.id ? { ...other, cardId } : other)) ?? null)
      setError(null)
      onBroughtUp()
    } catch (e) {
      setError(/pulse_off/.test(String(e)) ? t('Pulse is off') : refusalText(e))
    } finally {
      setBringing(null)
    }
  }

  const row = (entry: LeftOut) => (
    <div key={entry.id} className="pset-leftout">
      <div className="pulse-topic">
        <span className="pulse-dot" style={{ background: topicTint(entry.kind) }} />
        <span className="pulse-heading" style={{ color: topicTint(entry.kind) }}>
          {topicTitle(entry.kind)}
        </span>
        {entry.createdAt ? <span className="meta">· {stamp(entry.createdAt, Date.now(), language)}</span> : null}
      </div>
      <div>{entry.text}</div>
      {entry.chatTitle ? (
        <div className="meta pset-chat">
          <Icon name="chats" />
          {entry.chatTitle}
        </div>
      ) : null}
      <div className="meta">{leftOutReason(entry)}</div>
      {entry.decision === 'quieted' && entry.learned ? <PreferenceLine preference={entry.learned} headed /> : null}
      <div className="pset-actions">
        {entry.cardId !== undefined ? (
          <span className="pset-done">
            <Icon name="check" />
            {t('On the Pulse screen')}
          </span>
        ) : (
          <button
            className="secondary"
            disabled={bringing !== null}
            aria-label={t('Bring it up: {text}', { text: entry.text })}
            onClick={() => void bringUp(entry)}
          >
            {t('Bring it up')}
          </button>
        )}
      </div>
    </div>
  )

  const kept = entries?.filter(isKeptOut) ?? []
  const reported = entries?.filter(entry => !isKeptOut(entry) && !isLookAhead(entry)) ?? []
  const ahead = entries?.filter(entry => !isKeptOut(entry) && isLookAhead(entry)) ?? []

  return (
    <div className="pset">
      <Head title={t('What Pulse left out')} onBack={onBack} />
      {error ? <p className="error-text">{error}</p> : null}
      {!entries ? (
        error ? null : (
          <p className="meta">{t('Loading…')}</p>
        )
      ) : (
        <>
          {entries.length === 0 ? <p className="meta">{t('Nothing left out lately.')}</p> : null}
          {kept.length ? (
            <section className="pset-section">
              <h2>{t('Kept out by what you taught Pulse')}</h2>
              {kept.map(row)}
            </section>
          ) : null}
          {reported.length ? (
            <section className="pset-section">
              <h2>{t('Left out of the report')}</h2>
              {reported.map(row)}
            </section>
          ) : null}
          {ahead.length ? (
            <section className="pset-section">
              <h2>{t('Left out of the look ahead')}</h2>
              {ahead.map(row)}
            </section>
          ) : null}
          <p className="meta pset-footer">
            {ahead.length
              ? t(
                  'From the latest reports and look ahead. Bring it up makes it a card on the Pulse screen, without a notification, and what you do with it teaches Pulse about things like it.'
                )
              : t(
                  'From the latest reports. Bring it up makes it a card on the Pulse screen, without a notification, and what you do with it teaches Pulse about things like it.'
                )}
          </p>
        </>
      )}
    </div>
  )
}
