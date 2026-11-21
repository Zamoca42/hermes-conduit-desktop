import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { FREE_ON_CHOICES, QUESTION_CHOICES, freeOnTitle, linkAsksClient, questionsTitle, rulesCaption, type LinkAskRulesEntry } from '../state/linkAsks'
import { linksMessage } from '../state/roomLinks'
import { Select } from './Select'

const client = linkAsksClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs))

/**
 * Settings > Multiplayer's What they can ask (the phone's LinkAsksSection):
 * for each linked person, how their Hermes' asks are answered: whether
 * you're free on a date, their questions, and which bot's phone and
 * calendar answer. One change at a time.
 */
export function LinkAsksSection({ host, linkIds, bots }: { host: string; linkIds: string[]; bots: { name: string; title: string }[] }) {
  const key = `${host}|${linkIds.join(',')}`
  const [loaded, setLoaded] = useState<{ key: string; links: LinkAskRulesEntry[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [changing, setChanging] = useState<string | null>(null)
  const current = useRef(key)
  current.current = key

  const load = async (at: string) => {
    setLoadError(null)
    try {
      const links = await client.rules()
      if (at === current.current) setLoaded({ key: at, links })
    } catch (error) {
      if (at === current.current) setLoadError(t('Could not read what they can ask: {reason}', { reason: linksMessage(error) }))
    }
  }

  useEffect(() => {
    void load(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const titleOf = (profile: string) => bots.find(b => b.name === profile)?.title ?? profile

  const change = async (link: LinkAskRulesEntry, rule: string, value: string) => {
    if (changing) return
    const at = key
    setChanging(link.id)
    setActionError(null)
    try {
      const rules = await client.set(link.id, { [rule]: value })
      setLoaded(prior => (prior && prior.key === at && at === current.current ? { key: at, links: prior.links.map(l => (l.id === link.id ? { ...l, rules } : l)) } : prior))
    } catch (error) {
      if (at === current.current) setActionError(t("Could not change what {name}'s Hermes can ask: {reason}", { name: link.name, reason: linksMessage(error) }))
    } finally {
      setChanging(null)
    }
  }

  const shown = loaded?.key === key ? linkIds.flatMap(id => loaded.links.filter(l => l.id === id).slice(0, 1)) : null

  return (
    <section className="pset-section">
      <h2>{t('What they can ask')}</h2>
      <p className="meta">
        {t("A linked person's Hermes can ask yours whether you're free on a date, or ask you a question. You choose how each is answered. Nothing else they send is answered.")}
      </p>
      {shown ? (
        shown.map(link => {
          const profiles = bots.map(b => b.name)
          const choices = profiles.includes(link.rules.profile) ? profiles : [...profiles, link.rules.profile]
          return (
            <div key={link.id} className="link-asks">
              <strong>
                {t("What {name}'s Hermes can ask", { name: link.name })}
                {changing === link.id ? <span className="meta"> {t('Working…')}</span> : null}
              </strong>
              <label className="link-asks-row">
                <span className="meta">{t('Free on a date')}</span>
                <Select className="language-select" value={link.rules.freeOn} disabled={!!changing} onChange={picked => void change(link, 'free_on', picked)}>
                  {(FREE_ON_CHOICES.includes(link.rules.freeOn) ? FREE_ON_CHOICES : [...FREE_ON_CHOICES, link.rules.freeOn]).map(choice => (
                    <option key={choice} value={choice}>
                      {freeOnTitle(choice)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="link-asks-row">
                <span className="meta">{t('Questions')}</span>
                <Select className="language-select" value={link.rules.questions} disabled={!!changing} onChange={picked => void change(link, 'questions', picked)}>
                  {(QUESTION_CHOICES.includes(link.rules.questions) ? QUESTION_CHOICES : [...QUESTION_CHOICES, link.rules.questions]).map(choice => (
                    <option key={choice} value={choice}>
                      {questionsTitle(choice)}
                    </option>
                  ))}
                </Select>
              </label>
              {/* Only one bot: it's the one that answers. */}
              {bots.length > 1 ? (
                <label className="link-asks-row">
                  <span className="meta">{t('Answered by')}</span>
                  <Select className="language-select" value={link.rules.profile} disabled={!!changing} onChange={picked => void change(link, 'profile', picked)}>
                    {choices.map(name => (
                      <option key={name} value={name}>
                        {titleOf(name)}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <p className="meta">{rulesCaption(link.rules, link.name, titleOf(link.rules.profile))}</p>
            </div>
          )
        })
      ) : loadError ? null : (
        <p className="meta">{t('Loading…')}</p>
      )}
      {loadError ? (
        <>
          <p className="error-text">{loadError}</p>
          <button className="secondary" disabled={!!changing} onClick={() => void load(key)}>
            {t('Try again')}
          </button>
        </>
      ) : null}
      {actionError ? <p className="error-text">{actionError}</p> : null}
    </section>
  )
}
